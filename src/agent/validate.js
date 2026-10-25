const VERDICTS = new Set(['брать', 'проверить', 'пропустить']);
const PHOTO_VERDICTS = new Set(['ок', 'сомнительно', 'плохо', 'не проверялось']);
const CONFIDENCE = new Set(['высокая', 'средняя', 'низкая']);
const BUDGET_STATUS = /^(в рамках|выше на \d+%)$/;
const PRICE_IN_TEXT = /(¥|₽|\bруб\.?\b|юан)/i;
const LOCAL_ONLY = /(仅限本地|只面交|不邮寄|不发货|自提|同城面交|面交|外地勿扰)/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNumberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function memorySignature(title) {
  const match = String(title || '').match(/(\d{1,2})\s*[+Gg／/]\s*(\d{2,4})\s*(?:G|GB|T|TB)?/i);
  if (!match) return null;
  return match[1] + '/' + match[2].toLowerCase();
}

function titleTokens(title) {
  const text = String(title || '').toLowerCase();
  const latin = text.match(/[a-z0-9]+/g) || [];
  const han = [...text.matchAll(/[\u4e00-\u9fff]{2,}/g)].map((m) => m[0]);
  const set = new Set(latin.filter((x) => x.length >= 2));
  for (const seq of han) {
    for (let i = 0; i < seq.length - 1; i += 1) set.add(seq.slice(i, i + 2));
  }
  return set;
}

