import test from 'node:test';
import assert from 'node:assert/strict';
import { calcPrice } from '../src/tools/pricing.js';

const settings = { rate_cny_rub: 12, commission_percent: 6.5, commission_min_rub: 650 };

test('цена 1000 ¥ при курсе 12', () => {
  const res = calcPrice({ items: [{ item_id: '1', price_cny: 1000 }] }, settings);
  assert.equal(res.rate_cny_rub, 12);
  assert.deepEqual(res.results[0], { item_id: '1', base_rub: 12000, commission_rub: 780, final_rub: 12780 });
});

test('минимальная комиссия 650 ₽', () => {
  const res = calcPrice({ items: [{ item_id: '1', price_cny: 500 }] }, settings);
  assert.equal(res.results[0].base_rub, 6000);
  assert.equal(res.results[0].commission_rub, 650);
  assert.equal(res.results[0].final_rub, 6650);
});

test('бюджет в рублях пересчитывается в юани вниз', () => {
  const res = calcPrice({ budget_rub: 50000, items: [] }, settings);
  assert.equal(res.budget_cny, 4166);
  assert.deepEqual(res.results, []);
});

test('без курса возвращается rate_unavailable и никаких сумм', () => {
  const res = calcPrice({ budget_rub: 50000, items: [{ item_id: '1', price_cny: 100 }] }, { ...settings, rate_cny_rub: null });
  assert.deepEqual(res, { error: 'rate_unavailable' });
});

test('цены округляются вверх', () => {
  const res = calcPrice({ items: [{ item_id: '1', price_cny: 10.01 }] }, { ...settings, rate_cny_rub: 12.345 });
  assert.equal(res.results[0].base_rub, Math.ceil(10.01 * 12.345));
  assert.equal(res.results[0].commission_rub, Math.ceil(Math.max(res.results[0].base_rub * 0.065, 650)));
});
