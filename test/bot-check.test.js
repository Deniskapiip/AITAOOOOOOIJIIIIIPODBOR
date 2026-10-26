import test from 'node:test';
import assert from 'node:assert/strict';
import { BotApp } from '../src/bot/app.js';
import { MockGoofishProvider } from '../src/goofish/mock.js';
import { silentLogger, tempDir, testConfig, testSettings } from './helpers.js';

class FakeTelegram {
  constructor() { this.sent = []; this.edits = []; this.groups = []; this.photos = []; this.offset = 0; }
  async sendMessage(chatId, text, extra) { this.sent.push({ chatId, text, extra }); return { message_id: this.sent.length }; }
  async editMessageText(chatId, messageId, text, extra) { this.edits.push({ chatId, messageId, text, extra }); return {}; }
  async sendPhoto(chatId, photo) { this.photos.push(photo); return {}; }
  async sendMediaGroup(chatId, media) { this.groups.push(media); return []; }
  async answerCallbackQuery() {}
  async sendDocument() {}
}

test('/check делает один лот без агента', async () => {
  const dir = tempDir();
  const config = testConfig(dir, { VISION_ENABLED: 'false' });
  config.telegram.adminIds = [42];
  const settings = testSettings(dir);
  const telegram = new FakeTelegram();
  const provider = new MockGoofishProvider({ logger: silentLogger() });
  const app = new BotApp({ config, logger: silentLogger(), telegram, settings, llm: { chat: async () => { throw new Error('LLM must not be called'); } }, provider });
  await app.handleMessage({ chat: { id: 1 }, from: { id: 42 }, text: '/check 812345678901' });
  const text = telegram.edits.map((x) => x.text).join('\n');
  assert.match(text, /Ручная проверка/);
  assert.match(text, /小米15 Ultra/);
});
