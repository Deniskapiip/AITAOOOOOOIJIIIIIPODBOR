import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SettingsStore } from './store/settings.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const store = new SettingsStore(config.dataDir, logger, config.settingsBootstrap);
const [, , command, ...rest] = process.argv;

try {
  if (!command || command === 'show') {
    const s = store.get();
    console.log('Файл: ' + store.file);
    console.log('Курс CNY/RUB: ' + (s.rate_cny_rub === null ? 'не задан' : s.rate_cny_rub));
    console.log('Комиссия: ' + s.commission_percent + '% (мин. ' + s.commission_min_rub + ' ₽)');
    console.log('Обновлено: ' + (s.updated_at || '—') + ' (' + (s.updated_by || '—') + ')');
  } else if (command === 'rate') {
    const rate = Number(rest[0]);
    const updated = store.setRate(rate, 'cli');
    console.log('Курс: ' + updated.rate_cny_rub + ' ₽/¥');
  } else if (command === 'commission') {
    const percent = rest[0] === undefined ? undefined : Number(rest[0]);
    const min = rest[1] === undefined ? undefined : Number(rest[1]);
    const updated = store.setCommission(percent, min, 'cli');
    console.log('Комиссия: ' + updated.commission_percent + '% (мин. ' + updated.commission_min_rub + ' ₽)');
  } else {
    console.log('Команды: show | rate <курс> | commission <процент> [минимум ₽]');
    process.exit(2);
  }
} catch (err) {
  console.error('ОШИБКА: ' + err.message);
  process.exit(1);
}
