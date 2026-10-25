import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../src/goofish/cache.js';
import { RateLimiter } from '../src/goofish/limiter.js';

test('TTL-кэш отдаёт значение до истечения и удаляет после', () => {
  let now = 1000;
  const cache = new TtlCache({ ttlMs: 100, now: () => now });
  cache.set('a', { x: 1 });
  assert.deepEqual(cache.get('a'), { x: 1 });
  assert.equal(cache.get('missing'), undefined);
  now += 101;
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.stats().size, 0);
});

test('лимитер ждёт до интервала', async () => {
  let now = 0;
  const sleeps = [];
  const limiter = new RateLimiter({
    minIntervalMs: 1500,
    jitterMs: 0,
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
  });
  await limiter.wait();
  now += 200;
  await limiter.wait();
  assert.equal(sleeps.length, 2);
  assert.equal(sleeps[1], 1300);
});
