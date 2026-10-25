import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOFISH_KINDS,
  GoofishError,
  classifyGoofishError,
  formatRetryAfter,
  toGoofishError,
} from '../src/goofish/errors.js';

test('RGV587 классифицируется как risk_control', () => {
  const info = classifyGoofishError(new Error('mtop x: FAIL_SYS_USER_VALIDATE; RGV587_ERROR::SM'));
  assert.equal(info.kind, GOOFISH_KINDS.RATE_LIMIT);
  assert.equal(info.code, 'risk_control');
});

test('капча и истёкшая сессия различаются', () => {
  assert.equal(classifyGoofishError(new Error('FAIL_SYS_USER_VALIDATE')).kind, GOOFISH_KINDS.NEEDS_VERIFICATION);
  assert.equal(classifyGoofishError(new Error('FAIL_SYS_SESSION_EXPIRED')).kind, GOOFISH_KINDS.SESSION_EXPIRED);
  assert.equal(classifyGoofishError(new Error('FAIL_SYS_TOKEN_EXOIRED')).kind, GOOFISH_KINDS.TOKEN_REFRESHABLE);
});

test('сеть и not found', () => {
  assert.equal(classifyGoofishError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })).kind, GOOFISH_KINDS.TRANSIENT_NETWORK);
  assert.equal(classifyGoofishError(new Error('item not found')).kind, GOOFISH_KINDS.NOT_FOUND);
});

test('toGoofishError сохраняет code и scope', () => {
  const err = toGoofishError(new Error('RGV587'), { scope: 'item', accountId: 'a1' });
  assert.ok(err instanceof GoofishError);
  assert.equal(err.code, 'risk_control');
  assert.equal(err.scope, 'item');
  assert.equal(err.accountId, 'a1');
  assert.match(formatRetryAfter(30 * 60 * 1000), /мин|ч/);
});
