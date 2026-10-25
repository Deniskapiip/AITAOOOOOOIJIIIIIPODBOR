import test from 'node:test';
import assert from 'node:assert/strict';
import { BotApp } from '../src/bot/app.js';
import { MockGoofishProvider } from '../src/goofish/mock.js';
import { baseResult, FakeLlm, response, silentLogger, tempDir, testConfig, testSettings } from './helpers.js';

class FakeTelegram {
  constructor() {
    this.sent = [];
    this.edits = [];
    this.photos = [];
    this.groups = [];
    this.offset = 0;
  }
  async sendMessage(chatId, text, extra) {
    this.sent.push({ chatId, text, extra });
    return { message_id: this.sent.length };
  }
  async editMessageText(chatId, messageId, text, extra) {
    this.edits.push({ chatId, messageId, text, extra });
    return {};
  }
  async sendPhoto(chatId, photo, caption, extra) {
    this.photos.push({ chatId, photo, caption, extra });
    return { message_id: 100 + this.photos.length };
  }
  async sendMediaGroup(chatId, media, extra) {
    this.groups.push({ chatId, media, extra });
    return media.map((m, i) => ({ message_id: 200 + this.groups.length * 10 + i }));
  }
  async answerCallbackQuery() {}
  async sendDocument() {}
}

function script() {
  return [
    response([{ name: 'goofish_search', args: { keyword: '小米15 Ultra 512G', price_min: 1600, price_max: 5000 } }]),
    response([
      { name: 'goofish_item', args: { item_id: '812345678901' } },
      { name: 'goofish_item', args: { item_id: '812345678915' } },
    ]),
    response([
      { name: 'goofish_seller', args: { seller_id: 's_a' } },
      { name: 'goofish_seller', args: { seller_id: 's_e' } },
    ]),
    response([{ name: 'goofish_reviews', args: { seller_id: 's_a' } }]),
    response([{ name: 'view_images', args: { urls: ['https://picsum.photos/seed/gf901-about/900/1200'] } }]),
    response([{ name: 'view_images', args: { urls: ['https://picsum.photos/seed/gf915-about/900/1200'] } }]),
    response([
      {
        name: 'calc_price',
        args: { budget_rub: 60000, items: [{ item_id: '812345678901', price_cny: 4580 }, { item_id: '812345678915', price_cny: 4750 }] },
      },
    ]),
    response([{ name: 'finish', args: { result: baseResult() } }]),
  ];
}

async function makeApp(overrides = {}) {
  const dir = tempDir();
  const config = testConfig(dir, { INLINE_IMAGES: 'false', ...overrides });
  config.telegram.adminIds = [42];
  const settings = testSettings(dir);
  const provider = new MockGoofishProvider({ logger: silentLogger() });
  const telegram = new FakeTelegram();
  const llm = new FakeLlm(script());
  const app = new BotApp({ config, logger: silentLogger(), telegram, settings, llm, provider });
  return { app, telegram, settings, llm };
}

test('бот: запрос менеджера даёт карточки и JSON в памяти', async () => {
  const { app, telegram } = await makeApp();
  await app.handleMessage({ chat: { id: 1 }, from: { id: 42 }, text: 'Xiaomi 15 Ultra 16/512 до 60 000 ₽' });
  await app.chatQueues.get(1);

  assert.match(telegram.sent[0].text, /Принял запрос/);
  const texts = telegram.sent.map((m) => m.text);
  assert.ok(texts.some((t) => t.includes('Нашёл 2')));
  const cardMessage = texts.find((t) => t.includes('<b>1. Xiaomi 15 Ultra'));
  assert.ok(cardMessage);
  assert.match(cardMessage, /4 580 ¥/);
  assert.match(cardMessage, /58 533 ₽/);
  assert.match(cardMessage, /item\?id=812345678901/);
  const footer = texts.at(-1);
  assert.ok(!footer.includes('Курс'));
  assert.match(footer, /вызовов: 10/);
  assert.equal(telegram.groups.length, 2, 'каждому лоту уходит группа фото');
  assert.ok(telegram.groups[0].media.length > 0);
  assert.equal(app.lastRuns.get(1).result.top.length, 2);
  assert.equal(app.chatQueues.has(1), false);
});

test('бот: админ меняет курс, остальные не могут', async () => {
  const { app, settings, telegram } = await makeApp();
  await app.handleMessage({ chat: { id: 2 }, from: { id: 99 }, text: '/rate 99' });
  assert.equal(settings.get().rate_cny_rub, 12);
  assert.match(telegram.sent.at(-1).text, /Только администратор/);

  await app.handleMessage({ chat: { id: 2 }, from: { id: 42 }, text: '/rate 13.2' });
  assert.equal(settings.get().rate_cny_rub, 13.2);
  assert.match(telegram.sent.at(-1).text, /13\.2/);

  await app.handleMessage({ chat: { id: 2 }, from: { id: 42 }, text: '/commission 7 700' });
  assert.equal(settings.get().commission_percent, 7);
  assert.equal(settings.get().commission_min_rub, 700);
});

test('бот: ошибка LLM показывается менеджеру с ID прогона', async () => {
  const { app, telegram } = await makeApp();
  app.llm = { chat: async () => { throw new Error('LLM HTTP 401'); } };
  await app.handleMessage({ chat: { id: 3 }, from: { id: 42 }, text: 'тест' });
  await app.chatQueues.get(3);
  const last = telegram.sent.at(-1);
  assert.match(last.text, /LLM HTTP 401/);
  assert.match(last.text, /ID прогона/);
});


test('бот: /accounts доступен админу', async () => {
  const { app, telegram } = await makeApp();
  await app.handleMessage({ chat: { id: 1 }, from: { id: 42 }, text: '/accounts' });
  assert.ok(telegram.sent.some((m) => m.text.includes('Goofish аккаунты')));
});

test('бот: /cookie не принимает короткое значение', async () => {
  const { app, telegram } = await makeApp();
  await app.handleMessage({ chat: { id: 1 }, from: { id: 42 }, text: '/cookie short' });
  assert.ok(telegram.sent.some((m) => m.text.includes('слишком короткий')));
});
