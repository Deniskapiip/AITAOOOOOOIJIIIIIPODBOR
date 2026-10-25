import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scoreScenario, aggregateScores } from '../src/lab/score.js';

const dir = path.join(process.cwd(), 'test', 'fixtures', 'lab', 'scenarios');
const scenarios = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const scenario = scenarios.find((s) => s.expected.top_must_include.length);
const settings = { rate_cny_rub: 12, commission_percent: 6.5, commission_min_rub: 650 };

function lotFor(itemId, overrides = {}) {
  const item = scenario.provider_data.items[itemId];
  const base = Math.ceil(Number(item.price_cny) * settings.rate_cny_rub);
  const commission = Math.ceil(Math.max((base * settings.commission_percent) / 100, settings.commission_min_rub));
  return {
    item_id: itemId,
    price_cny: item.price_cny,
    base_price_rub: base,
    commission_rub: commission,
    final_price_rub: base + commission,
    verdict: 'проверить',
    photo_check: { verdict: 'не проверялось', defects: [], mismatch: [] },
    red_flags: [],
    why_good: [],
    ...overrides,
  };
}

test('score: безопасный golden проходит', () => {
  const id = scenario.expected.top_must_include[0];
  const result = { top: [lotFor(id, { verdict: 'брать', photo_check: { verdict: 'ок', defects: [], mismatch: [] } })] };
  const score = scoreScenario({ scenario, result, calls: 20, finishAttempts: 1, trace: [], settings });
  assert.equal(score.metrics.safety_pass, true);
  assert.equal(score.metrics.gold_recall, 1);
  assert.deepEqual(score.failures, []);
});

test('score: стоп-фактор и превышение бюджета ловятся', () => {
  const badId = Object.keys(scenario.expected.stop_factor_ids)[0];
  const over = scenario.expected.top_must_exclude.find((id) => !scenario.expected.stop_factor_ids[id]) || badId;
  const result = { top: [lotFor(badId, { photo_check: { verdict: 'ок' } }), lotFor(over, { price_cny: scenario.budget_cny * 1.2 })] };
  const score = scoreScenario({ scenario, result, calls: 40, finishAttempts: 2, trace: [{ method: 'item', key: badId }, { method: 'item', key: badId }], settings });
  assert.ok(score.failures.some((x) => x.startsWith('stop_factor')));
  assert.ok(score.failures.some((x) => x.startsWith('over_budget')));
  assert.ok(score.failures.includes('finish_retry'));
  assert.ok(score.failures.some((x) => x.startsWith('duplicate_item_calls')));
});

test('score: брать без фото и фото-утверждение ловятся', () => {
  const id = scenario.expected.top_must_include[0];
  const result = { top: [lotFor(id, { verdict: 'брать', photo_check: { verdict: 'не проверялось' }, why_good: ['на фото видно чистый экран'] })] };
  const score = scoreScenario({ scenario, result, calls: 10, finishAttempts: 1, trace: [], settings });
  assert.ok(score.failures.some((x) => x.startsWith('buy_without_photo')));
  assert.ok(score.failures.some((x) => x.startsWith('unsupported_photo_claims')));
});

test('score: агрегат считает ворота', () => {
  const id = scenario.expected.top_must_include[0];
  const good = scoreScenario({ scenario, result: { top: [lotFor(id, { verdict: 'брать', photo_check: { verdict: 'ок' } })] }, calls: 20, settings });
  const agg = aggregateScores([good]);
  assert.equal(agg.scenarios, 1);
  assert.equal(agg.safety_pass_rate, 1);
  assert.equal(agg.stop_in_top, 0);
});
