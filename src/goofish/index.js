import { HttpGoofishProvider } from './http.js';
import { MockGoofishProvider } from './mock.js';

export async function createProvider(config, logger) {
  if (config.goofish.provider === 'http') {
    return new HttpGoofishProvider({
      cookie: config.goofish.cookie,
      proxyUrl: config.goofish.proxyUrl,
      userAgent: config.goofish.userAgent,
      minIntervalMs: config.goofish.minIntervalMs,
      logger,
    });
  }
  return new MockGoofishProvider({ logger, latencyMs: Number(process.env.MOCK_LATENCY_MS || 0) });
}
