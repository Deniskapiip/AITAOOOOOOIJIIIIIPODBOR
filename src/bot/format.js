import { renderLotCard } from '../agent/render.js';

export function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatRub(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat('ru-RU').format(Number(value)).replace(/\u00A0/g, ' ');
}

const VERDICT_LABEL = { брать: '🟢 брать', проверить: '🟡 проверить', пропустить: '⚪ пропустить' };

export function buildResultMessages(result, meta = {}) {
  const messages = [];
  const top = Array.isArray(result.top) ? result.top : [];
  const summary = String(result.summary_ru || '').trim();
  const header = top.length
    ? '<b>Итог: ' + top.length + ' вариант(а/ов)</b>'
    : '<b>Итог: подходящих лотов нет</b>';
  messages.push(header + (summary ? '\n\n' + escapeHtml(summary) : ''));

  top.forEach((lot, index) => {
    const card = renderLotCard(lot, index + 1);
    const seller = lot.seller || {};
    const meta2 = [
      VERDICT_LABEL[lot.verdict] || lot.verdict,
      lot.score + '/100',
      lot.confidence,
      lot.price_vs_market && lot.price_vs_market.comparable_count
        ? 'сопоставимых: ' + lot.price_vs_market.comparable_count
        : 'сравнение ограничено',
    ].join(' · ');
    const link = lot.url ? '<a href="' + escapeHtml(lot.url) + '">Открыть лот</a>' : '';
    const text =
      '<pre>' + escapeHtml(card) + '</pre>' +
      '\n' + meta2 +
      (link ? ' · ' + link : '');
    messages.push(text);
  });

  const footerLines = [];
  if (meta.rate) footerLines.push('Курс: ' + meta.rate + ' ₽/¥ · комиссия ' + meta.commissionPercent + '% (мин. ' + meta.commissionMin + ' ₽)');
  const stats = result.stats || {};
  footerLines.push(
    'Найдено: ' + stats.found + ' · после фильтра: ' + stats.after_title_filter + ' · карточек: ' + stats.after_card_filter + ' · вызовов: ' + stats.tool_calls,
  );
  if (meta.durationMs) footerLines.push('Время: ' + Math.round(meta.durationMs / 1000) + ' с');
  if (meta.warnings && meta.warnings.length) footerLines.push('⚠️ ' + meta.warnings.join('; '));
  if (meta.provider === 'mock') {
    footerLines.push('⚠️ Демо-режим: тестовые объявления, реальный Goofish не запрашивался.');
    if (!top.length) footerLines.push('В демо-базе этой модели нет. Для реального поиска нужны GOOFISH_COOKIE и прокси.');
  }
  if (top.length) {
    footerLines.push('Цена проверяется только по объявлению и фото. Это не покупка и не гарантия состояния.');
  } else if (meta.provider !== 'mock') {
    footerLines.push('Попробуй расширить бюджет или изменить требования.');
  }
  messages.push(escapeHtml(footerLines.join('\n')));
  return messages;
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
