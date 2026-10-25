import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { tempDir } from './helpers.js';

test('переменные читаются из .env, реальное окружение важнее', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, '.env'),
    ['TELEGRAM_BOT_TOKEN="123:abc"', 'ADMIN_TELEGRAM_IDS=1,2', 'RATE_CNY_RUB=12.5', 'GOOFISH_PROVIDER=http', '# комментарий'].join('\n'),
    'utf8',
  );
  const config = loadConfig({ ADMIN_TELEGRAM_IDS: '9' }, dir);
  assert.equal(config.telegram.token, '123:abc');
  assert.deepEqual(config.telegram.adminIds, [9]);
  assert.equal(config.settingsBootstrap.rate_cny_rub, 12.5);
  assert.equal(config.goofish.provider, 'http');
});

test('неверный провайдер и порт', () => {
  const dir = tempDir();
  assert.throws(() => loadConfig({ GOOFISH_PROVIDER: 'ftp' }, dir), /mock или http/);
  const config = loadConfig({ APP_PORT: '8080' }, dir);
  assert.equal(config.port, 8080);
});

test('лимит вызовов не превышает 45', () => {
  const dir = tempDir();
  const config = loadConfig({ MAX_TOOL_CALLS: '100' }, dir);
  assert.equal(config.agent.maxToolCalls, 45);
});
