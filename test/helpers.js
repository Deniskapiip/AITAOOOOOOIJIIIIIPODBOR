import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { SettingsStore } from '../src/store/settings.js';
import { MockGoofishProvider } from '../src/goofish/mock.js';
import { Budget } from '../src/tools/budget.js';
import { ToolState } from '../src/tools/executor.js';
import { calcPrice } from '../src/tools/pricing.js';

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'goofish-test-'));
}

export function testConfig(dir, overrides = {}) {
  return loadConfig({ DATA_DIR: dir, LOG_LEVEL: 'silent', PHOTO_MODE: 'vision', ...overrides }, dir);
}

export function testSettings(dir) {
  const store = new SettingsStore(dir, createLogger('silent'));
  store.setRate(12, 'test');
  return store;
}

export function silentLogger() {
  return createLogger('silent');
}

export function response(calls, content = '') {
  return {
    content,
    toolCalls: calls.map((c, i) => ({
      id: 'call_' + i + '_' + Math.random().toString(36).slice(2, 8),
      name: c.name,
      arguments: JSON.stringify(c.args === undefined ? {} : c.args),
    })),
  };
}

export class FakeLlm {
  constructor(script) {
    this.script = script.slice();
    this.requests = [];
    this.totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    this.visionSupported = true;
  }

  async chat({ messages, tools }) {
    this.requests.push({ messages: JSON.parse(JSON.stringify(messages)), toolCount: tools ? tools.length : 0 });
    if (!this.script.length) throw new Error('FakeLlm: сценарий исчерпан');
    const next = this.script.shift();
    const value = typeof next === 'function' ? next(messages) : next;
    return { content: value.content || '', toolCalls: value.toolCalls || [], finishReason: 'stop', usage: null, vision: true };
  }
}

export async function makeTokenContext({ budgetRub = 60000, itemIds = ['812345678901', '812345678915'] } = {}) {
  const dir = tempDir();
  const config = testConfig(dir);
  const settings = testSettings(dir);
  const provider = new MockGoofishProvider({ logger: silentLogger() });
  const budget = new Budget(45);
  const state = new ToolState({ provider, settings, budget, config, logger: silentLogger() });

  for (const id of itemIds) {
    const item = await provider.item(id);
    state.items.set(id, item);
    state.viewedItemIds.add(id);
    state.checkedDeeply.add(id);
    budget.record('goofish_item');
  }
  for (const sellerId of new Set([...state.items.values()].map((i) => String(i.seller_id)))) {
    const seller = await provider.seller(sellerId);
    state.sellers.set(sellerId, seller);
    budget.record('goofish_seller');
  }
  const s = settings.get();
  const priced = calcPrice({ budget_rub: budgetRub, items: itemIds.map((id) => ({ item_id: id, price_cny: state.items.get(id).price_cny })) }, s);
  state.rateCnyRub = priced.rate_cny_rub;
  state.priceBudgetCny = priced.budget_cny;
  for (const row of priced.results) state.priceResults.set(row.item_id, row);
  state.searchKeys.add('小米15 Ultra 512G');
  state.seenItemIds = new Set(itemIds);
  budget.record('calc_price');

  return { dir, config, settings, provider, budget, state };
}

export function baseResult() {
  return {
    assumptions: ['Бюджет 60 000 ₽ — максимальная цена товара без доставки и комиссии'],
    request_parsed: {
      model: 'Xiaomi 15 Ultra 16/512',
      budget_cny: 5000,
      budget_rub: 60000,
      must_have: ['国行', '16/512'],
      search_keys_used: ['小米15 Ultra 512G'],
    },
    stats: { found: 23, after_title_filter: 14, after_card_filter: 8, checked_deeply: 2, tool_calls: 10, limits_hit: null },
    top: [lotOne(), lotTwo()],
    rejected_notable: [{ item_id: '812345678907', reason: '账号锁, продавец просит не возвращать' }],
    summary_ru: 'Лучший вариант — 812345678901: полный комплект, продавец с Zhima 780. Главный риск: блокировки не подтверждены продавцом.',
  };
}

