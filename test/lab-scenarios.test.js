import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateScenarios, TRAP_IDS } from '../src/lab/scenarios.js';
import { validateCatalog, validateScenario } from '../src/lab/schema.js';

const dir = path.join(process.cwd(), 'test', 'fixtures', 'lab', 'scenarios');
const scenarios = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

test('лаборатория: 42 сценария, 7 категорий, все ловушки покрыты', () => {
  assert.ok(scenarios.length >= 40);
  const errors = validateCatalog(scenarios);
  assert.deepEqual(errors, []);
  const categories = new Set(scenarios.map((s) => s.category));
  assert.equal(categories.size, 7);
  assert.ok(TRAP_IDS.every((id) => scenarios.some((s) => s.traps.includes(id))));
});

test('лаборатория: все сценарии валидны и содержат truth', () => {
  for (const s of scenarios) {
    assert.deepEqual(validateScenario(s), [], s.id);
    assert.ok(Object.keys(s.provider_data.items).length >= 8);
    assert.ok(s.expected.notes.length > 5);
    for (const list of Object.values(s.images)) {
      for (const image of list) assert.ok(fs.existsSync(path.join(process.cwd(), image.file)), image.file);
    }
  }
});

test('лаборатория: генератор детерминирован', () => {
  const a = generateScenarios(42);
  const b = generateScenarios(42);
  assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id));
  assert.equal(a.length, 42);
});

test('лаборатория: битый сценарий отклоняется', () => {
  const s = JSON.parse(JSON.stringify(scenarios[0]));
  s.provider_data.search = [];
  assert.ok(validateScenario(s).length > 0);
});
