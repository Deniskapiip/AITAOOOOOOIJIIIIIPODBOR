export function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

export function formatRub(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat('ru-RU').format(Number(value)).replace(/\u00A0/g, ' ');
}

export function formatCny(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat('ru-RU').format(Number(value)).replace(/\u00A0/g, ' ');
}

export function itemLinks(itemId) {
  const id = encodeURIComponent(String(itemId || ''));
  return {
    web: 'https://www.goofish.com/item?id=' + id,
    h5: 'https://h5.m.goofish.com/item?id=' + id,
    app:
      'fleamarket://awesome_detail?itemId=' + id +
      '&hitNativeDetail=true&flutter=true&needNotPreGet=true&ignoreMiddle=true&id=' + id,
  };
}

const VERDICT_LABEL = {
  брать: { icon: '🟢', text: 'брать' },
  проверить: { icon: '🟡', text: 'проверить' },
  пропустить: { icon: '⚪', text: 'пропустить' },
};

function iconFor(line) {
  const text = String(line || '');
  if (/АКБ|аккум|батаре/i.test(text)) return '🔋';
  if (/экран|дисплей|матриц/i.test(text)) return '🖥';
  if (/корпус|рамк|крышк|царапин|потёрт|скол|вмят/i.test(text)) return '📱';
  if (/вскрыт|ремонт|замен|разбор/i.test(text)) return '🛠';
  if (/комплект|коробк|кабел|зарядк|чехол/i.test(text)) return '📦';
  if (/версия|памят|国行|регион|ГБ/i.test(text)) return '🌏';
  if (/блокиров|аккаунт|锁/i.test(text)) return '🔒';
  return '•';
}

function sellerLine(lot) {
  const seller = lot.seller || {};
  const bits = [];
  if (lot.seller_nick) bits.push(escapeHtml(lot.seller_nick));
  if (seller.zhima !== null && seller.zhima !== undefined) bits.push('Zhima ' + seller.zhima);
  else if (lot.seller_credit) bits.push(escapeHtml(lot.seller_credit));
  if (seller.age_months !== null && seller.age_months !== undefined) bits.push('стаж ' + seller.age_months + ' мес.');
  if (seller.sold !== null && seller.sold !== undefined) bits.push(seller.sold + ' продаж');
  return bits.length ? '👤 ' + bits.join(' · ') : '';
}

export function buildLotCardHtml(lot, index, meta = {}) {
  const lines = [];
  const card = lot.card || {};
  const links = itemLinks(lot.item_id);
  lines.push('<b>' + escapeHtml((index || lot.rank || 1) + '. ' + (card.title || lot.title_ru || lot.item_id)) + '</b>');
  if (card.description) lines.push('<i>' + escapeHtml(card.description) + '</i>');

  const condition = Array.isArray(card.condition_lines) ? card.condition_lines : [];
  if (condition.length) {
    lines.push('');
    for (const line of condition) lines.push(iconFor(line) + ' ' + escapeHtml(line));
  }

  const priceCny = formatCny(lot.price_cny);
  const priceRub = formatRub(lot.final_price_rub);
  lines.push('');
  lines.push(
    '<b>' + (priceCny === null ? '—' : priceCny + ' ¥') +
      (priceRub === null ? ' · ₽ — курс не задан' : ' · ' + priceRub + ' ₽') + '</b>',
  );

  const verdict = VERDICT_LABEL[lot.verdict] || { icon: '⚪', text: lot.verdict || '—' };
  const confidence = lot.confidence || '—';
  lines.push(verdict.icon + ' ' + escapeHtml(verdict.text) + ' · ' + lot.score + '/100 · уверенность ' + escapeHtml(confidence));

  const seller = sellerLine(lot);
  if (seller) lines.push(seller);
  if (lot.budget_status && lot.budget_status !== 'в рамках') lines.push('⚠️ ' + escapeHtml(lot.budget_status));
  if (Array.isArray(lot.red_flags) && lot.red_flags.length) {
    lines.push('⚠️ ' + escapeHtml(lot.red_flags.slice(0, 2).join('; ')));
  } else if (Array.isArray(lot.unknown) && lot.unknown.some((u) => /блок|锁/i.test(u))) {
    lines.push('🔒 статус блокировок не подтверждён');
  }

  lines.push('');
  lines.push('<a href="' + escapeAttr(links.web) + '">🌐 Открыть на сайте</a> · <a href="' + escapeAttr(links.h5) + '">📱 Мобильная версия</a> · <a href="' + escapeAttr(links.app) + '">📲 В приложении</a>');
  return lines.filter((line) => line !== undefined).join('\n');
}

