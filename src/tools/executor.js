import { calcPrice } from './pricing.js';
import { loadImage } from './images.js';
import { analyzePhotos } from '../agent/vision.js';
import { validateFinish } from '../agent/validate.js';
import { GOOFISH_KINDS, classifyGoofishError, formatRetryAfter } from '../goofish/errors.js';

function str(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value);
}

function fmtNum(value) {
  return value === null || value === undefined ? '—' : String(value);
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function monthsSince(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (now.getDate() < date.getDate()) months -= 1;
  return months >= 0 ? months : null;
}

export class ToolState {
  constructor({ provider, settings, budget, config, logger, visionAnalyzer = null }) {
    this.provider = provider;
    this.settings = settings;
    this.budget = budget;
    this.config = config;
    this.logger = logger;
    this.visionAnalyzer = visionAnalyzer;
    this.items = new Map();
    this.sellers = new Map();
    this.reviews = new Map();
    this.itemCache = new Map();
    this.sellerCache = new Map();
    this.reviewCache = new Map();
    this.seenItemIds = new Set();
    this.searchKeys = new Set();
    this.checkedDeeply = new Set();
    this.viewedItemIds = new Set();
    this.priceResults = new Map();
    this.priceBudgetCny = null;
    this.rateCnyRub = null;
    this.calcCalls = 0;
    this.finishAttempts = 0;
    this.finished = false;
    this.result = null;
    this.finishWarnings = [];
    this.visionByItem = new Map();
    this.riskControlHits = 0;
    this.log = [];
  }

  markCheckedBySeller(sellerId) {
    for (const [itemId, item] of this.items) {
      if (String(item.seller_id) === String(sellerId)) this.checkedDeeply.add(itemId);
    }
  }
}

function formatSearchItem(item) {
  const parts = [
    '[' + item.item_id + '] ' + str(item.title, '(без названия)'),
    fmtNum(item.price_cny) + ' ¥',
    str(item.location, '?') || '?',
    'продавец ' + (item.seller_id ? String(item.seller_id) : item.seller_nick ? String(item.seller_nick) : '?'),
    fmtDate(item.publish_time),
  ];
  if (Array.isArray(item.condition_tags) && item.condition_tags.length) parts.push(item.condition_tags.join('/'));
  if (item.want_count !== null && item.want_count !== undefined) parts.push('хотят ' + item.want_count);
  return parts.join(' — ');
}

async function runSearch(args, state) {
  const keyword = String(args.keyword || '').trim();
  if (!keyword) return { text: 'ОШИБКА: keyword пустой' };
  if (keyword.length > 120) return { text: 'ОШИБКА: keyword длиннее 120 символов' };
  const priceMin = args.price_min === undefined || args.price_min === null ? null : Number(args.price_min);
  const priceMax = args.price_max === undefined || args.price_max === null ? null : Number(args.price_max);
  if (priceMin !== null && !Number.isFinite(priceMin)) return { text: 'ОШИБКА: price_min не число' };
  if (priceMax !== null && !Number.isFinite(priceMax)) return { text: 'ОШИБКА: price_max не число' };
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) return { text: 'ОШИБКА: price_min больше price_max' };

  const data = await state.provider.search({
    keyword,
    priceMin,
    priceMax,
    sort: args.sort === 'price_asc' ? 'price_asc' : 'new',
    page: Math.max(1, Math.floor(Number(args.page) || 1)),
    personalOnly: args.personal_only === undefined ? true : Boolean(args.personal_only),
  });
  state.searchKeys.add(keyword);
  for (const item of data.items) state.seenItemIds.add(item.item_id);
  const header =
    'ПОИСК "' + keyword + '" — найдено ' + data.total + ', стр. ' + data.page + ', показано ' + data.items.length + ' (provider: ' + data.provider + ')';
  const body = data.items.length ? data.items.map(formatSearchItem).join('\n') : '(ничего не найдено)';
  const hint = data.items.length
    ? '\n\nПроверяй перспективные лоты через goofish_item. seller_id для goofish_seller бери из карточки лота: в поиске только ник. Помни: цена-заглушка и аксессуары отсеиваются по заголовку.'
    : '\n\nПопробуй другой ключ или измени ценовые границы.';
  return { text: header + '\n' + body + hint };
}

