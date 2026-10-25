import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createProvider } from './goofish/index.js';

const [, , action, ...rest] = process.argv;

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  config.goofish.provider = 'http';
  const provider = await createProvider(config, logger);
  let data;
  if (action === 'item') data = await provider.item(rest[0]);
  else if (action === 'seller') data = await provider.seller(rest[0]);
  else if (action === 'reviews') data = await provider.reviews(rest[0], Number(rest[1] || 1));
  else if (action === 'search') data = await provider.search({ keyword: rest.join(' '), page: 1, sort: 'new' });
  else {
    console.log('Использование: node src/probe.js item|seller|reviews|search <аргумент>');
    process.exit(2);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error('ОШИБКА: ' + err.message);
  if (err.body) console.error(String(err.body).slice(0, 1500));
  process.exit(1);
});
