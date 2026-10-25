import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultPlan, buildButtons, itemLinks, escapeHtml, progressText } from '../src/bot/format.js';
import { baseResult } from './helpers.js';

test('HTML экранируется', () => {
  assert.equal(escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
});

test('ссылки: сайт, H5 и приложение', () => {
  const links = itemLinks('812345678901');
  assert.equal(links.web, 'https://www.goofish.com/item?id=812345678901');
  assert.equal(links.h5, 'https://h5.m.goofish.com/item?id=812345678901');
  assert.match(links.app, /^fleamarket:\/\/awesome_detail\?itemId=812345678901/);
});

test('план результата: заголовок, HTML-карточки, фото, кнопки, футер', () => {
  const plan = buildResultPlan(
    baseResult(),
    { rate: 12, commissionPercent: 6.5, commissionMin: 650, runId: 'run-1', maxPhotos: 4 },
    { 812345678901: ['https://img.example/1.jpg', 'https://img.example/2.jpg'] },
  );
  assert.equal(plan.lots.length, 2);
  assert.match(plan.header, /Нашёл 2/);
  assert.match(plan.header, /Лучший вариант/);
  assert.match(plan.lots[0].text, /<b>1\. Xiaomi 15 Ultra/);
  assert.match(plan.lots[0].text, /4 580 ¥/);
  assert.match(plan.lots[0].text, /58 533 ₽/);
  assert.match(plan.lots[0].text, /item\?id=812345678901/);
  assert.equal(plan.lots[0].photos.length, 2);
  assert.equal(plan.lots[1].photos.length, 0);
  assert.equal(plan.lots[0].buttons.inline_keyboard[0][0].url, 'https://www.goofish.com/item?id=812345678901');
  assert.equal(plan.footerButtons.inline_keyboard[0][0].callback_data, 'json:run-1');
  assert.ok(!plan.footer.includes('Курс'));
  assert.ok(!plan.footer.includes('комиссия'));
});

test('фото ограничиваются maxPhotos', () => {
  const photos = ['https://img.example/1.jpg', 'https://img.example/2.jpg', 'https://img.example/3.jpg'];
  const plan = buildResultPlan(baseResult(), { maxPhotos: 1 }, { 812345678901: photos });
  assert.equal(plan.lots[0].photos.length, 1);
});

test('без лотов показывает причину', () => {
  const result = baseResult();
  result.top = [];
  result.summary_ru = 'Подходящих лотов нет: всё с ремонтом.';
  const plan = buildResultPlan(result, { provider: 'http' }, {});
  assert.match(plan.header, /Подходящих лотов нет/);
  assert.equal(plan.lots.length, 0);
});

test('кнопки карточки без JSON', () => {
  const buttons = buildButtons({ item_id: '1' });
  assert.equal(buttons.inline_keyboard.length, 1);
  assert.equal(buttons.inline_keyboard[0].length, 2);
  assert.equal(buttons.inline_keyboard[0][0].url, 'https://www.goofish.com/item?id=1');
});

test('прогресс описывает этапы', () => {
  assert.match(progressText({ type: 'tool', name: 'goofish_search', args: { keyword: '小米15' } }), /Ищу: 小米15/);
  assert.match(progressText({ type: 'tool', name: 'view_images', args: {} }), /Смотрю фото/);
  assert.match(progressText({ type: 'llm_request', step: 2, used: 5, max: 45 }), /5\/45/);
  assert.equal(progressText(null), null);
});
