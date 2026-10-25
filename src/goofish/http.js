import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { requestJson } from '../net/http.js';
import { AccountStore } from './accounts.js';
import { TtlCache } from './cache.js';
import { RateLimiter } from './limiter.js';
import {
  GOOFISH_KINDS,
  GoofishUnavailableError,
  classifyGoofishError,
  formatRetryAfter,
  toGoofishError,
} from './errors.js';
import {
  normalizeSearchResponse,
  normalizeItemResponse,
  normalizeSellerResponse,
  normalizeReviewsResponse,
} from './normalize.js';

const H5_HOST = 'https://h5api.m.goofish.com/h5';
const REFERER = 'https://www.goofish.com/';
const APP_KEY_SEARCH = '12574478';
const APP_KEY_WEB = '34839810';

function parseCookie(raw) {
  const jar = {};
  String(raw || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx > 0) jar[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    });
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => k + '=' + v)
    .join('; ');
}

function applySetCookie(jar, setCookie) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const entry of list) {
    const pair = String(entry).split(';')[0];
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value) jar[name] = value;
    else delete jar[name];
  }
}

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function parseApiSpec(spec, fallbackApi, fallbackVersion, fallbackAppKey) {
  if (!spec) return { api: fallbackApi, version: fallbackVersion, appKey: fallbackAppKey };
  const [api, version, appKey] = String(spec).split('|');
  return {
    api: api || fallbackApi,
    version: version || fallbackVersion,
    appKey: appKey || fallbackAppKey,
  };
}

