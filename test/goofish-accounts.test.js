import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../src/goofish/accounts.js';
import { GOOFISH_KINDS } from '../src/goofish/errors.js';
import { tempDir } from './helpers.js';

function makeStore(nowRef, options = {}) {
  return new AccountStore({
    dataDir: tempDir(),
    cookie: 'unb=1; _m_h5_tk=abc_123; cookie2=x',
    dailyLimit: options.dailyLimit || 5,
    now: () => nowRef.value,
    ...options,
  });
}

test('аккаунт из cookie выбирается и считает вызовы', () => {
  const nowRef = { value: Date.parse('2026-01-01T00:00:00Z') };
  const store = makeStore(nowRef);
  const account = store.pick('item');
  assert.ok(account);
  assert.equal(account.id, 'default');
  store.markCall(account.id);
  assert.equal(store.list()[0].calls_today, 1);
});

test('RGV на карточке блокирует item, но не поиск', () => {
  const nowRef = { value: Date.parse('2026-01-01T00:00:00Z') };
  const store = makeStore(nowRef);
  const account = store.pick('item');
  store.reportRisk(account.id, { kind: GOOFISH_KINDS.RATE_LIMIT, message: 'RGV587' }, 'item');

  assert.equal(store.pick('item'), null);
  assert.ok(store.pick('search'));
  assert.equal(store.health().item_available, false);
  assert.equal(store.health().search_available, true);
  assert.ok(store.nextAvailableAt('item') > nowRef.value);

  nowRef.value += 31 * 60 * 1000;
  assert.ok(store.pick('item'));
});

test('cooldown эскалируется, success сбрасывает', () => {
  const nowRef = { value: Date.parse('2026-01-01T00:00:00Z') };
  const store = makeStore(nowRef);
  const account = store.pick('item');
  store.reportRisk(account.id, { kind: GOOFISH_KINDS.RATE_LIMIT }, 'item');
  const first = new Date(store.list()[0].item_cooldown_until).getTime() - nowRef.value;
  store.reportRisk(account.id, { kind: GOOFISH_KINDS.RATE_LIMIT }, 'item');
  const second = new Date(store.list()[0].item_cooldown_until).getTime() - nowRef.value;
  assert.ok(second > first);
  store.reportSuccess(account.id, 'item');
  assert.equal(store.list()[0].strikes, 0);
  assert.ok(store.pick('item'));
});

test('новый cookie сбрасывает статус', () => {
  const nowRef = { value: Date.parse('2026-01-01T00:00:00Z') };
  const store = makeStore(nowRef);
  const account = store.pick('item');
  store.reportRisk(account.id, { kind: GOOFISH_KINDS.NEEDS_VERIFICATION }, 'item');
  assert.equal(store.health().item_available, false);
  const updated = store.setCookie('unb=2; _m_h5_tk=new_1');
  assert.equal(updated.status, 'ok');
  assert.ok(store.pick('item'));
});

test('дневной лимит останавливает выбор', () => {
  const nowRef = { value: Date.parse('2026-01-01T00:00:00Z') };
  const store = makeStore(nowRef, { dailyLimit: 1 });
  const account = store.pick('search');
  store.markCall(account.id);
  assert.equal(store.pick('search'), null);
});
