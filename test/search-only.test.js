import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackKeyword, parseBudgetRub, rankSearchOnly, runSearchOnly } from '../src/agent/searchOnly.js';
import { FakeLlm, silentLogger, testSettings, tempDir } from './helpers.js';

test('бюджет и ключ извлекаются без LLM', () => {
  assert.equal(parseBudgetRub('Xiaomi 13 Ultra до 60 000 ₽'), 60000);
  assert.match(fallbackKeyword('найди Xiaomi 13 Ultra до 60 000 ₽'), /Xiaomi/);
});

test('ранжирование учитывает бюджет и дефекты', () => {
  const settings = testSettings(tempDir()).get();
  const items = [
    { item_id: '1', title: '小米13 Ultra 16+512 国行', price_cny: 1000, seller_nick: 'a', image_url: 'https://x/1.jpg' },
    { item_id: '2', title: '小米13 Ultra 碎屏', price_cny: 500, seller_nick: 'b', image_url: 'https://x/2.jpg' },
    { item_id: '3', title: '小米13 Ultra 16+512', price_cny: 3000, seller_nick: 'c', image_url: '' },
  ];
  const ranked = rankSearchOnly(items, { intent: { budget_rub: 20000, must_have: ['国行'] }, settings });
  assert.equal(ranked[0].item_id, '1');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(ranked[0].final_price_rub !== null, true);
});

test('runSearchOnly использует intent и возвращает режим', async () => {
  const settings = testSettings(tempDir()).get();
  const llm = new FakeLlm([{ content: '{"keyword":"小米13 Ultra","budget_rub":20000,"must_have":["国行"]}', toolCalls: [] }]);
  const provider = {
    async search({ keyword }) {
      assert.equal(keyword, '小米13 Ultra');
      return { items: [{ item_id: '1', title: '小米13 Ultra 国行', price_cny: 1000, seller_nick: 'a', image_url: 'https://x/1.jpg' }], total: 1 };
    },
  };
  const result = await runSearchOnly({ query: 'Xiaomi 13 Ultra до 20 000 ₽', provider, llm, settings, logger: silentLogger() });
  assert.equal(result.mode, 'search_only');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].verdict, 'проверить');
  assert.equal(result.items[0].confidence, 'низкая');
});
