export function roundCny(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

// Единственный источник рублёвых сумм: курс и комиссия берутся только из настроек.
export function calcPrice(input, settings) {
  const rate = Number(settings.rate_cny_rub);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { error: 'rate_unavailable' };
  }
  const budgetRub = input && input.budget_rub !== undefined && input.budget_rub !== null ? Number(input.budget_rub) : null;
  const items = Array.isArray(input && input.items) ? input.items : [];
  const results = items.map((item) => {
    const price = roundCny(item.price_cny);
    if (price === null) throw new Error('Некорректная цена price_cny для лота ' + String(item.item_id));
    const baseRub = Math.ceil(price * rate);
    const commissionRub = Math.ceil(
      Math.max((baseRub * settings.commission_percent) / 100, settings.commission_min_rub),
    );
    return {
      item_id: String(item.item_id),
      base_rub: baseRub,
      commission_rub: commissionRub,
      final_rub: baseRub + commissionRub,
    };
  });
  return {
    rate_cny_rub: rate,
    budget_cny: budgetRub !== null && Number.isFinite(budgetRub) ? Math.floor(budgetRub / rate) : null,
    results,
  };
}