export function lotOne() {
  return {
    rank: 1,
    item_id: '812345678901',
    url: 'https://www.goofish.com/item?id=812345678901',
    title_cn: '小米15 Ultra 16+512 黑色 国行 全套 无拆无修 电池97%',
    title_ru: 'Xiaomi 15 Ultra 16/512, чёрный, 国行',
    card: {
      title: 'Xiaomi 15 Ultra 16/512',
      description: 'Частник, полный комплект, отправка по Китаю',
      condition_lines: ['АКБ 97% (по фото)', 'Корпус без видимых дефектов (по фото)', 'Заявлено: без вскрытия и ремонта'],
    },
    price_cny: 4580,
    budget_status: 'в рамках',
    price_vs_market: { median_cny: null, comparable_count: 0, delta_pct: null },
    exchange_rate_cny_rub: 12,
    base_price_rub: 54960,
    commission_rub: 3573,
    final_price_rub: 58533,
    extra_costs_excluded: [],
    score: 89,
    score_breakdown: { price: 22, condition: 22, seller: 18, match: 10, description: 9, delivery: 8, penalties: 0 },
    verdict: 'брать',
    confidence: 'средняя',
    why_good: [
      'Цена ниже сопоставимых лотов (карточка: price)',
      'Zhima 780, 326 продаж (профиль: zhima_credit)',
      'На фото нет видимых дефектов (фото: экран и крышка)',
    ],
    red_flags: [],
    seller: { zhima: 780, age_months: 90, sold: 326, praise_rate: 99.2, review_summary_ru: '3 отзыва, конкретных жалоб нет' },
    photo_check: { verdict: 'ок', defects: [], mismatch: [] },
    has_video: true,
    delivery: { mode: '包邮', ship_fee_cny: 0, from_city: '深圳' },
    unknown: ['статус блокировок (账号锁/激活锁) не подтверждён продавцом'],
    questions_for_seller: [{ cn: '这台机器有没有账号锁？', ru: 'Есть ли блокировка аккаунта?' }],
  };
}

export function lotTwo() {
  return {
    rank: 2,
    item_id: '812345678915',
    url: 'https://www.goofish.com/item?id=812345678915',
    title_cn: '小米15 Ultra 16+512 国行 一价不议 电池97%',
    title_ru: 'Xiaomi 15 Ultra 16/512, 国行',
    card: {
      title: 'Xiaomi 15 Ultra 16/512',
      description: 'Частник, полный комплект, отправка по Китаю',
      condition_lines: ['АКБ 97% (по фото)', 'Дисплей без видимых дефектов (по фото)', 'Заявлено: без вскрытия и ремонта'],
    },
    price_cny: 4750,
    budget_status: 'в рамках',
    price_vs_market: { median_cny: null, comparable_count: 0, delta_pct: null },
    exchange_rate_cny_rub: 12,
    base_price_rub: 57000,
    commission_rub: 3705,
    final_price_rub: 60705,
    extra_costs_excluded: [],
    score: 78,
    score_breakdown: { price: 20, condition: 18, seller: 17, match: 10, description: 7, delivery: 6, penalties: 0 },
    verdict: 'проверить',
    confidence: 'средняя',
    why_good: ['Цена в рамках бюджета (карточка: price)', 'Zhima 730 (профиль: zhima_credit)'],
    red_flags: [],
    seller: { zhima: 730, age_months: 59, sold: 42, praise_rate: 99, review_summary_ru: '2 отзыва, жалоб нет' },
    photo_check: { verdict: 'ок', defects: [], mismatch: [] },
    has_video: true,
    delivery: { mode: '包邮', ship_fee_cny: 0, from_city: '上海' },
    unknown: ['статус блокировок (账号锁/激活锁) не подтверждён продавцом'],
    questions_for_seller: [{ cn: '有没有拆修记录？', ru: 'Есть ли следы вскрытия или ремонта?' }],
  };
}