export function buildButtons(lot, meta = {}) {
  const links = itemLinks(lot.item_id);
  const rows = [[
    { text: '🌐 Сайт', url: links.web },
    { text: '📱 Мобильная', url: links.h5 },
  ]];
  if (meta.runId) rows.push([{ text: '📄 JSON прогона', callback_data: 'json:' + meta.runId }]);
  return { inline_keyboard: rows };
}

export function buildResultPlan(result, meta = {}, photosByItem = {}) {
  const top = Array.isArray(result.top) ? result.top : [];
  const summary = String(result.summary_ru || '').trim();
  const header = top.length
    ? '<b>Нашёл ' + top.length + ' вариант' + (top.length === 1 ? '' : top.length < 5 ? 'а' : 'ов') + '</b>' + (summary ? '\n\n' + escapeHtml(summary) : '')
    : '<b>Подходящих лотов нет</b>' + (summary ? '\n\n' + escapeHtml(summary) : '');

  const maxPhotos = Math.max(0, Math.min(Number(meta.maxPhotos) || 4, 8));
  const lots = top.map((lot, index) => {
    const photos = (photosByItem[lot.item_id] || [])
      .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
      .slice(0, maxPhotos);
    return {
      lot,
      text: buildLotCardHtml(lot, index + 1, meta),
      photos,
      buttons: buildButtons(lot),
    };
  });

  const stats = result.stats || {};
  const footerLines = [];
  if (meta.rate) footerLines.push('Курс ' + meta.rate + ' ₽/¥ · комиссия ' + meta.commissionPercent + '% (мин. ' + meta.commissionMin + ' ₽)');
  footerLines.push(
    'Найдено: ' + (stats.found === null || stats.found === undefined ? '—' : stats.found) +
      ' · карточек: ' + (stats.after_card_filter === null || stats.after_card_filter === undefined ? '—' : stats.after_card_filter) +
      ' · вызовов: ' + (stats.tool_calls === null || stats.tool_calls === undefined ? '—' : stats.tool_calls) +
      (meta.durationMs ? ' · ' + Math.round(meta.durationMs / 1000) + ' с' : ''),
  );
  if (meta.warnings && meta.warnings.length) footerLines.push('⚠️ ' + meta.warnings.join('; '));
  if (lots.some((entry) => entry.photos.length)) {
    footerLines.push(
      meta.photoMode === 'vision'
        ? 'Фото выше переданы модели для проверки.'
        : 'Фото выше — для ручной проверки; модель их не анализировала.',
    );
  }
  if (top.length) {
    footerLines.push('Сайт и мобильная версия — в кнопках, «В приложении» открывает Xianyu. Если браузер Telegram блокирует Goofish — ⋯ → «Открыть в браузере».');
  }
  footerLines.push('Состояние подтверждается только карточкой, отзывами и фото. Это не покупка.');
  if (!top.length && meta.provider === 'mock') footerLines.push('Демо-режим: реальный Goofish не запрашивался.');

  return {
    header,
    lots,
    footer: escapeHtml(footerLines.join('\n')),
    footerButtons: meta.runId ? { inline_keyboard: [[{ text: '📄 JSON прогона', callback_data: 'json:' + meta.runId }]] } : null,
  };
}

// Оставлено для обратной совместимости с CLI/тестами.
export function buildResultMessages(result, meta = {}) {
  const plan = buildResultPlan(result, meta, {});
  return [plan.header, ...plan.lots.map((lot) => lot.text), plan.footer];
}

export function progressText(event) {
  if (!event || !event.type) return null;
  if (event.type === 'llm_request') return '⏳ Шаг ' + event.step + ' · вызовов: ' + event.used + '/' + event.max;
  if (event.type === 'tool') {
    const args = event.args || {};
    switch (event.name) {
      case 'goofish_search':
        return '🔍 Ищу: ' + (args.keyword || '…');
      case 'goofish_item':
        return '📋 Проверяю карточку ' + (args.item_id || '…');
      case 'goofish_seller':
        return '👤 Смотрю продавца ' + (args.seller_id || '…');
      case 'goofish_reviews':
        return '💬 Читаю отзывы ' + (args.seller_id || '…');
      case 'view_images':
        return '🖼 Смотрю фото';
      case 'calc_price':
        return '🧮 Считаю итоговую цену';
      case 'finish':
        return '✅ Проверяю итог';
      default:
        return '⚙️ ' + event.name;
    }
  }
  return null;
}
