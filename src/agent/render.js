export function formatCny(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : String(n);
}

export function formatRub(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat('ru-RU').format(Number(value)).replace(/\u00A0/g, ' ');
}

export function priceLine(lot) {
  const cny = formatCny(lot.price_cny) + ' ¥';
  const rub = formatRub(lot.final_price_rub);
  if (rub === null) return cny + ' | ₽ — курс не задан';
  return cny + ' | ' + rub + ' ₽';
}

export function renderLotCard(lot, index) {
  const lines = [];
  const title = lot && lot.card && lot.card.title ? lot.card.title : 'Без названия';
  lines.push((index || lot.rank || 1) + '. ' + title);
  if (lot && lot.card && lot.card.description) lines.push(lot.card.description);
  const condition = lot && lot.card && Array.isArray(lot.card.condition_lines) ? lot.card.condition_lines : [];
  for (const line of condition) lines.push(line);
  lines.push(priceLine(lot || {}));
  return lines.join('\n');
}

export function renderAllCards(result) {
  const top = result && Array.isArray(result.top) ? result.top : [];
  return top.map((lot, i) => renderLotCard(lot, i + 1)).join('\n\n');
}

export function renderShortSummary(result) {
  const top = result && Array.isArray(result.top) ? result.top : [];
  if (!top.length) return 'Подходящих лотов не найдено.';
  return top.map((lot, i) => (i + 1) + '. ' + (lot.card ? lot.card.title : lot.item_id) + ' — ' + priceLine(lot)).join('\n');
}