function formatItemCard(item) {
  const lines = [];
  lines.push('КАРТОЧКА ' + item.item_id);
  lines.push('Название: ' + str(item.title, '—'));
  lines.push('Цена: ' + fmtNum(item.price_cny) + ' ¥' + (item.original_price_cny ? ' (изначально ' + item.original_price_cny + ' ¥)' : ''));
  lines.push('Статус: ' + (item.status === 'active' ? 'активно' : item.status === 'sold' ? 'продано' : str(item.status, 'неизвестно')));
  lines.push(
    'Продавец: ' + str(item.seller_id, '—') +
      (item.seller_nick ? ' (' + item.seller_nick + ')' : '') +
      (item.seller_credit ? ', кредит: ' + item.seller_credit : ''),
  );
  lines.push('Локация: ' + str(item.location, '—'));
  const delivery = item.delivery || {};
  lines.push(
    'Доставка: ' + (delivery.mode || 'не указана') + ', ' +
      (delivery.ship_fee_cny === null || delivery.ship_fee_cny === undefined ? 'стоимость неизвестна' : delivery.ship_fee_cny + ' ¥') +
      (delivery.from_city ? ', из ' + delivery.from_city : ''),
  );
  lines.push('Теги состояния: ' + (Array.isArray(item.condition_tags) && item.condition_tags.length ? item.condition_tags.join(', ') : 'нет'));
  lines.push('Видео: ' + (item.has_video ? 'есть' : 'нет'));
  lines.push('Хотят: ' + fmtNum(item.want_count) + ', просмотров: ' + fmtNum(item.view_count));
  lines.push('Опубликовано: ' + fmtDate(item.publish_time));
  const description = str(item.description, '(пусто)') || '(пусто)';
  lines.push('Описание:\n' + (description.length > 1200 ? description.slice(0, 1200) + '…' : description));
  const images = Array.isArray(item.image_urls) ? item.image_urls : [];
  lines.push('Фото (' + images.length + '):');
  images.forEach((url, index) => lines.push('[' + (index + 1) + '] ' + url));
  return lines.join('\n');
}

async function runItem(args, state) {
  const itemId = String(args.item_id || '').trim();
  if (!itemId) return { text: 'ОШИБКА: item_id пустой' };
  if (state.itemCache.has(itemId)) {
    return { text: '[кэш] Карточка ' + itemId + ' уже запрашивалась, данные ниже.\n' + state.itemCache.get(itemId) };
  }
  const item = await state.provider.item(itemId);
  state.items.set(itemId, item);
  const text = formatItemCard(item);
  state.itemCache.set(itemId, text);
  return { text };
}

function formatSeller(seller) {
  const age = monthsSince(seller.registered_at);
  const lines = [];
  lines.push('ПРОДАВЕЦ ' + str(seller.seller_id, '?'));
  lines.push('Ник: ' + str(seller.nickname, '—'));
  lines.push('Zhima: ' + (seller.zhima_credit === null || seller.zhima_credit === undefined ? 'нет числового рейтинга' : seller.zhima_credit));
  lines.push('Кредит: ' + (seller.zhima_text || 'нет данных'));
  lines.push('Оценок/отзывов: ' + (seller.reviews_count !== null && seller.reviews_count !== undefined ? seller.reviews_count : 'нет данных'));
  lines.push('Верификация: ' + (seller.verified ? 'да' : 'нет'));
  lines.push('Регистрация: ' + (seller.registered_at || 'нет данных') + (age === null ? '' : ' (примерно ' + age + ' мес.)'));
  lines.push('Продано: ' + fmtNum(seller.sold_count));
  lines.push('Положительных: ' + (seller.praise_rate === null || seller.praise_rate === undefined ? 'нет данных' : seller.praise_rate + '%'));
  lines.push('Локация: ' + str(seller.location, '—'));
  const samples = Array.isArray(seller.items_sample) ? seller.items_sample : [];
  lines.push('Примеры лотов: ' + (samples.length ? samples.map((s) => '[' + s.item_id + '] ' + s.title + ' — ' + fmtNum(s.price_cny) + ' ¥').join('; ') : 'нет данных'));
  return lines.join('\n');
}

async function runSeller(args, state) {
  const sellerId = String(args.seller_id || '').trim();
  if (!sellerId) return { text: 'ОШИБКА: seller_id пустой' };
  if (state.sellerCache.has(sellerId)) {
    return { text: '[кэш] Профиль ' + sellerId + ' уже запрашивался.\n' + state.sellerCache.get(sellerId) };
  }
  const seller = await state.provider.seller(sellerId);
  state.sellers.set(sellerId, seller);
  const text = formatSeller(seller);
  state.sellerCache.set(sellerId, text);
  state.markCheckedBySeller(sellerId);
  return { text };
}

