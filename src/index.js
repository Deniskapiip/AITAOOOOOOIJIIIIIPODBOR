import http from 'node:http';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SettingsStore } from './store/settings.js';
import { LlmClient } from './agent/llm.js';
import { createProvider } from './goofish/index.js';
import { TelegramClient } from './bot/telegram.js';
import { BotApp } from './bot/app.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (!config.telegram.token) throw new Error('Не задан TELEGRAM_BOT_TOKEN');
  if (!config.llm.apiKey) throw new Error('Не задан DEEPSEEK_API_KEY');
  if (config.goofish.provider === 'http' && !config.goofish.cookie) {
    logger.warn('GOOFISH_PROVIDER=http без GOOFISH_COOKIE: запросы к Goofish будут отклонены');
  }
  if (!config.telegram.adminIds.length) logger.warn('ADMIN_TELEGRAM_IDS пуст: менять курс через бота никто не сможет');

  const settings = new SettingsStore(config.dataDir, logger, config.settingsBootstrap);
  if (!settings.hasRate()) logger.warn('курс CNY/RUB не задан: рублёвые цены будут null, пока админ не выполнит /rate');

  const llm = new LlmClient(config.llm, logger);
  const provider = await createProvider(config, logger);
  const telegram = new TelegramClient(config.telegram.token, logger);
  const app = new BotApp({ config, logger, telegram, settings, llm, provider });

  let healthServer = null;
  if (config.port) {
    healthServer = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            uptime_s: Math.round(process.uptime()),
            provider: config.goofish.provider,
            rate_set: settings.hasRate(),
          }),
        );
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    healthServer.listen(config.port, '0.0.0.0', () => {
      logger.info('health: слушаю порт ' + config.port);
    });
  }

  const shutdown = async () => {
    logger.info('bot: остановка');
    app.stop();
    if (healthServer) healthServer.close();
    setTimeout(() => process.exit(0), 200);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.start();
}

main().catch((err) => {
  console.error('FATAL: ' + err.message);
  process.exit(1);
});
