import test from 'node:test';
import assert from 'node:assert/strict';
import { BotApp } from '../src/bot/app.js';
import { FakeLlm, silentLogger, tempDir, testConfig, testSettings } from './helpers.js';

class FakeTelegram {
  constructor() {
    this.sent = [];
    this.photos = [];
    this.offset = 0;
  }
  async sendMessage(chatId, text, extra) {
    this.sent.push({ chatId, text, extra });
    return { message_id: this.sent.length };
  }
  async editMessageText() { return {}; }
  async sendPhoto(chatId, photo) { this.photos.push({ chatId, photo }); return {}; }
  async sendMediaGroup() { return []; }
  async answerCallbackQuery() {}
  async sendDocument() {}
}

test('бот: при недоступных карточках уходит search-only', async () => {
  const dir = tempDir();
  const config = testConfig(dir, { GOOFISH_SEARCH_ONLY_FALLBACK: 'true' });
  config.telegram.adminIds = [42];
  const settings = testSettings(dir);
  const telegram = new FakeTelegram();
  const llm = new FakeLlm([{ content: '{"keyword":"小米13 Ultra","budget_rub":20000,"must_have":["国行"]}', toolCalls: [] }]);
  const provider = {
    health() {
      return { item_available: false, search_available: true, accounts: [] };
    },
    async search() {
      return {
        items: [{ item_id: '1', title: '小米13 Ultra 国行', price_cny: 1000, seller_nick: 'a', image_url: 'https://x/1.jpg' }],
        total: 1,
      };
    },
  };
  const app = new BotApp({ config, logger: silentLogger(), telegram, settings, llm, provider });
  await app.handleMessage({ chat: { id: 1 }, from: { id: 42 }, text: 'Xiaomi 13 Ultra до 20 000 ₽' });
  await app.chatQueues.get(1);
  const texts = telegram.sent.map((m) => m.text);
  assert.ok(texts.some((t) => t.includes('Ограниченный режим')));
  assert.ok(texts.some((t) => t.includes('小米13 Ultra')));
  assert.equal(telegram.photos.length, 1);
});