async function runReviews(args, state) {
  const sellerId = String(args.seller_id || '').trim();
  if (!sellerId) return { text: 'ОШИБКА: seller_id пустой' };
  const page = Math.max(1, Math.floor(Number(args.page) || 1));
  const key = sellerId + ':' + page;
  if (state.reviewCache.has(key)) {
    return { text: '[кэш] Отзывы ' + sellerId + ' стр. ' + page + ' уже запрашивались.\n' + state.reviewCache.get(key) };
  }
  const data = await state.provider.reviews(sellerId, page);
  state.reviews.set(key, data);
  state.markCheckedBySeller(sellerId);
  const lines = [];
  lines.push('ОТЗЫВЫ ' + sellerId + ' — всего ' + fmtNum(data.total) + ', стр. ' + data.page + ', показано ' + data.reviews.length);
  if (!data.reviews.length) lines.push('(отзывов нет — это неизвестность, не обвинение)');
  data.reviews.forEach((review) => {
    lines.push(
      '[' + (review.review_id || '?') + '] ' + fmtDate(review.created_at) + ' — ' +
        (review.rating === 1 ? '好评' : review.rating === 0 ? '中评' : review.rating === -1 ? '差评' : review.rating === null || review.rating === undefined ? '?' : review.rating + '/5') + ' — ' +
        (review.item_id ? 'лот ' + review.item_id + ': ' : '') + str(review.text, '(без текста)'),
    );
  });
  const text = lines.join('\n');
  state.reviewCache.set(key, text);
  return { text };
}

async function runImages(args, state) {
  const urls = Array.isArray(args.urls) ? args.urls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)) : [];
  if (!urls.length) return { text: 'ОШИБКА: передай хотя бы один http(s) URL фото' };
  const max = Math.max(1, Math.min(Number(args.max) || 4, 4));
  const selected = urls.slice(0, max);
  const targetEntry = [...state.items].find(([, item]) =>
    (Array.isArray(item.image_urls) ? item.image_urls : []).some((url) => selected.includes(url)),
  );

  if (state.config.vision.enabled) {
    const visionUrls = selected.slice();
    if (targetEntry) {
      for (const url of targetEntry[1].image_urls || []) {
        if (visionUrls.length >= state.config.vision.maxPhotos) break;
        if (!visionUrls.includes(url)) visionUrls.push(url);
      }
    }
    const analyzer = state.visionAnalyzer || analyzePhotos;
    const result = await analyzer({
      urls: visionUrls.slice(0, state.config.vision.maxPhotos),
      item: targetEntry ? targetEntry[1] : null,
      config: state.config,
      logger: state.logger,
    });
    if (result.ok) {
      if (targetEntry) {
        state.visionByItem.set(targetEntry[0], result.analysis);
        state.viewedItemIds.add(targetEntry[0]);
        state.checkedDeeply.add(targetEntry[0]);
      }
      return {
        text:
          'VISION-АНАЛИЗ ФОТО (используй как photo_check):\n' +
          JSON.stringify(result.analysis, null, 2) +
          '\n\nОценивай состояние по этому анализу. Если verdict = "плохо" — лот в top не включай.',
      };
    }
    return { text: 'ОШИБКА vision: ' + result.reason + '. Фото не проверены, photo_check = "не проверялось".' };
  }

  if (state.config.images.mode === 'off') {
    return { text: 'Просмотр фото отключён настройками (PHOTO_MODE=off). photo_check = "не проверялось".' };
  }

  const images = [];
  const failed = [];
  for (const url of selected) {
    try {
      const image = await loadImage(url, {
        inline: state.config.images.inline,
        maxBytes: state.config.images.maxBytes,
      });
      if (image.dataUrl) images.push({ url, imageUrl: image.dataUrl, caption: url });
      else images.push({ url, imageUrl: url, caption: url });
    } catch (err) {
      failed.push(url + ' (' + err.message + ')');
    }
  }
  for (const [itemId, item] of state.items) {
    const itemImages = Array.isArray(item.image_urls) ? item.image_urls : [];
    if (images.some((image) => itemImages.includes(image.url))) {
      state.viewedItemIds.add(itemId);
      state.checkedDeeply.add(itemId);
    }
  }

  const text =
    'Фото переданы модели: ' + images.length + ' из ' + selected.length + '.' +
    (images.length ? '\nОсмотри: модель, цвет, память, регион, экран 关于本机, 电池健康, отчёты 沙漏验机/爱思助手, царапины, зазоры, комплект.' : '') +
    (failed.length ? '\nНе удалось загрузить: ' + failed.join('; ') : '');
  return { text, images };
}

