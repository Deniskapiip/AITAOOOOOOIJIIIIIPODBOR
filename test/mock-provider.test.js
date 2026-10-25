import test from 'node:test';
import assert from 'node:assert/strict';
import { MockGoofishProvider } from '../src/goofish/mock.js';

const provider = new MockGoofishProvider({});

test('поиск по ключу находит лоты и умеет фильтровать цену', async () => {
  const all = await provider.search({ keyword: '小米15 Ultra 512G' });
  assert.ok(all.total >= 15);
  const withShops = await provider.search({ keyword: '小米15 Ultra 512G', personalOnly: false });
  assert.ok(withShops.total > all.total);
  assert.ok(all.items.every((i) => !i.item_id.startsWith('812345678905')));
  const filtered = await provider.search({ keyword: '小米15 Ultra 512G', priceMin: 4000, priceMax: 5000 });
  assert.ok(filtered.items.every((i) => i.price_cny >= 4000 && i.price_cny <= 5000));
  assert.ok(filtered.items.some((i) => i.item_id === '812345678901'));
});

test('сортировка по цене возрастает', async () => {
  const data = await provider.search({ keyword: '小米15 Ultra', sort: 'price_asc' });
  const prices = data.items.map((i) => i.price_cny);
  assert.deepEqual(prices, prices.slice().sort((a, b) => a - b));
});

test('карточка лота содержит описание, доставку и фото', async () => {
  const item = await provider.item('812345678901');
  assert.equal(item.price_cny, 4580);
  assert.equal(item.status, 'active');
  assert.ok(item.image_urls.length >= 3);
  assert.equal(item.delivery.mode, '包邮');
  assert.match(item.description, /无拆无修/);
});

test('несуществующий лот даёт item_not_found', async () => {
  await assert.rejects(() => provider.item('000'), /не найден/);
});

test('профиль продавца и отзывы', async () => {
  const seller = await provider.seller('s_a');
  assert.equal(seller.zhima_credit, 780);
  assert.equal(seller.verified, true);
  const reviews = await provider.reviews('s_h');
  assert.ok(reviews.reviews.some((r) => r.text.includes('骗子')));
});
