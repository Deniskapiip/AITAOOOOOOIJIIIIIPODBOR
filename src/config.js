import fs from 'node:fs';
import path from 'node:path';

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
      proxyUrl: String(merged.GOOFISH_PROXY_URL || '').trim(),
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    images: {
      mode: String(merged.PHOTO_MODE || 'off').trim().toLowerCase() === 'vision' ? 'vision' : 'off',
      inline: bool(merged.INLINE_IMAGES, true),
      maxBytes: num(merged.IMAGE_MAX_BYTES, 6_000_000),
    },
    bot: {
      maxConcurrentRuns: Math.max(1, Math.floor(num(merged.MAX_CONCURRENT_RUNS, 2))),
    },
    port: merged.PORT ? Number(merged.PORT) : null,
    settingsBootstrap: {
      rate_cny_rub: merged.RATE_CNY_RUB ? Number(merged.RATE_CNY_RUB) : null,
      commission_percent: num(merged.COMMISSION_PERCENT, 6.5),
      commission_min_rub: merged.COMMISSION_MIN_RUB !== undefined ? Number(merged.COMMISSION_MIN_RUB) : 650,
    },
  };
}
