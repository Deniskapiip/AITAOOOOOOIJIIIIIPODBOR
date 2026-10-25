import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SettingsStore } from './store/settings.js';
import { LlmClient } from './agent/llm.js';
import { createProvider } from './goofish/index.js';
import { runAgent } from './agent/engine.js';
import { renderAllCards, renderShortSummary } from './agent/render.js';
import { saveRun, newRunId } from './store/runs.js';

function parseArgs(argv) {
  const flags = { json: false, rate: null, provider: null, quiet: false };
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--quiet') flags.quiet = true;
    else if (arg === '--rate') flags.rate = Number(argv[++i]);
    else if (arg === '--provider') flags.provider = argv[++i];
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else words.push(arg);
  }
  return { flags, query: words.join(' ').trim() };
}

async function main() {
  const { flags, query } = parseArgs(process.argv.slice(2));
  if (flags.help || !query) {
    console.log('Использование: node src/cli.js [--json] [--rate 12.4] [--provider mock|http] "запрос клиента"');
    process.exit(flags.help ? 0 : 2);
  }
  const config = loadConfig();
  const logger = createLogger(flags.quiet ? 'warn' : 'info');
  if (flags.provider) config.goofish.provider = flags.provider;
  if (!config.llm.apiKey) throw new Error('Не задан DEEPSEEK_API_KEY');

  const store = new SettingsStore(config.dataDir, logger, config.settingsBootstrap);
  const settings = store.get();
  if (Number.isFinite(flags.rate) && flags.rate > 0) {
    settings.rate_cny_rub = flags.rate;
    logger.warn('курс переопределён флагом --rate только для этого прогона, настройки не сохранены');
  }
  const llm = new LlmClient(config.llm, logger);
  const provider = await createProvider(config, logger);

  const outcome = await runAgent({
    query,
    provider,
    settings,
    llm,
    config,
    logger,
    onEvent: (event) => {
      if (flags.json || flags.quiet) return;
      const labels = {
        goofish_search: 'поиск',
        goofish_item: 'карточка',
        goofish_seller: 'продавец',
        goofish_reviews: 'отзывы',
        view_images: 'фото',
        calc_price: 'цена',
        finish: 'итог',
      };
      if (event.type === 'tool') console.error('[' + event.used + '/' + event.max + '] ' + (labels[event.name] || event.name));
    },
  });

  const runId = newRunId();
  const saved = saveRun(
    config.dataDir,
    {
      id: runId,
      query,
      provider: config.goofish.provider,
      settings,
      result: outcome.result,
      calls: outcome.calls,
      usage: outcome.usage,
      warnings: outcome.finishWarnings,
      duration_ms: outcome.durationMs,
    },
    logger,
  );
  if (saved) console.error('Прогон сохранён: ' + saved.file);

  if (flags.json) {
    console.log(JSON.stringify(outcome.result, null, 2));
    return;
  }
  console.log('');
  console.log(renderAllCards(outcome.result));
  console.log('');
  console.log('—'.repeat(40));
  console.log(outcome.result.summary_ru);
  console.log('');
  console.log('Вызовов: ' + outcome.calls + ' · время: ' + Math.round(outcome.durationMs / 1000) + ' с');
  if (!outcome.result.top.length) console.log(renderShortSummary(outcome.result));
  if (outcome.finishWarnings.length) console.log('Предупреждения: ' + outcome.finishWarnings.join('; '));
}

main().catch((err) => {
  console.error('ОШИБКА: ' + (err && err.message ? err.message : err));
  if (err && err.details) console.error(JSON.stringify(err.details, null, 2));
  process.exit(1);
});
