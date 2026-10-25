import test from 'node:test';
import assert from 'node:assert/strict';
import { Budget } from '../src/tools/budget.js';

test('невалидный finish можно исправить, но не бесконечно', () => {
  const budget = new Budget(45);
  assert.equal(budget.canCall('finish').ok, true);
  budget.record('finish');
  budget.finishInvalid = true;
  assert.equal(budget.canCall('finish').ok, true);
  budget.record('finish');
  assert.equal(budget.canCall('finish').ok, true);
  budget.record('finish');
  const denied = budget.canCall('finish');
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /3 раза/);
});