function cacheTtl(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export class HttpGoofishProvider {
  constructor(options = {}) {
    const {
      cookie,
      accounts,
      dataDir,
      proxyUrl,
      userAgent,
      logger,
      apis = {},
      timeoutMs = 20000,
      minIntervalMs = 1500,
      dailyLimit = 60,
      itemTtlMs = 6 * 60 * 60 * 1000,
      searchTtlMs = 10 * 60 * 1000,
      sellerTtlMs = 12 * 60 * 60 * 1000,
      reviewsTtlMs = 12 * 60 * 60 * 1000,
    } = options;

    this.logger = logger;
    this.proxyUrl = proxyUrl || '';
    this.userAgent = userAgent;
    this.timeoutMs = timeoutMs;
    this.minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);

    this.accounts = accounts || new AccountStore({
      dataDir: dataDir || path.join(os.tmpdir(), 'goofish-accounts'),
      cookie,
      logger,
      dailyLimit,
    });
    this.limiter = new RateLimiter({ minIntervalMs: this.minIntervalMs, jitterMs: 250 });
    this.cache = {
      item: new TtlCache({ ttlMs: cacheTtl(itemTtlMs, 6 * 60 * 60 * 1000) }),
      search: new TtlCache({ ttlMs: cacheTtl(searchTtlMs, 10 * 60 * 1000) }),
      seller: new TtlCache({ ttlMs: cacheTtl(sellerTtlMs, 12 * 60 * 60 * 1000) }),
      reviews: new TtlCache({ ttlMs: cacheTtl(reviewsTtlMs, 12 * 60 * 60 * 1000) }),
    };
    this.apis = {
      search: parseApiSpec(apis.search, 'mtop.taobao.idlemtopsearch.pc.search', '1.0', APP_KEY_SEARCH),
      item: parseApiSpec(apis.item, 'mtop.taobao.idle.pc.detail', '1.0', APP_KEY_WEB),
      seller: parseApiSpec(apis.seller, 'mtop.idle.web.user.page.head', '1.0', APP_KEY_WEB),
      reviews: parseApiSpec(apis.reviews, 'mtop.idle.web.trade.rate.list', '1.0', APP_KEY_WEB),
    };
    if (this.accounts.list().length === 0 && this.logger) {
      this.logger.warn('goofish http: GOOFISH_COOKIE пуст, запросы почти наверняка будут отклонены');
    }
  }

  get token() {
    const account = this.accounts.pick('any');
    if (!account) return '';
    const jar = parseCookie(account.cookie);
    return String(jar['_m_h5_tk'] || '').split('_')[0] || '';
  }

  async callMtop(api, version, data, appKey = APP_KEY_SEARCH, scope = 'any') {
    const account = this.accounts.pick(scope);
    if (!account) {
      const next = this.accounts.nextAvailableAt(scope);
      const wait = next ? Math.max(0, next - Date.now()) : 0;
      throw new GoofishUnavailableError(
        'Нет доступного аккаунта Goofish' + (wait ? ', ближайший через ' + formatRetryAfter(wait) : '') + '.',
        { retryAfterMs: wait || 15 * 60 * 1000 },
      );
    }

    this.accounts.markCall(account.id);
    const dataStr = JSON.stringify(data);
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const jar = parseCookie(this.accounts.get(account.id)?.cookie || account.cookie);
      const token = String(jar['_m_h5_tk'] || '').split('_')[0] || '';
      const t = Date.now();
      const sign = md5(token + '&' + t + '&' + appKey + '&' + dataStr);
      const qs = new URLSearchParams({
        jsv: '2.7.2',
        appKey,
        t: String(t),
        sign,
        api,
        v: version,
        type: 'originaljson',
        accountSite: 'xianyu',
        dataType: 'json',
        timeout: '20000',
      });
      const url = H5_HOST + '/' + api + '/' + version + '/?' + qs.toString();
      await this.limiter.wait();

      try {
        const json = await requestJson(url, {
          method: 'POST',
          headers: {
            cookie: cookieHeader(jar),
            referer: REFERER,
            origin: 'https://www.goofish.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'data=' + encodeURIComponent(dataStr),
          proxyUrl: this.proxyUrl,
          timeoutMs: this.timeoutMs,
          userAgent: this.userAgent,
          onResponseHeaders: (headers) => {
            applySetCookie(jar, headers['set-cookie']);
            if (this.accounts.updateCookieValue) this.accounts.updateCookieValue(account.id, cookieHeader(jar));
          },
        });

        const ret = Array.isArray(json.ret) ? json.ret.join('; ') : String(json.ret || '');
        if (!ret || ret.includes('SUCCESS')) {
          this.accounts.reportSuccess(account.id, scope);
          return json;
        }

        lastError = new Error('mtop ' + api + ': ' + ret);
        const info = classifyGoofishError(lastError);
        if (info.kind === GOOFISH_KINDS.TOKEN_REFRESHABLE && attempt === 0) {
          continue;
        }
        this.accounts.reportRisk(account.id, { ...info, message: ret }, scope);
        throw toGoofishError(lastError, { scope, accountId: account.id });
      } catch (err) {
        if (err && err.name === 'GoofishError') throw err;
        lastError = err;
        const info = classifyGoofishError(err);
        if (info.kind === GOOFISH_KINDS.TOKEN_REFRESHABLE && attempt === 0) continue;
        if (info.kind === GOOFISH_KINDS.TRANSIENT_NETWORK && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        this.accounts.reportRisk(account.id, info, scope);
        throw toGoofishError(err, { scope, accountId: account.id });
      }
    }

    throw toGoofishError(lastError || new Error('mtop ' + api + ': неизвестная ошибка'), { scope, accountId: account.id });
  }

  cacheKey(scope, value) {
    return scope + ':' + value;
  }

  async search({ keyword, priceMin = null, priceMax = null, sort = 'new', page = 1, personalOnly = true }) {
    const key = this.cacheKey(
      'search',
      JSON.stringify([keyword, priceMin, priceMax, sort, page, personalOnly]),
    );
    const cached = this.cache.search.get(key);
    if (cached) return { ...cached, cached: true };

    const data = {
      pageNumber: Math.max(1, Math.floor(page || 1)),
      keyword,
      fromFilter: false,
      rowsPerPage: 30,
      sortValue: sort === 'price_asc' ? 'price' : '',
      sortField: sort === 'price_asc' ? 'asc' : '',
      customDistance: '',
      gps: '',
      propValueStr: {},
      customGps: '',
      searchReqFromPage: 'pcSearch',
      extraFilterValue: '{}',
      userPositionJson: '{}',
    };
    const json = await this.callMtop(this.apis.search.api, this.apis.search.version, data, this.apis.search.appKey, 'search');
    let items = normalizeSearchResponse(json);
    if (priceMin !== null) items = items.filter((i) => i.price_cny !== null && i.price_cny >= priceMin);
    if (priceMax !== null) items = items.filter((i) => i.price_cny !== null && i.price_cny <= priceMax);
    if (sort === 'price_asc') items = items.slice().sort((a, b) => (a.price_cny || 0) - (b.price_cny || 0));
    const result = {
      items,
      total: items.length,
      page: data.pageNumber,
      page_size: data.rowsPerPage,
      personal_only: personalOnly,
      provider: 'http',
    };
    this.cache.search.set(key, result);
    return result;
  }

  async item(itemId) {
    const key = this.cacheKey('item', String(itemId));
    const cached = this.cache.item.get(key);
    if (cached) return { ...cached, cached: true };
    const json = await this.callMtop(this.apis.item.api, this.apis.item.version, { itemId: String(itemId) }, this.apis.item.appKey, 'item');
    const item = normalizeItemResponse(json);
    if (!item.item_id) item.item_id = String(itemId);
    this.cache.item.set(key, item);
    return item;
  }

  async seller(sellerId) {
    const key = this.cacheKey('seller', String(sellerId));
    const cached = this.cache.seller.get(key);
    if (cached) return { ...cached, cached: true };
    const json = await this.callMtop(this.apis.seller.api, this.apis.seller.version, { userId: String(sellerId) }, this.apis.seller.appKey, 'item');
    const seller = normalizeSellerResponse(json);
    if (!seller.seller_id) seller.seller_id = String(sellerId);
    this.cache.seller.set(key, seller);
    return seller;
  }

  async reviews(sellerId, page = 1) {
    const safePage = Math.max(1, Math.floor(page || 1));
    const key = this.cacheKey('reviews', String(sellerId) + ':' + safePage);
    const cached = this.cache.reviews.get(key);
    if (cached) return { ...cached, cached: true };
    const json = await this.callMtop(this.apis.reviews.api, this.apis.reviews.version, {
      rateType: 0,
      ratedUid: String(sellerId),
      raterType: 0,
      rowsPerPage: 20,
      pageNumber: safePage,
      foldFlag: 0,
      fishAdCode: '330110',
      extraTag: '',
    }, this.apis.reviews.appKey, 'item');
    const normalized = normalizeReviewsResponse(json);
    if (!normalized.seller_id) normalized.seller_id = String(sellerId);
    normalized.page = safePage;
    this.cache.reviews.set(key, normalized);
    return normalized;
  }

  health() {
    const accounts = this.accounts.health();
    return {
      ...accounts,
      provider: 'http',
      cache: {
        item: this.cache.item.stats(),
        search: this.cache.search.stats(),
        seller: this.cache.seller.stats(),
        reviews: this.cache.reviews.stats(),
      },
    };
  }

  itemAvailable() {
    return this.accounts.health().item_available;
  }

  searchAvailable() {
    return this.accounts.health().search_available;
  }
}
