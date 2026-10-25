import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function loadDotEnv(baseDir) {
  const file = path.join(baseDir, '.env');
  const values = {};
  if (!fs.existsSync(file)) return values;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function parseIds(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((x) => Number(x))
    .filter(Number.isFinite);
}

export function loadConfig(env = process.env, baseDir = process.cwd()) {
  const merged = { ...loadDotEnv(baseDir), ...env };
  const dataDir = path.resolve(baseDir, merged.DATA_DIR || 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const provider = String(merged.GOOFISH_PROVIDER || 'mock').trim().toLowerCase();
  if (provider !== 'mock' && provider !== 'http') {
    throw new Error('GOOFISH_PROVIDER должен быть mock или http, получено: ' + provider);
  }

  let accounts = [];
  if (merged.GOOFISH_ACCOUNTS) {
    try {
      const parsed = JSON.parse(String(merged.GOOFISH_ACCOUNTS));
      if (Array.isArray(parsed)) {
        accounts = parsed
          .filter((entry) => entry && entry.cookie)
          .map((entry, index) => ({
            id: String(entry.id || 'account_' + (index + 1)),
            label: String(entry.label || entry.id || 'аккаунт ' + (index + 1)),
            cookie: String(entry.cookie).trim(),
          }));
      }
    } catch {
      accounts = [];
    }
  }

  const llmBase = String(merged.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const apiKey = String(merged.DEEPSEEK_API_KEY || merged.LLM_API_KEY || '').trim();

  return {
    baseDir,
    dataDir,
    logLevel: String(merged.LOG_LEVEL || 'info').trim().toLowerCase(),
    telegram: {
      token: String(merged.TELEGRAM_BOT_TOKEN || '').trim(),
      adminIds: parseIds(merged.ADMIN_TELEGRAM_IDS),
      allowedIds: parseIds(merged.ALLOWED_TELEGRAM_IDS),
      apiHost: String(merged.TELEGRAM_API_HOST || 'api.telegram.org'),
      apiIp: String(merged.TELEGRAM_API_IP || '149.154.167.220'),
    },
    llm: {
      baseUrl: llmBase,
      apiKey,
      model: String(merged.LLM_MODEL || 'deepseek-flash').trim(),
      timeoutMs: num(merged.LLM_TIMEOUT_MS, 120000),
      maxTokens: num(merged.LLM_MAX_TOKENS, 8192),
      temperature: 0.2,
    },
    agent: {
      maxToolCalls: Math.min(num(merged.MAX_TOOL_CALLS, 45), 45),
      maxSteps: num(merged.MAX_STEPS, 60),
      runTimeoutMs: num(merged.RUN_TIMEOUT_MS, 300000),
    },
    goofish: {
      provider,
      cookie: String(merged.GOOFISH_COOKIE || '').trim(),
      accounts,
      accountsFile: path.resolve(dataDir, merged.GOOFISH_ACCOUNTS_FILE || 'accounts.json'),
      dailyLimit: Math.max(1, Math.floor(num(merged.GOOFISH_DAILY_LIMIT, 60))),
      proxyUrl: String(merged.GOOFISH_PROXY_URL || '').trim(),
      minIntervalMs: num(merged.GOOFISH_MIN_INTERVAL_MS, 1500),
      itemTtlMs: num(merged.GOOFISH_ITEM_TTL_MS, 6 * 60 * 60 * 1000),
      searchTtlMs: num(merged.GOOFISH_SEARCH_TTL_MS, 10 * 60 * 1000),
      sellerTtlMs: num(merged.GOOFISH_SELLER_TTL_MS, 12 * 60 * 60 * 1000),
      reviewsTtlMs: num(merged.GOOFISH_REVIEWS_TTL_MS, 12 * 60 * 60 * 1000),
      searchOnlyFallback: bool(merged.GOOFISH_SEARCH_ONLY_FALLBACK, true),
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    vision: {
      enabled: bool(merged.VISION_ENABLED, Boolean(merged.VISION_MODEL)),
      baseUrl: String(merged.VISION_BASE_URL || llmBase).replace(/\/+$/, ''),
      apiKey: String(merged.VISION_API_KEY || apiKey).trim(),
      model: String(merged.VISION_MODEL || '').trim(),
      models: String(merged.VISION_MODELS || merged.VISION_MODEL || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      maxPhotos: Math.min(8, Math.max(1, Math.floor(num(merged.VISION_MAX_PHOTOS, 6)))),
      timeoutMs: num(merged.VISION_TIMEOUT_MS, 120000),
    },
    images: {
      mode: String(merged.PHOTO_MODE || 'off').trim().toLowerCase() === 'vision' ? 'vision' : 'off',
      inline: bool(merged.INLINE_IMAGES, true),
      maxBytes: num(merged.IMAGE_MAX_BYTES, 6_000_000),
    },
    bot: {
      maxConcurrentRuns: Math.max(1, Math.floor(num(merged.MAX_CONCURRENT_RUNS, 2))),
      sendPhotos: Math.max(0, Math.min(Math.floor(num(merged.SEND_PHOTOS_PER_LOT, 4)), 8)),
    },
    port: merged.APP_PORT ? Number(merged.APP_PORT) : null,
    settingsBootstrap: {
      rate_cny_rub: merged.RATE_CNY_RUB ? Number(merged.RATE_CNY_RUB) : null,
      commission_percent: num(merged.COMMISSION_PERCENT, 6.5),
      commission_min_rub: merged.COMMISSION_MIN_RUB !== undefined ? Number(merged.COMMISSION_MIN_RUB) : 650,
    },
  };
}
