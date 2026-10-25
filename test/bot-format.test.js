import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultMessages, escapeHtml, progressText } from '../src/bot/format.js';
import { baseResult } from './helpers.js';

test('HTML экранируется', () => {
  assert.equal(escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
});

test('результат менеджера: заголовок, карточки, футер', () => {
  const messages = buildResultMessages(baseResult(), {
    rate: 12,
    commissionPercent: 6.5,
    commissionMin: 650,
    durationMs: 42000,
    warnings: ['курс проверен вручную'],
  });
  assert.equal(messages.length, 4);
  assert.match(messages[0], /Итог: 2/);
  assert.match(messages[1], /1\. Xiaomi 15 Ultra 16\/512/);
  assert.match(messages[1], /4580 ¥ \| 58 533 ₽/);
  assert.match(messages[3], /Курс: 12/);
  assert.match(messages[3], /вызовов: 10/);
  assert.match(messages[3], /курс проверен вручную/);
});

test('пустой top объясняет причину без фиктивных лотов', () => {
  const result = baseResult();
  result.top = [];
  result.summary_ru = 'Подходящих лотов нет: все варианты с ремонтом.';
  const messages = buildResultMessages(result, {});
  assert.match(messages[0], /подходящих лотов нет/i);
  assert.equal(messages.length, 2);
});

test('прогресс описывает этапы', () => {
  assert.match(progressText({ type: 'tool', name: 'goofish_search', args: { keyword: '小米15' } }), /Ищу: 小米15/);
  assert.match(progressText({ type: 'tool', name: 'view_images', args: {} }), /Смотрю фото/);
  assert.match(progressText({ type: 'llm_request', step: 2, used: 5, max: 45 }), /5\/45/);
  assert.equal(progressText(null), null);
});
