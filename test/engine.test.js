import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, AgentError, parseToolArguments } from '../src/agent/engine.js';
import { MockGoofishProvider } from '../src/goofish/mock.js';
import { FakeLlm, baseResult, response, silentLogger, tempDir, testConfig, testSettings } from './helpers.js';

function script() {
  return [
    response([{ name: 'goofish_search', args: { keyword: '小米15 Ultra 512G', price_min: 1600, price_max: 5000, personal_only: true, sort: 'new' } }]),
    response([
      { name: 'goofish_item', args: { item_id: '812345678901' } },
      { name: 'goofish_item', args: { item_id: '812345678915' } },
    ]),
    response([
      { name: 'goofish_seller', args: { seller_id: 's_a' } },
      { name: 'goofish_seller', args: { seller_id: 's_e' } },
    ]),
    response([{ name: 'goofish_reviews', args: { seller_id: 's_a' } }]),
    response([{ name: 'view_images', args: { urls: ['https://picsum.photos/seed/gf901-about/900/1200'], max: 4 } }]),
    response([{ name: 'view_images', args: { urls: ['https://picsum.photos/seed/gf915-about/900/1200'], max: 4 } }]),
    response([
      {
        name: 'calc_price',
        args: { budget_rub: 60000, items: [{ item_id: '812345678901', price_cny: 4580 }, { item_id: '812345678915', price_cny: 4750 }] },
      },
    ]),
    response([{ name: 'finish', args: { result: baseResult() } }]),
  ];
}

async function makeRun(overrides = {}) {
  const dir = tempDir();
  const config = testConfig(dir, { INLINE_IMAGES: 'false', ...overrides });
  const settings = testSettings(dir);
  const provider = new MockGoofishProvider({ logger: silentLogger() });
  const llm = new FakeLlm(script());
  return { dir, config, settings, provider, llm };
}

test('сквозной прогон: 10 вызовов, finish один, итог валиден', async () => {
  const { config, settings, provider, llm } = await makeRun();
  const outcome = await runAgent({
    query: 'Xiaomi 15 Ultra 16/512 до 60 000 ₽, только 国行',
    provider,
    settings: settings.get(),
    llm,
    config,
    logger: silentLogger(),
  });

  assert.equal(outcome.calls, 10);
  assert.equal(outcome.budget.used, 10);
  assert.equal(outcome.result.top.length, 2);
  assert.equal(outcome.result.top[0].item_id, '812345678901');
  assert.equal(outcome.result.top[0].verdict, 'брать');
  assert.equal(outcome.result.top[0].rank, 1);
  assert.equal(outcome.result.top[0].final_price_rub, 58533);
  assert.equal(outcome.result.top[1].verdict, 'проверить');
  assert.equal(outcome.result.stats.tool_calls, 10);
  assert.equal(outcome.result.stats.checked_deeply, 2);
  assert.deepEqual(outcome.result.request_parsed.search_keys_used, ['小米15 Ultra 512G']);
  assert.equal(outcome.result.request_parsed.budget_cny, 5000);
  assert.equal(outcome.finishWarnings.length, 0);

  const lastMessages = llm.requests.at(-1).messages;
  const imageMessages = lastMessages.filter((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
  assert.equal(imageMessages.length, 2, 'два вызова view_images должны дать два сообщения с картинками');
  assert.equal(outcome.state.log.filter((l) => l.tool === 'finish').length, 1);
});

test('текстовые ответы без инструментов приводят к AgentError', async () => {
  const { config, settings, provider } = await makeRun();
  const llm = new FakeLlm([{ content: 'Привет' }, { content: 'Не буду' }, { content: 'Всё ещё текст' }]);
  await assert.rejects(
    () => runAgent({ query: 'тест', provider, settings: settings.get(), llm, config, logger: silentLogger() }),
    (err) => err instanceof AgentError && /finish/.test(err.message),
  );
});

test('лимит этапа поиска не даёт уйти в бесконечный перебор', async () => {
  const dir = tempDir();
  const config = testConfig(dir);
  const settings = testSettings(dir);
  const provider = new MockGoofishProvider({ logger: silentLogger() });
  const searches = [];
  for (let i = 0; i < 10; i += 1) searches.push(response([{ name: 'goofish_search', args: { keyword: '小米15 Ultra 512G' } }]));
  searches.push(response([{ name: 'goofish_search', args: { keyword: '小米15 Ultra 512G' } }]));
  searches.push(
    response([
      {
        name: 'finish',
        args: {
          result: {
            assumptions: [],
            request_parsed: { model: 'Xiaomi 15 Ultra', budget_cny: null, budget_rub: null, must_have: [], search_keys_used: [] },
            stats: { found: 0, after_title_filter: 0, after_card_filter: 0, checked_deeply: 0, tool_calls: 0, limits_hit: null },
            top: [],
            rejected_notable: [],
            summary_ru: 'Подходящих лотов не найдено.',
          },
        },
      },
    ]),
  );
  const llm = new FakeLlm(searches);
  const outcome = await runAgent({ query: 'тест', provider, settings: settings.get(), llm, config, logger: silentLogger() });
  assert.equal(outcome.calls, 10);
  assert.match(outcome.result.stats.limits_hit, /лимит этапа goofish_search/);
  assert.equal(outcome.result.top.length, 0);
});

test('парсер аргументов вытаскивает JSON из обёртки', () => {
  const bt = String.fromCharCode(96).repeat(3);
  assert.deepEqual(parseToolArguments('{"a":1}'), { a: 1 });
  assert.deepEqual(parseToolArguments(bt + 'json\n{"a":2}\n' + bt), { a: 2 });
  assert.deepEqual(parseToolArguments('prefix {"a":{"b":3}} suffix'), { a: { b: 3 } });
  assert.throws(() => parseToolArguments('нет json'), /Не удалось разобрать/);
});
