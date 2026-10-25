import { HttpGoofishProvider } from './http.js';
import { MockGoofishProvider } from './mock.js';
import { AccountStore } from './accounts.js';

export async function createProvider(config, logger) {
  if (config.goofish.provider === 'http') {
    const accounts = new AccountStore({
      dataDir: config.dataDir,
      file: config.goofish.accountsFile,
      accounts: config.goofish.accounts,
      cookie: config.goofish.cookie,
      dailyLimit: config.goofish.dailyLimit,
      logger,
    });
    return new HttpGoofishProvider({
      accounts,
      proxyUrl: config.goofish.proxyUrl,
      userAgent: config.goofish.userAgent,
      minIntervalMs: config.goofish.minIntervalMs,
      itemTtlMs: config.goofish.itemTtlMs,
      searchTtlMs: config.goofish.searchTtlMs,
      sellerTtlMs: config.goofish.sellerTtlMs,
      reviewsTtlMs: config.goofish.reviewsTtlMs,
      logger,
    });
  }
  return new MockGoofishProvider({ logger, latencyMs: Number(process.env.MOCK_LATENCY_MS || 0) });
}
