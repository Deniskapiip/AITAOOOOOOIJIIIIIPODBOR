import fs from 'node:fs';
import path from 'node:path';
import { GOOFISH_KINDS, isRiskKind } from './errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_STEPS = [30 * 60 * 1000, 2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const TRANSIENT_COOLDOWN = 60 * 1000;

function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function cleanCookie(value) {
  return String(value || '').trim();
}

function makeAccount(input, index) {
  const cookie = cleanCookie(input && input.cookie);
  if (!cookie) return null;
  return {
    id: String((input && input.id) || 'account_' + (index + 1)),
    label: String((input && input.label) || (input && input.id) || 'аккаунт ' + (index + 1)),
    cookie,
    status: 'ok',
    cooldown_until: null,
    item_cooldown_until: null,
    verification_needed: false,
    strikes: 0,
    success_count: 0,
    risk_count: 0,
    calls_today: 0,
    day: dayKey(Date.now()),
    last_used_at: null,
    last_error: null,
  };
}

export class AccountStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir || process.cwd();
    this.file = options.file || path.join(this.dataDir, 'accounts.json');
    this.logger = options.logger || null;
    this.now = options.now || (() => Date.now());
    this.dailyLimit = Math.max(1, Number(options.dailyLimit) || 60);
    this.accounts = [];
    this.load();
    if (!this.accounts.length) {
      const bootstrap = Array.isArray(options.accounts) ? options.accounts : [];
      const candidates = bootstrap.length ? bootstrap : [{ id: 'default', label: 'основной', cookie: options.cookie }];
      this.accounts = candidates.map(makeAccount).filter(Boolean);
      this.persist();
    }
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.accounts) ? raw.accounts : [];
      this.accounts = list.map((entry, index) => {
        const base = makeAccount(entry, index);
        if (!base) return null;
        return {
          ...base,
          status: String(entry.status || 'ok'),
          cooldown_until: entry.cooldown_until || null,
          item_cooldown_until: entry.item_cooldown_until || null,
          verification_needed: Boolean(entry.verification_needed),
          strikes: Math.max(0, Number(entry.strikes) || 0),
          success_count: Math.max(0, Number(entry.success_count) || 0),
          risk_count: Math.max(0, Number(entry.risk_count) || 0),
          calls_today: Math.max(0, Number(entry.calls_today) || 0),
          day: String(entry.day || dayKey(this.now())),
          last_used_at: entry.last_used_at || null,
          last_error: entry.last_error || null,
        };
      }).filter(Boolean);
    } catch (err) {
      if (this.logger) this.logger.warn('accounts: не удалось прочитать файл', { error: err.message });
      this.accounts = [];
    }
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, accounts: this.accounts }, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      if (this.logger) this.logger.warn('accounts: не удалось сохранить файл', { error: err.message });
    }
  }

  refresh(account) {
    const now = this.now();
    if (account.day !== dayKey(now)) {
      account.day = dayKey(now);
      account.calls_today = 0;
    }
    if (account.status === 'cooldown' && account.cooldown_until && new Date(account.cooldown_until).getTime() <= now) {
      account.status = 'ok';
      account.cooldown_until = null;
    }
    if (account.item_cooldown_until && new Date(account.item_cooldown_until).getTime() <= now) {
      account.item_cooldown_until = null;
    }
    if (account.status === 'session_expired' && account.cooldown_until && new Date(account.cooldown_until).getTime() <= now) {
      account.status = 'session_expired';
    }
    return account;
  }

  list() {
    return this.accounts.map((a) => this.snapshotOne(a));
  }

  snapshotOne(account) {
    this.refresh(account);
    return {
      id: account.id,
      label: account.label,
      status: account.verification_needed ? 'needs_verification' : account.status,
      cooldown_until: account.cooldown_until || null,
      item_cooldown_until: account.item_cooldown_until || null,
      verification_needed: Boolean(account.verification_needed),
      strikes: account.strikes,
      success_count: account.success_count,
      risk_count: account.risk_count,
      calls_today: account.calls_today,
      daily_limit: this.dailyLimit,
      last_used_at: account.last_used_at || null,
      last_error: account.last_error || null,
    };
  }

  pick(scope = 'any') {
    const now = this.now();
    const candidates = this.accounts
      .map((account) => this.refresh(account))
      .filter((account) => {
        if (account.status === 'dead' || account.status === 'session_expired') return false;
        if (account.status === 'cooldown' && account.cooldown_until && new Date(account.cooldown_until).getTime() > now) return false;
        if (account.calls_today >= this.dailyLimit) return false;
        if (scope === 'item') {
          if (account.verification_needed) return false;
          if (account.item_cooldown_until && new Date(account.item_cooldown_until).getTime() > now) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.calls_today !== b.calls_today) return a.calls_today - b.calls_today;
        const at = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const bt = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return at - bt;
      });
    return candidates[0] || null;
  }

  hasAvailable(scope = 'any') {
    return Boolean(this.pick(scope));
  }

  get(id) {
    return this.accounts.find((account) => account.id === id) || null;
  }

  markCall(id) {
    const account = this.get(id);
    if (!account) return;
    this.refresh(account);
    account.calls_today += 1;
    account.last_used_at = new Date(this.now()).toISOString();
    this.persist();
  }

  reportSuccess(id, scope = 'any') {
    const account = this.get(id);
    if (!account) return;
    account.status = 'ok';
    account.strikes = 0;
    account.success_count += 1;
    account.last_error = null;
    if (scope === 'item' || scope === 'any') {
      account.item_cooldown_until = null;
      account.verification_needed = false;
    }
    if (scope === 'search' || scope === 'any') {
      account.cooldown_until = null;
    }
    this.persist();
  }

  reportRisk(id, info = {}, scope = 'item') {
    const account = this.get(id);
    if (!account) return;
    const now = this.now();
    const kind = info.kind || GOOFISH_KINDS.RATE_LIMIT;
    account.strikes += 1;
    account.risk_count += 1;
    account.last_error = String(info.message || kind).slice(0, 300);
    if (kind === GOOFISH_KINDS.SESSION_EXPIRED) {
      account.status = 'session_expired';
      account.cooldown_until = new Date(now + COOLDOWN_STEPS[1]).toISOString();
    } else if (kind === GOOFISH_KINDS.NEEDS_VERIFICATION) {
      account.verification_needed = true;
      account.item_cooldown_until = new Date(now + COOLDOWN_STEPS[1]).toISOString();
    } else if (kind === GOOFISH_KINDS.TRANSIENT_NETWORK) {
      if (scope === 'item') account.item_cooldown_until = new Date(now + TRANSIENT_COOLDOWN).toISOString();
      else account.cooldown_until = new Date(now + TRANSIENT_COOLDOWN).toISOString();
    } else if (isRiskKind(kind) || kind === GOOFISH_KINDS.RATE_LIMIT) {
      const cooldown = COOLDOWN_STEPS[Math.min(account.strikes - 1, COOLDOWN_STEPS.length - 1)];
      if (scope === 'item') account.item_cooldown_until = new Date(now + cooldown).toISOString();
      else {
        account.status = 'cooldown';
        account.cooldown_until = new Date(now + cooldown).toISOString();
      }
    } else {
      account.status = 'cooldown';
      account.cooldown_until = new Date(now + (info.retryAfterMs || TRANSIENT_COOLDOWN)).toISOString();
    }
    this.persist();
  }

  reportTransient(id, scope = 'item') {
    this.reportRisk(id, { kind: GOOFISH_KINDS.TRANSIENT_NETWORK, message: 'network' }, scope);
  }

  updateCookieValue(id, cookie) {
    const account = this.get(id);
    if (!account) return null;
    account.cookie = cleanCookie(cookie);
    this.persist();
    return account.cookie;
  }

  updateCookie(id, cookie) {
    const account = this.get(id);
    if (!account) return null;
    account.cookie = cleanCookie(cookie);
    account.status = 'ok';
    account.cooldown_until = null;
    account.item_cooldown_until = null;
    account.verification_needed = false;
    account.strikes = 0;
    account.last_error = null;
    this.persist();
    return this.snapshotOne(account);
  }

  setCookie(cookie, label = 'основной') {
    const cleaned = cleanCookie(cookie);
    if (!cleaned) throw new Error('Пустой cookie');
    if (!this.accounts.length) {
      this.accounts.push(makeAccount({ id: 'default', label, cookie: cleaned }, 0));
    } else {
      const account = this.accounts[0];
      account.cookie = cleaned;
      account.label = label || account.label;
      account.status = 'ok';
      account.cooldown_until = null;
      account.item_cooldown_until = null;
      account.verification_needed = false;
      account.strikes = 0;
      account.last_error = null;
    }
    this.persist();
    return this.snapshotOne(this.accounts[0]);
  }

  nextAvailableAt(scope = 'any') {
    const now = this.now();
    let best = null;
    for (const account of this.accounts) {
      this.refresh(account);
      if (account.status === 'dead' || account.status === 'session_expired') continue;
      let at = now;
      if (account.status === 'cooldown' && account.cooldown_until) at = Math.max(at, new Date(account.cooldown_until).getTime());
      if (scope === 'item' && account.item_cooldown_until) at = Math.max(at, new Date(account.item_cooldown_until).getTime());
      if (account.calls_today >= this.dailyLimit) at = Math.max(at, now + DAY_MS);
      if (best === null || at < best) best = at;
    }
    return best;
  }

  health() {
    const now = this.now();
    const accounts = this.list();
    const search = this.pick('search');
    const item = this.pick('item');
    return {
      accounts,
      search_available: Boolean(search),
      item_available: Boolean(item),
      next_search_at: search ? null : this.nextAvailableAt('search'),
      next_item_at: item ? null : this.nextAvailableAt('item'),
      checked_at: new Date(now).toISOString(),
    };
  }
}
