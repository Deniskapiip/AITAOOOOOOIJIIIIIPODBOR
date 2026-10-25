import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMessages } from '../src/agent/prompt.js';
import { loadPlaybook, selectCategory, buildPlaybookBlock } from '../src/agent/playbooks.js';

const settings = { commission_percent: 6.5, commission_min_rub: 650 };

test('playbook: категории определяются детерминированно', () => {
  assert.equal(selectCategory('iPhone 14 Pro 256G'), 'smartphone');
  assert.equal(selectCategory('MacBook Pro 14 M3'), 'laptop');
  assert.equal(selectCategory('Sony A7M4 body'), 'camera');
  assert.equal(selectCategory('RTX 4070 Ti Super'), 'pc_parts');
  assert.equal(selectCategory('PlayStation 5 Slim'), 'console');
  assert.equal(selectCategory('AirPods Pro 2'), 'audio');
  assert.equal(selectCategory('iPad Pro 11 M2'), 'tablet');
  assert.equal(selectCategory('неизвестный товар'), 'generic');
});

test('playbook: все 7 категорий есть и не раздуты', () => {
  for (const id of ['smartphone', 'laptop', 'camera', 'pc_parts', 'console', 'audio', 'tablet']) {
    const text = loadPlaybook(id);
    assert.ok(text.length > 100, id);
    assert.ok(text.length < 3500, id + ' слишком длинный');
    for (const heading of ['## Идентификация', '## Обязательные проверки', '## Вопросы продавцу']) {
      assert.ok(text.includes(heading), id + ' нет ' + heading);
    }
    assert.ok(!/игнорируй стоп|отмени стоп|ослабь/i.test(text));
  }
});

test('playbook: блок попадает в task_context', () => {
  const block = buildPlaybookBlock('iPhone 14 Pro 256G');
  assert.match(block, /<playbook category="smartphone">/);
  const messages = buildMessages({ query: 'iPhone 14 Pro 256G до 4300', settings });
  assert.match(messages[1].content, /<task_context>/);
  assert.match(messages[1].content, /<playbook category="smartphone">/);
  assert.equal(messages.length, 2);
});
