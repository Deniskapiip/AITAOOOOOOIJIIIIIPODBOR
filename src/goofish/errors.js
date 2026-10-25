export const GOOFISH_KINDS = Object.freeze({
  RATE_LIMIT: 'RATE_LIMIT',
  NEEDS_VERIFICATION: 'NEEDS_VERIFICATION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TOKEN_REFRESHABLE: 'TOKEN_REFRESHABLE',
  TRANSIENT_NETWORK: 'TRANSIENT_NETWORK',
  NOT_FOUND: 'NOT_FOUND',
  NO_ACCOUNT: 'NO_ACCOUNT',
  UNKNOWN: 'UNKNOWN',
});

export const KIND_LABELS_RU = Object.freeze({
  RATE_LIMIT: 'лимит запросов / риск-контроль',
  NEEDS_VERIFICATION: 'нужна ручная проверка',
  SESSION_EXPIRED: 'сессия истекла',
  TOKEN_REFRESHABLE: 'токен обновляется',
  TRANSIENT_NETWORK: 'временная сетевая ошибка',
  NOT_FOUND: 'лот или продавец не найден',
  NO_ACCOUNT: 'нет доступного аккаунта',
  UNKNOWN: 'неизвестная ошибка',
});

const BASE_COOLDOWN_MS = Object.freeze({
  RATE_LIMIT: 30 * 60 * 1000,
  NEEDS_VERIFICATION: 2 * 60 * 60 * 1000,
  SESSION_EXPIRED: 2 * 60 * 60 * 1000,
  TOKEN_REFRESHABLE: 0,
  TRANSIENT_NETWORK: 60 * 1000,
  NOT_FOUND: 0,
  NO_ACCOUNT: 15 * 60 * 1000,
  UNKNOWN: 5 * 60 * 1000,
});

const RISK_KINDS = new Set([GOOFISH_KINDS.RATE_LIMIT, GOOFISH_KINDS.NEEDS_VERIFICATION]);

export class GoofishError extends Error {
  constructor(kind, message, options = {}) {
    super(message);
    this.name = 'GoofishError';
    this.kind = kind || GOOFISH_KINDS.UNKNOWN;
    this.scope = options.scope || null;
    this.accountId = options.accountId || null;
    this.retryAfterMs = Number.isFinite(options.retryAfterMs) ? options.retryAfterMs : BASE_COOLDOWN_MS[this.kind] || 0;
    this.retryable = options.retryable !== undefined ? Boolean(options.retryable) : this.kind === GOOFISH_KINDS.TOKEN_REFRESHABLE;
    this.details = options.details || null;
    this.code = options.code || (RISK_KINDS.has(this.kind) ? 'risk_control' : 'goofish_' + String(this.kind).toLowerCase());
  }
}

export class GoofishUnavailableError extends GoofishError {
  constructor(message, options = {}) {
    super(GOOFISH_KINDS.NO_ACCOUNT, message, {
      code: 'goofish_unavailable',
      retryAfterMs: options.retryAfterMs,
      details: options.details,
    });
  }
}

function textOf(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return [
    error.code,
    error.name,
    error.message,
    error.ret,
    error.body,
    error.details && JSON.stringify(error.details),
  ]
    .filter(Boolean)
    .map(String)
    .join(' | ');
}

export function classifyGoofishError(error) {
  if (error instanceof GoofishError) {
    return {
      kind: error.kind,
      code: error.code,
      retryAfterMs: error.retryAfterMs,
      retryable: error.retryable,
      message: error.message,
      accountId: error.accountId,
      details: error.details,
    };
  }
  const text = textOf(error);
  const upper = text.toUpperCase();
  const status = error && Number(error.status);

  let kind = GOOFISH_KINDS.UNKNOWN;
  let retryable = false;

  if (/RGV587|被挤爆|TOO MANY|RATE.?LIMIT|THROTTL/.test(upper) || status === 429) {
    kind = GOOFISH_KINDS.RATE_LIMIT;
  } else if (/FAIL_SYS_USER_VALIDATE|USER_VALIDATE|NEED.?VERIFY|CAPTCHA|ILLEGAL_ACCESS/.test(upper)) {
    kind = GOOFISH_KINDS.NEEDS_VERIFICATION;
  } else if (/SESSION_EXPIRED|FAIL_SYS_SESSION|SESSION.?INVALID/.test(upper)) {
    kind = GOOFISH_KINDS.SESSION_EXPIRED;
  } else if (/TOKEN_EMPTY|TOKEN_EXOIRED|TOKEN_EXPIRED|FAIL_SYS_TOKEN|INVALID.?TOKEN/.test(upper)) {
    kind = GOOFISH_KINDS.TOKEN_REFRESHABLE;
    retryable = true;
  } else if (/ITEM_NOT_FOUND|NOT.?FOUND|НЕ НАЙДЕН|SOLD.?OUT|ITEM.?SOLD/.test(upper)) {
    kind = GOOFISH_KINDS.NOT_FOUND;
  } else if (
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|SOCKET HANG UP|ТАЙМАУТ|TIMEOUT|NETWORK/.test(upper) ||
    (status >= 500 && status < 600)
  ) {
    kind = GOOFISH_KINDS.TRANSIENT_NETWORK;
    retryable = true;
  }

  const base = BASE_COOLDOWN_MS[kind] || 0;
  return {
    kind,
    code: RISK_KINDS.has(kind) ? 'risk_control' : 'goofish_' + kind.toLowerCase(),
    retryAfterMs: base,
    retryable,
    message: error && error.message ? error.message : String(error || 'неизвестная ошибка'),
    accountId: null,
    details: { raw: text.slice(0, 500) },
  };
}

export function toGoofishError(error, options = {}) {
  if (error instanceof GoofishError) {
    if (!error.scope && options.scope) error.scope = options.scope;
    if (!error.accountId && options.accountId) error.accountId = options.accountId;
    return error;
  }
  const info = classifyGoofishError(error);
  const message = info.kind === GOOFISH_KINDS.RATE_LIMIT
    ? 'Goofish ограничил запросы (RGV587): аккаунт временно в cooldown'
    : info.kind === GOOFISH_KINDS.NEEDS_VERIFICATION
      ? 'Goofish требует ручную проверку (капча/слайдер) для аккаунта'
      : info.kind === GOOFISH_KINDS.SESSION_EXPIRED
        ? 'Сессия Goofish истекла: нужен новый cookie'
        : info.kind === GOOFISH_KINDS.TRANSIENT_NETWORK
          ? 'Временная сетевая ошибка Goofish'
          : info.message;
  return new GoofishError(info.kind, message, {
    scope: options.scope,
    accountId: options.accountId,
    retryAfterMs: info.retryAfterMs,
    retryable: info.retryable,
    details: info.details,
  });
}

export function isRiskKind(kind) {
  return RISK_KINDS.has(kind);
}

export function formatRetryAfter(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'сейчас';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return minutes + ' мин';
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return hours + ' ч';
  return Math.ceil(hours / 24) + ' д';
}
