import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createProvider } from './goofish/index.js';
import { classifyGoofishError, formatRetryAfter } from './goofish/errors.js';

const [, , action, ...rest] = process.argv;

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  config.goofish.provider = 'http';
  const provider = await createProvider(config, logger);

  if (!action || action === 'health') {
    console.log(JSON.stringify(provider.health(), null, 2));
    return;
  }

  try {
    let data;
    if (action === 'item' || action === 'detail') data = await provider.item(rest[0]);
    else if (action === 'seller') data = await provider.seller(rest[0]);
    else if (action === 'reviews') data = await provider.reviews(rest[0], Number(rest[1] || 1));
    else if (action === 'search') data = await provider.search({ keyword: rest.join(' '), page: 1, sort: 'new' });
    else {
      console.log('Использование: node src/probe.js item|seller|reviews|search|health <аргумент>');
      process.exit(2);
    }
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    const info = classifyGoofishError(err);
    const health = provider.health ? provider.health() : null;
    const payload = {
      ok: false,
      error: {
        kind: info.kind,
        code: info.code,
        message: err.message,
        retry_after_ms: info.retryAfterMs,
        retry_after: formatRetryAfter(info.retryAfterMs),
      },
      health,
    };
    const file = path.join(config.dataDir, 'health.json');
    try {
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      /* ignore */
    }
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
