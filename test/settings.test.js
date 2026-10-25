import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SettingsStore, SettingsError } from '../src/store/settings.js';
import { silentLogger, tempDir } from './helpers.js';

test('значения по умолчанию: курса нет, комиссия 6.5/650', () => {
  const store = new SettingsStore(tempDir(), silentLogger());
  const s = store.get();
  assert.equal(s.rate_cny_rub, null);
  assert.equal(store.hasRate(), false);
  assert.equal(s.commission_percent, 6.5);
  assert.equal(s.commission_min_rub, 650);
});

test('курс из окружения подхватывается как стартовый', () => {
  const dir = tempDir();
  const store = new SettingsStore(dir, silentLogger(), { rate_cny_rub: 12.4, commission_percent: 6.5, commission_min_rub: 650 });
  assert.equal(store.hasRate(), true);
  assert.equal(store.get().rate_cny_rub, 12.4);
});

test('файл настроек переживает перезапуск и перекрывает окружение', () => {
  const dir = tempDir();
  const first = new SettingsStore(dir, silentLogger(), { rate_cny_rub: 12, commission_percent: 6.5, commission_min_rub: 650 });
  first.setRate(13.1, 'test-admin');
  const second = new SettingsStore(dir, silentLogger(), { rate_cny_rub: 10 });
  assert.equal(second.get().rate_cny_rub, 13.1);
  assert.equal(second.get().updated_by, 'test-admin');
  assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
});

test('некорректный курс отклоняется', () => {
  const store = new SettingsStore(tempDir(), silentLogger());
  assert.throws(() => store.setRate(0, 'test'), SettingsError);
  assert.throws(() => store.setRate(1000, 'test'), SettingsError);
  assert.throws(() => store.setRate(Number.NaN, 'test'), SettingsError);
  assert.equal(store.get().rate_cny_rub, null);
});

test('комиссия и минимум валидируются', () => {
  const store = new SettingsStore(tempDir(), silentLogger());
  assert.throws(() => store.setCommission(80, 650, 'test'), SettingsError);
  assert.throws(() => store.setCommission(6.5, -1, 'test'), SettingsError);
  const updated = store.setCommission(7, 700, 'test');
  assert.equal(updated.commission_percent, 7);
  assert.equal(updated.commission_min_rub, 700);
});
