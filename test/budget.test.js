import test from 'node:test';
import assert from 'node:assert/strict';
import { Budget, STAGE_LIMITS } from '../src/tools/budget.js';

test('лимит этапа поиск = 9', () => {
  const budget = new Budget(45);
  assert.equal(STAGE_LIMITS.goofish_search, 9);
  for (let i = 0; i < 9; i += 1) {
    assert.equal(budget.canCall('goofish_search').ok, true);
    budget.record('goofish_search');
  }
  const denied = budget.canCall('goofish_search');
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /лимит этапа/);
  assert.equal(budget.canCall('finish').ok, true);
});

test('finish считается в общий лимит и вызывается один раз', () => {
  const budget = new Budget(10);
  assert.equal(budget.canCall('finish').ok, true);
  budget.record('finish');
  assert.equal(budget.used, 1);
  assert.equal(budget.canCall('finish').ok, false);
});

test('под finish всегда остаётся слот', () => {
  const budget = new Budget(3);
  budget.record('goofish_search');
  assert.equal(budget.canCall('goofish_search').ok, true);
  budget.record('goofish_search');
  const denied = budget.canCall('goofish_seller');
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /резерв только под finish/);
  assert.equal(budget.canCall('finish').ok, true);
});

test('лимиты этапов соответствуют таблице', () => {
  assert.deepEqual(STAGE_LIMITS, {
    calc_price: 2,
    goofish_search: 9,
    goofish_item: 15,
    goofish_seller: 8,
    goofish_reviews: 4,
    view_images: 4,
    finish: 1,
  });
  const sum = Object.values(STAGE_LIMITS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 43);
});
