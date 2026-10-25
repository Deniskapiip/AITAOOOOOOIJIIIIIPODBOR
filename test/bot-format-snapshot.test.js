import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultPlan } from '../src/bot/format.js';
import { baseResult } from './helpers.js';

test('snapshot: обычный план без курса и без фото', () => {
  const result = baseResult();
  result.top = result.top.slice(0, 1);
  result.top[0].final_price_rub = null;
  result.top[0].card.title = 'Xiaomi <script>alert(1)</script> 15 Ultra';
  const plan = buildResultPlan(result, { rate: null, photoMode: 'off', maxPhotos: 4, runId: 'r1' }, {});
  assert.match(plan.header, /Нашёл 1 вариант/);
  assert.match(plan.lots[0].text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!plan.footer.includes('12'));
  assert.ok(!plan.footer.includes('6,5'));
  assert.match(plan.footer, /JSON|Состояние|Сайт/);
});

test('snapshot: пустой top и отсутствие курса', () => {
  const result = baseResult();
  result.top = [];
  result.summary_ru = 'Подходящих лотов нет.';
  const plan = buildResultPlan(result, { rate: null, photoMode: 'vision', runId: 'r2' }, {});
  assert.match(plan.header, /Подходящих лотов нет/);
  assert.equal(plan.lots.length, 0);
  assert.ok(plan.footer.includes('Найдено'));
});

test('snapshot: три лота и фото-режим', () => {
  const result = baseResult();
  result.top = [result.top[0], result.top[1], { ...result.top[1], rank: 3, item_id: '812345678999' }];
  const plan = buildResultPlan(result, { photoMode: 'vision', maxPhotos: 2, runId: 'r3' }, {
    '812345678901': ['https://x/1.jpg', 'https://x/2.jpg'],
    '812345678915': ['https://x/3.jpg'],
  });
  assert.equal(plan.lots.length, 3);
  assert.equal(plan.lots[0].photos.length, 2);
  assert.equal(plan.lots[1].photos.length, 1);
  assert.match(plan.footer, /Фото выше переданы модели/);
});