function comparableTo(state, lot, item) {
  const baseTokens = titleTokens(lot.title_cn || (item && item.title) || '');
  const baseMemory = memorySignature(lot.title_cn || (item && item.title) || '');
  const rows = [];
  for (const [id, other] of state.items) {
    if (String(id) === String(lot.item_id)) continue;
    if (!other || other.status !== 'active') continue;
    if (other.price_cny === null || other.price_cny === undefined) continue;
    const tokens = titleTokens(other.title);
    let overlap = 0;
    for (const t of tokens) if (baseTokens.has(t)) overlap += 1;
    const mem = memorySignature(other.title);
    const memoryOk = !baseMemory || !mem || baseMemory === mem;
    if (overlap >= 3 && memoryOk) rows.push(other.price_cny);
  }
  return rows;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function validateFinish({ result, state, settings, budget, config }) {
  const errors = [];
  const warnings = [];
  if (!isObject(result)) {
    return { ok: false, errors: ['finish.result должен быть JSON-объектом'], warnings, result: null };
  }
  let out;
  try {
    out = JSON.parse(JSON.stringify(result));
  } catch {
    return { ok: false, errors: ['finish.result не сериализуется в JSON'], warnings, result: null };
  }

  const required = ['assumptions', 'request_parsed', 'stats', 'top', 'rejected_notable', 'summary_ru'];
  for (const key of required) {
    if (!(key in out)) errors.push('Нет обязательного ключа ' + key);
  }
  if (!('top' in out)) return { ok: false, errors, warnings, result: null };
  if (!Array.isArray(out.top)) {
    errors.push('top должен быть массивом');
    out.top = [];
  }
  if (!isStringArray(out.assumptions)) {
    errors.push('assumptions должен быть массивом строк');
    out.assumptions = [];
  }
  if (!Array.isArray(out.rejected_notable)) {
    errors.push('rejected_notable должен быть массивом');
    out.rejected_notable = [];
  }

  // request_parsed
  const rp = isObject(out.request_parsed) ? out.request_parsed : {};
  if (!isObject(out.request_parsed)) errors.push('request_parsed должен быть объектом');
  if (typeof rp.model !== 'string' || !rp.model.trim()) errors.push('request_parsed.model должен быть непустой строкой');
  if (!isNumberOrNull(rp.budget_cny)) errors.push('request_parsed.budget_cny должен быть числом или null');
  if (!isNumberOrNull(rp.budget_rub)) errors.push('request_parsed.budget_rub должен быть числом или null');
  if (rp.budget_cny !== null && rp.budget_cny !== undefined && rp.budget_cny < 0) errors.push('request_parsed.budget_cny не может быть отрицательным');
  if (!isStringArray(rp.must_have)) errors.push('request_parsed.must_have должен быть массивом строк');
  if (!isStringArray(rp.search_keys_used)) errors.push('request_parsed.search_keys_used должен быть массивом строк');
  if (state.priceBudgetCny !== null && state.priceBudgetCny !== undefined) {
    if (rp.budget_cny !== null && rp.budget_cny !== undefined && Math.abs(rp.budget_cny - state.priceBudgetCny) > 0.5) {
      warnings.push('budget_cny исправлен на расчётный ' + state.priceBudgetCny + ' (было ' + rp.budget_cny + ')');
    }
    rp.budget_cny = state.priceBudgetCny;
  }
  if (state.rateCnyRub !== null && state.rateCnyRub !== undefined && state.priceBudgetCny === null && rp.budget_cny !== null && rp.budget_cny !== undefined) {
    warnings.push('budget_cny не подтверждён calc_price(budget_rub)');
  }
  rp.search_keys_used = [...state.searchKeys];
  out.request_parsed = rp;

  if (state.rateCnyRub === null || state.rateCnyRub === undefined) {
    if (!out.assumptions.some((line) => /курс/i.test(line))) {
      out.assumptions.push('курс CNY/RUB не задан администратором, рублёвые цены не рассчитаны');
    }
  }
  if (rp.budget_rub !== null && rp.budget_rub !== undefined && rp.budget_cny !== null && rp.budget_cny !== undefined && state.priceBudgetCny !== null) {
    if (!out.assumptions.some((line) => /(округл|пересчит)/i.test(line))) {
      out.assumptions.push('Бюджет пересчитан в юани по курсу calc_price, округление вниз');
    }
  }

  // stats
  const stats = isObject(out.stats) ? out.stats : {};
  if (!isObject(out.stats)) warnings.push('stats отсутствовал, собран backend-ом');
  const found = state.seenItemIds.size || toInt(stats.found);
  out.stats = {
    found,
    after_title_filter: clamp(toInt(stats.after_title_filter, found), 0, found),
    after_card_filter: clamp(toInt(stats.after_card_filter, state.items.size), 0, found),
    checked_deeply: state.checkedDeeply.size,
    tool_calls: budget.used,
    limits_hit: budget.limitsHit.length ? budget.limitsHit.join('; ') : stats.limits_hit ? String(stats.limits_hit) : null,
  };

  // top
  if (out.top.length > 3) errors.push('top не может содержать больше 3 лотов (сейчас ' + out.top.length + ')');
  const seenTop = new Set();
  const normalizedTop = [];

  out.top.forEach((rawLot, index) => {
    const lot = isObject(rawLot) ? rawLot : null;
    const prefix = 'top[' + (index + 1) + ']';
    if (!lot) {
      errors.push(prefix + ': должен быть объектом');
      return;
    }
    const itemId = lot.item_id === undefined || lot.item_id === null ? '' : String(lot.item_id);
    if (!itemId) {
      errors.push(prefix + ': нет item_id');
      return;
    }
    if (seenTop.has(itemId)) errors.push(prefix + ': дубликат item_id ' + itemId);
    seenTop.add(itemId);

    const item = state.items.get(itemId);
    if (!item) {
      errors.push(prefix + ' (' + itemId + '): лот не проверялся через goofish_item, в top его включать нельзя');
      return;
    }
    if (item.status !== 'active') errors.push(prefix + ' (' + itemId + '): статус лота не активен (' + item.status + ')');

    const card = isObject(lot.card) ? lot.card : {};
    if (!isObject(lot.card)) errors.push(prefix + ': card должен быть объектом');
    const title = typeof card.title === 'string' ? card.title.trim() : '';
    if (!title) errors.push(prefix + ': card.title пустой');
    const description = typeof card.description === 'string' ? card.description.trim() : '';
    if (!description) errors.push(prefix + ': card.description пустой');
    if (description.length > 220) errors.push(prefix + ': card.description длиннее 220 символов');
    else if (description.length > 160) warnings.push(prefix + ': card.description длиннее рекомендованных 120 символов');
    const conditionLines = Array.isArray(card.condition_lines) ? card.condition_lines.filter((l) => typeof l === 'string') : [];
    if (!conditionLines.length) errors.push(prefix + ': card.condition_lines пустой');
    if (conditionLines.length > 6) errors.push(prefix + ': card.condition_lines больше 6 строк');
    if (conditionLines.length === 1) warnings.push(prefix + ': card.condition_lines из одной строки, лучше 2-6');
    for (const text of [title, description, ...conditionLines]) {
      if (PRICE_IN_TEXT.test(text)) errors.push(prefix + ': в card нельзя писать цену (' + text.slice(0, 60) + ')');
    }
    lot.card = { title, description, condition_lines: conditionLines };

    if (typeof lot.title_cn !== 'string' || !lot.title_cn.trim()) errors.push(prefix + ': title_cn пустой');
    if (typeof lot.title_ru !== 'string' || !lot.title_ru.trim()) errors.push(prefix + ': title_ru пустой');
    if (typeof lot.title_cn === 'string' && item.title && lot.title_cn.trim() !== item.title.trim()) {
      warnings.push(prefix + ': title_cn заменён на заголовок карточки');
    }
    lot.title_cn = item.title || lot.title_cn;
    lot.url = 'https://www.goofish.com/item?id=' + itemId;

    if (typeof lot.price_cny !== 'number' || !Number.isFinite(lot.price_cny)) {
      errors.push(prefix + ': price_cny должен быть числом');
    } else if (item.price_cny !== null && Math.abs(lot.price_cny - item.price_cny) > 0.01) {
      errors.push(prefix + ': price_cny ' + lot.price_cny + ' не совпадает с карточкой (' + item.price_cny + ')');
    }
    lot.price_cny = item.price_cny;

    if (!Array.isArray(lot.why_good) || !lot.why_good.length) {
      errors.push(prefix + ': why_good должен быть непустым массивом');
    } else {
      lot.why_good = lot.why_good.filter((line) => typeof line === 'string');
      lot.why_good.forEach((line) => {
        if (!/\([^()]+\)/.test(line)) warnings.push(prefix + ': why_good без источника ' + line.slice(0, 60));
      });
    }
    if (!Array.isArray(lot.red_flags)) {
      errors.push(prefix + ': red_flags должен быть массивом');
      lot.red_flags = [];
    }
    lot.red_flags = lot.red_flags.filter((f) => typeof f === 'string');

    // seller facts
    const seller = isObject(lot.seller) ? lot.seller : {};
    if (!isObject(lot.seller)) errors.push(prefix + ': seller должен быть объектом');
    const profile = state.sellers.get(String(item.seller_id));
    if (profile) {
      if (seller.zhima !== null && seller.zhima !== undefined && profile.zhima_credit !== null && seller.zhima !== profile.zhima_credit) {
        warnings.push(prefix + ': zhima исправлен по профилю продавца');
      }
      seller.zhima = profile.zhima_credit === undefined ? null : profile.zhima_credit;
      seller.sold = profile.sold_count === undefined ? null : profile.sold_count;
      seller.praise_rate = profile.praise_rate === undefined ? null : profile.praise_rate;
      seller.age_months = profile.registered_at ? monthsSince(profile.registered_at) : null;
    }
    if (seller.zhima !== null && seller.zhima !== undefined && (!Number.isFinite(seller.zhima) || seller.zhima < 0 || seller.zhima > 1000)) {
      errors.push(prefix + ': seller.zhima вне диапазона 0..1000');
      seller.zhima = null;
    }
    if (seller.age_months !== null && seller.age_months !== undefined && (!Number.isFinite(seller.age_months) || seller.age_months < 0)) {
      seller.age_months = null;
    }
    if (seller.sold !== null && seller.sold !== undefined && !Number.isFinite(seller.sold)) seller.sold = null;
    if (seller.praise_rate !== null && seller.praise_rate !== undefined && (!Number.isFinite(seller.praise_rate) || seller.praise_rate < 0 || seller.praise_rate > 100)) {
      seller.praise_rate = null;
    }
    if (typeof seller.review_summary_ru !== 'string' || !seller.review_summary_ru.trim()) {
      errors.push(prefix + ': seller.review_summary_ru пустой');
      seller.review_summary_ru = 'Отзывы не изучены.';
    }
    lot.seller = seller;

    // photo
    const photo = isObject(lot.photo_check) ? lot.photo_check : {};
    if (!isObject(lot.photo_check)) errors.push(prefix + ': photo_check должен быть объектом');
    if (!PHOTO_VERDICTS.has(photo.verdict)) errors.push(prefix + ': photo_check.verdict недопустим (' + String(photo.verdict) + ')');
    photo.defects = Array.isArray(photo.defects) ? photo.defects.filter((x) => typeof x === 'string') : [];
    photo.mismatch = Array.isArray(photo.mismatch) ? photo.mismatch.filter((x) => typeof x === 'string') : [];
    if (photo.verdict !== 'не проверялось' && !state.viewedItemIds.has(itemId)) {
      errors.push(prefix + ': фото лота не просматривались, verdict должен быть "не проверялось"');
    }
    lot.photo_check = photo;
    if (photo.verdict === 'не проверялось' || photo.verdict === 'сомнительно') {
      const photoClaims = (lot.why_good || []).filter((line) =>
        /(关于本机|电池健康|沙漏|爱思|на фото|по фото|скриншот|фото экрана|экраны|экран[а-я]* (без|с ))/i.test(line),
      );
      if (photoClaims.length) {
        warnings.push(prefix + ': why_good описывает содержание фото, хотя фото не подтверждены');
      }
    }

    // delivery facts
    const delivery = isObject(lot.delivery) ? lot.delivery : {};
    if (!isObject(lot.delivery)) errors.push(prefix + ': delivery должен быть объектом');
    if (item.delivery) {
      if (item.delivery.mode) delivery.mode = item.delivery.mode;
      delivery.from_city = item.delivery.from_city || delivery.from_city || '';
      delivery.ship_fee_cny = item.delivery.ship_fee_cny === undefined ? null : item.delivery.ship_fee_cny;
    }
    if (typeof delivery.mode !== 'string' || !delivery.mode.trim()) errors.push(prefix + ': delivery.mode пустой');
    delivery.from_city = typeof delivery.from_city === 'string' ? delivery.from_city : '';
    lot.delivery = delivery;
    lot.has_video = Boolean(item.has_video);

    // extra costs
    const extra = Array.isArray(lot.extra_costs_excluded) ? lot.extra_costs_excluded.filter((x) => typeof x === 'string') : [];
    const fee = delivery.ship_fee_cny;
    if (fee !== null && fee !== undefined && fee > 0) {
      extra.push('доставка по Китаю: ' + fee + ' ¥ (не включена в цену)');
    } else if (fee === null || fee === undefined) {
      if (!/包邮/.test(String(delivery.mode)) && !extra.some((line) => line.includes('доставка по Китаю'))) {
        extra.push('доставка по Китаю: сумма неизвестна');
      }
    }
    lot.extra_costs_excluded = [...new Set(extra)];

    // unknown
    const unknown = Array.isArray(lot.unknown) ? lot.unknown.filter((x) => typeof x === 'string') : [];
    if (!unknown.some((line) => /(锁|блок)/i.test(line))) {
      unknown.push('статус блокировок (账号锁/激活锁) не подтверждён продавцом');
      warnings.push(prefix + ': в unknown добавлена строка про блокировки');
    }
    lot.unknown = unknown;

    // questions
    let questions = Array.isArray(lot.questions_for_seller)
      ? lot.questions_for_seller.filter((q) => isObject(q) && typeof q.cn === 'string' && typeof q.ru === 'string')
      : [];
    if (!questions.length) {
      questions = [
        { cn: '这台机器有没有账号锁或激活锁？可以拍设置里关于本机的界面吗？', ru: 'Есть ли блокировка аккаунта или активации? Можно фото экрана «关于本机»?' },
      ];
      warnings.push(prefix + ': questions_for_seller был пуст, добавлен базовый вопрос');
    }
    lot.questions_for_seller = questions;

    // score
    const breakdown = isObject(lot.score_breakdown) ? lot.score_breakdown : {};
    if (!isObject(lot.score_breakdown)) errors.push(prefix + ': score_breakdown должен быть объектом');
    const limits = { price: 25, condition: 25, seller: 20, match: 10, description: 10, delivery: 10 };
    let sum = 0;
    for (const [key, max] of Object.entries(limits)) {
      const value = Number(breakdown[key]);
      if (!Number.isFinite(value)) {
        errors.push(prefix + ': score_breakdown.' + key + ' должен быть числом');
        breakdown[key] = 0;
        continue;
      }
      if (value < 0 || value > max) errors.push(prefix + ': score_breakdown.' + key + ' вне диапазона 0..' + max);
      breakdown[key] = clamp(value, 0, max);
      sum += breakdown[key];
    }
    const penalties = Number(breakdown.penalties || 0);
    if (!Number.isFinite(penalties) || penalties > 0) {
      errors.push(prefix + ': score_breakdown.penalties должен быть отрицательным числом или 0');
    }
    breakdown.penalties = Number.isFinite(penalties) ? Math.min(0, penalties) : 0;
    sum += breakdown.penalties;
    if (lot.red_flags.length && breakdown.penalties > -20 * lot.red_flags.length) {
      warnings.push(prefix + ': красные флаги без полного штрафа (-20 за каждый)');
    }
    const score = clamp(Math.round(sum), 0, 100);
    if (typeof lot.score === 'number' && Math.abs(lot.score - score) > 0.5) {
      warnings.push(prefix + ': score пересчитан как ' + score + ' (было ' + lot.score + ')');
    }
    lot.score = score;
    lot.score_breakdown = breakdown;

    // budget
    const budgetCny = rp.budget_cny;
    if (budgetCny !== null && budgetCny !== undefined) {
      if (lot.price_cny !== null && lot.price_cny > budgetCny * 1.05) {
        errors.push(prefix + ': цена ' + lot.price_cny + ' ¥ выше 105% бюджета (' + budgetCny + ' ¥)');
      }
      const status = lot.price_cny <= budgetCny ? 'в рамках' : 'выше на ' + Math.round((lot.price_cny / budgetCny - 1) * 100) + '%';
      if (lot.budget_status !== status) warnings.push(prefix + ': budget_status исправлен на "' + status + '"');
      lot.budget_status = status;
    } else if (!BUDGET_STATUS.test(String(lot.budget_status))) {
      lot.budget_status = 'в рамках';
      warnings.push(prefix + ': budget_status исправлен на "в рамках" (бюджет не задан)');
    }

    // market
    const modelMarket = isObject(lot.price_vs_market) ? lot.price_vs_market : {};
    const comparables = comparableTo(state, lot, item);
    const med = median(comparables);
    const delta = med ? Math.round(((lot.price_cny - med) / med) * 1000) / 10 : null;
    lot.price_vs_market = {
      median_cny: med !== null ? Math.round(med * 100) / 100 : null,
      comparable_count: comparables.length,
      delta_pct: comparables.length >= 5 ? delta : null,
    };
    if (comparables.length < 5 && (modelMarket.delta_pct !== null && modelMarket.delta_pct !== undefined || modelMarket.median_cny !== null && modelMarket.median_cny !== undefined)) {
      warnings.push(prefix + ': сравнение с рынком ограничено, сопоставимых лотов ' + comparables.length + ' (<5), медиана и дельта обнулены');
    }

    // money
    if (state.rateCnyRub === null || state.rateCnyRub === undefined) {
      lot.exchange_rate_cny_rub = null;
      lot.base_price_rub = null;
      lot.commission_rub = null;
      lot.final_price_rub = null;
    } else {
      const row = state.priceResults.get(itemId);
      if (!row) {
        errors.push(prefix + ': для лота не вызван calc_price, рублёвые поля не посчитать');
        lot.exchange_rate_cny_rub = null;
        lot.base_price_rub = null;
        lot.commission_rub = null;
        lot.final_price_rub = null;
      } else {
        lot.exchange_rate_cny_rub = state.rateCnyRub;
        lot.base_price_rub = row.base_rub;
        lot.commission_rub = row.commission_rub;
        lot.final_price_rub = row.final_rub;
      }
    }

    // verdict
    if (!VERDICTS.has(lot.verdict)) errors.push(prefix + ': verdict недопустим (' + String(lot.verdict) + ')');
    if (lot.verdict === 'пропустить') errors.push(prefix + ': лот с verdict "пропустить" не может быть в top');
    if (lot.verdict === 'брать') {
      if (lot.score < 80) errors.push(prefix + ': "брать" требует score ≥ 80 (сейчас ' + lot.score + ')');
      if (lot.red_flags.length) errors.push(prefix + ': "брать" требует пустой red_flags');
      if (lot.photo_check.verdict !== 'ок') errors.push(prefix + ': "брать" требует photo_check.verdict = "ок"');
      if (lot.budget_status !== 'в рамках') errors.push(prefix + ': "брать" требует budget_status = "в рамках"');
      if (LOCAL_ONLY.test(String(delivery.mode) + ' ' + String(item.description || ''))) {
        errors.push(prefix + ': "брать" невозможен, доставка ограничена местом');
      }
      if (lot.photo_check.defects.length || lot.photo_check.mismatch.length) {
        errors.push(prefix + ': "брать" требует отсутствия дефектов и несоответствий на фото');
      }
    }
    if (lot.score < 60) errors.push(prefix + ': score < 60, лот не может быть в top');
    if (lot.red_flags.length >= 2) errors.push(prefix + ': два и более красных флага, лот не может быть в top');
    if (lot.photo_check.verdict === 'плохо') errors.push(prefix + ': photo_check = "плохо", лот не может быть в top');

    // confidence
    if (!CONFIDENCE.has(lot.confidence)) errors.push(prefix + ': confidence недопустим (' + String(lot.confidence) + ')');
    if (lot.confidence === 'высокая' && (lot.photo_check.verdict !== 'ок' || lot.seller.zhima === null || lot.price_vs_market.comparable_count < 5)) {
      lot.confidence = 'средняя';
      warnings.push(prefix + ': confidence понижена до "средняя" (нет полных данных)');
    }
    if (lot.photo_check.verdict === 'не проверялось' && lot.confidence !== 'низкая') {
      lot.confidence = 'низкая';
      warnings.push(prefix + ': confidence понижена до "низкая" (фото не проверялись)');
    }

    normalizedTop.push(lot);
  });

  if (out.top.length === 0 && (typeof out.summary_ru !== 'string' || !out.summary_ru.trim())) {
    errors.push('top пуст: summary_ru обязан объяснить причину');
  }

  // ranks and order
  const verdictRank = { брать: 0, проверить: 1, пропустить: 2 };
  normalizedTop.sort((a, b) => {
    const vr = (verdictRank[a.verdict] ?? 9) - (verdictRank[b.verdict] ?? 9);
    if (vr !== 0) return vr;
    if (b.score !== a.score) return b.score - a.score;
    const af = a.final_price_rub === null || a.final_price_rub === undefined ? Number.POSITIVE_INFINITY : a.final_price_rub;
    const bf = b.final_price_rub === null || b.final_price_rub === undefined ? Number.POSITIVE_INFINITY : b.final_price_rub;
    return af - bf;
  });
  normalizedTop.forEach((lot, i) => {
    lot.rank = i + 1;
  });
  out.top = normalizedTop;

  // rejected
  out.rejected_notable = out.rejected_notable
    .filter((entry) => isObject(entry) && entry.item_id !== undefined && entry.reason !== undefined)
    .map((entry) => ({ item_id: String(entry.item_id), reason: String(entry.reason) }));
  if (out.rejected_notable.length > 5) {
    warnings.push('rejected_notable обрезан до 5 записей');
    out.rejected_notable = out.rejected_notable.slice(0, 5);
  }

  if (typeof out.summary_ru !== 'string') {
    errors.push('summary_ru должен быть строкой');
    out.summary_ru = '';
  }
  const sentences = out.summary_ru.split(/[.!?]+(?=\s|$)/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > 3) warnings.push('summary_ru длиннее 3 предложений');
  if (!out.summary_ru.trim() && out.top.length) errors.push('summary_ru пустой');

  if (!settings || typeof settings.commission_percent !== 'number') {
    warnings.push('настройки комиссии недоступны');
  }

  return { ok: errors.length === 0, errors, warnings, result: out };
}

function monthsSince(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (now.getDate() < date.getDate()) months -= 1;
  return months >= 0 ? months : null;
}
