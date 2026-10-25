import test from 'node:test';
import assert from 'node:assert/strict';
import { priceLine, renderLotCard, renderAllCards, formatRub } from '../src/agent/render.js';
import { baseResult } from './helpers.js';

test('строка цены: юани и рубли', () => {
  assert.equal(priceLine({ price_cny: 4580, final_price_rub: 58533 }), '4580 ¥ | 58 533 ₽');
  assert.equal(priceLine({ price_cny: 1400, final_price_rub: 17892 }), '1400 ¥ | 17 892 ₽');
});

test('без курса рубли не выдумываются', () => {
  assert.match(priceLine({ price_cny: 1000, final_price_rub: null }), /курс не задан/);
});

test('карточка менеджера собирается в нужном порядке', () => {
  const lot = baseResult().top[0];
  const card = renderLotCard(lot, 1);
  const lines = card.split('\n');
  assert.equal(lines[0], '1. Xiaomi 15 Ultra 16/512');
  assert.equal(lines[1], 'Частник, полный комплект, отправка по Китаю');
  assert.equal(lines[2], 'АКБ 97% (по фото)');
  assert.equal(lines.at(-1), '4580 ¥ | 58 533 ₽');
  assert.equal(formatRub(58533), '58 533');
});

test('все карточки разделены пустой строкой', () => {
  const result = baseResult();
  const text = renderAllCards(result);
  assert.ok(text.includes('\n\n2. Xiaomi 15 Ultra 16/512'));
});
