import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SettingsStore } from './store/settings.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const settings = new SettingsStore(config.dataDir, logger, config.settingsBootstrap);

const rows = [];
let critical = 0;

function add(name, value, ok) {
  rows.push({ name, value: String(value), ok });
  if (ok === false) critical += 1;
}

add('Node.js', process.version, Number(process.versions.node.split('.')[0]) >= 20);
add('Провайдер Goofish', config.goofish.provider, true);
add('DEEPSEEK_API_KEY', config.llm.apiKey ? 'задан' : 'НЕ ЗАДАН', Boolean(config.llm.apiKey));
add('LLM base URL', config.llm.baseUrl, true);
add('LLM model', config.llm.model, true);
add('TELEGRAM_BOT_TOKEN', config.telegram.token ? 'задан' : 'НЕ ЗАДАН', Boolean(config.telegram.token));
add('Администраторы', config.telegram.adminIds.join(', ') || 'НЕТ', config.telegram.adminIds.length > 0);
add('Каталог данных', config.dataDir, true);
add('Курс CNY/RUB', settings.hasRate() ? settings.get().rate_cny_rub + ' ₽/¥' : 'НЕ ЗАДАН', settings.hasRate());
add('Комиссия', settings.get().commission_percent + '% (мин. ' + settings.get().commission_min_rub + ' ₽)', true);

if (config.goofish.provider === 'http') {
  add('GOOFISH_COOKIE', config.goofish.cookie ? 'задан' : 'НЕ ЗАДАН', Boolean(config.goofish.cookie));
  add('Прокси Goofish', config.goofish.proxyUrl || 'не задан', true);
}

for (const row of rows) {
  const mark = row.ok === true ? 'OK  ' : row.ok === false ? 'FAIL' : '    ';
  console.log(mark + ' ' + row.name.padEnd(22) + ' ' + row.value);
}

if (config.telegram.token) {
  try {
    const res = await fetch('https://api.telegram.org/bot' + config.telegram.token + '/getMe', {
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json();
    console.log((json.ok ? 'OK  ' : 'FAIL') + ' Telegram getMe          ' + (json.ok ? '@' + json.result.username : json.description));
  } catch (err) {
    console.log('FAIL Telegram getMe          ' + err.message + ' (локальная сеть может блокировать api.telegram.org)');
  }
}

if (config.llm.apiKey) {
  try {
    const res = await fetch(config.llm.baseUrl + '/models', {
      headers: { authorization: 'Bearer ' + config.llm.apiKey },
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => ({}));
    const models = Array.isArray(json.data) ? json.data.map((m) => m.id) : [];
    console.log((res.ok ? 'OK  ' : 'FAIL') + ' LLM /models             ' + res.status + (models.length ? ' (' + models.slice(0, 3).join(', ') + ')' : ''));
  } catch (err) {
    console.log('FAIL LLM /models             ' + err.message);
  }
}

if (critical > 0) {
  console.log('\nЕсть критические проблемы: ' + critical + '. Заполни .env или переменные окружения.');
  process.exit(1);
}
console.log('\nВсё необходимое задано.');