async function runCalcPrice(args, state) {
  const input = {};
  if (args.budget_rub !== undefined && args.budget_rub !== null) {
    const budget = Number(args.budget_rub);
    if (!Number.isFinite(budget) || budget <= 0) return { text: 'ОШИБКА: budget_rub должен быть положительным числом' };
    input.budget_rub = budget;
  }
  if (args.items !== undefined && args.items !== null) {
    if (!Array.isArray(args.items)) return { text: 'ОШИБКА: items должен быть массивом' };
    if (args.items.length > 3) return { text: 'ОШИБКА: максимум 3 лота в items' };
    const items = [];
    for (const raw of args.items) {
      const itemId = String((raw && raw.item_id) || '').trim();
      const price = Number(raw && raw.price_cny);
      if (!itemId) return { text: 'ОШИБКА: у элемента items нет item_id' };
      if (!Number.isFinite(price) || price <= 0) return { text: 'ОШИБКА: некорректная price_cny у ' + itemId };
      const known = state.items.get(itemId);
      if (known && known.price_cny !== null && Math.abs(known.price_cny - price) > 0.01) {
        return { text: 'ОШИБКА: price_cny для ' + itemId + ' не совпадает с карточкой (' + known.price_cny + ' ¥)' };
      }
      items.push({ item_id: itemId, price_cny: price });
    }
    input.items = items;
  }
  state.calcCalls += 1;
  const result = calcPrice(input, state.settings);
  if (result.error) {
    return {
      text:
        '{"error":"rate_unavailable"}\nКурс CNY/RUB не задан администратором. Все рублёвые поля в итоге должны быть null, причину укажи в assumptions.',
    };
  }
  state.rateCnyRub = result.rate_cny_rub;
  if (result.budget_cny !== null && result.budget_cny !== undefined) state.priceBudgetCny = result.budget_cny;
  for (const row of result.results) state.priceResults.set(row.item_id, row);
  return { text: JSON.stringify(result, null, 2) };
}

async function runFinish(args, state) {
  state.finishAttempts += 1;
  if (state.finishAttempts > 3) {
    return { text: 'ОШИБКА: finish отклонялся 3 раза. Проверь структуру и вызови finish с исправленным результатом.' };
  }
  const validation = validateFinish({
    result: args && args.result,
    state,
    settings: state.settings,
    budget: state.budget,
    config: state.config,
  });
  if (!validation.ok) {
    state.budget.finishInvalid = true;
    return {
      text:
        'ИТОГ НЕ ПРИНЯТ. Исправь ошибки и вызови finish ещё раз:\n' +
        validation.errors.map((e, i) => (i + 1) + '. ' + e).join('\n') +
        (validation.warnings.length ? '\n\nПредупреждения (не блокируют):\n' + validation.warnings.map((w) => '- ' + w).join('\n') : ''),
    };
  }
  state.finished = true;
  state.budget.finishInvalid = false;
  state.result = validation.result;
  state.finishWarnings = validation.warnings.slice();
  return {
    text:
      'Итог принят.' +
      (validation.warnings.length ? '\nПредупреждения: ' + validation.warnings.join('; ') : ''),
  };
}

const HANDLERS = {
  goofish_search: runSearch,
  goofish_item: runItem,
  goofish_seller: runSeller,
  goofish_reviews: runReviews,
  view_images: runImages,
  calc_price: runCalcPrice,
  finish: runFinish,
};

export async function executeTool(name, args, state) {
  const handler = HANDLERS[name];
  if (!handler) return { text: 'ОШИБКА: неизвестный инструмент ' + name };
  const started = Date.now();
  try {
    const result = await handler(args || {}, state);
    state.log.push({
      tool: name,
      args,
      ok: true,
      ms: Date.now() - started,
      summary: (result.text || '').slice(0, 200),
    });
    return result;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    state.log.push({ tool: name, args, ok: false, ms: Date.now() - started, error: message });
    if (state.logger) state.logger.warn('tool error', { tool: name, error: message });
    const code = err && err.code ? ' [' + err.code + ']' : '';
    const info = classifyGoofishError(err);
    if (err && err.code === 'risk_control') {
      state.riskControlHits += 1;
      const wait = err.retryAfterMs ? ' Пауза: ' + formatRetryAfter(err.retryAfterMs) + '.' : '';
      return {
        text:
          'ОШИБКА: Goofish ограничил карточки/профили (RGV587 или ручная проверка).' + wait +
          ' Поиск при этом может работать. Не повторяй запрос подряд; заверши прогон по уже собранным данным.',
      };
    }
    if (info.kind === GOOFISH_KINDS.NO_ACCOUNT) {
      return {
        text:
          'ОШИБКА: нет доступного аккаунта Goofish (cooldown/проверка). ' +
          'Карточки недоступны; можно работать только через поиск. Не повторяй запрос.',
      };
    }
    if (info.kind === GOOFISH_KINDS.SESSION_EXPIRED) {
      return {
        text:
          'ОШИБКА: сессия Goofish истекла. Админ должен обновить cookie командой /cookie. ' +
          'До этого карточки недоступны.',
      };
    }
    return { text: 'ОШИБКА инструмента ' + name + code + ': ' + message };
  }
}
