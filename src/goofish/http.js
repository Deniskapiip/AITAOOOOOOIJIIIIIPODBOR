import crypto from 'node:crypto';
import { requestJson } from '../net/http.js';
import {
  normalizeSearchResponse,
  normalizeItemResponse,
  normalizeSellerResponse,
  normalizeReviewsResponse,
} from './normalize.js';

const H5_HOST = 'https://h5api.m.goofish.com/h5';
const APP_KEY = '12574478';
const REFERER = 'https://www.goofish.com/';

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

function parseApiSpec(spec, fallbackApi, fallbackVersion) {
  if (!spec) return { api: fallbackApi, version: fallbackVersion };
  const [api, version] = String(spec).split('|');
  return { api: api || fallbackApi, version: version || fallbackVersion };
}

export class HttpGoofishProvider {
  constructor({ cookie, proxyUrl, userAgent, logger, apis = {}, timeoutMs = 20000 } = {}) {
    this.cookieJar = parseCookie(cookie);
    this.proxyUrl = proxyUrl || '';
    this.userAgent = userAgent;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.apis = {
      search: parseApiSpec(apis.search, 'mtop.taobao.idlemtopsearch.pc.search', '1.0'),
      item: parseApiSpec(apis.item, 'mtop.taobao.idle.item.detail', '1.0'),
      seller: parseApiSpec(apis.seller, 'mtop.taobao.idle.user.page', '1.0'),
      reviews: parseApiSpec(apis.reviews, 'mtop.taobao.idle.user.rate.list', '1.0'),
    };
    if (!Object.keys(this.cookieJar).length) {
      if (this.logger) this.logger.warn('goofish http: GOOFISH_COOKIE пуст, запросы почти наверняка будут отклонены');
    }
  }

  get token() {
    const raw = this.cookieJar['_m_h5_tk'] || '';
    return raw.split('_')[0] || '';
  }

  async callMtop(api, version, data) {
    const dataStr = JSON.stringify(data);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t = Date.now();
      const sign = md5(this.token + '&' + t + '&' + APP_KEY + '&' + dataStr);
      const qs = new URLSearchParams({
        jsv: '2.7.2',
        appKey: APP_KEY,
        t: String(t),
        sign,
        api,
        v: version,
        type: 'originaljson',
        dataType: 'json',
        timeout: '20000',
      });
      const url = H5_HOST + '/' + api + '/' + version + '/?' + qs.toString();
      try {
        const json = await requestJson(url, {
          method: 'POST',
          headers: {
            cookie: cookieHeader(this.cookieJar),
            referer: REFERER,
            origin: 'https://www.goofish.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'data=' + encodeURIComponent(dataStr),
          proxyUrl: this.proxyUrl,
          timeoutMs: this.timeoutMs,
          userAgent: this.userAgent,
          onResponseHeaders: (headers) => applySetCookie(this.cookieJar, headers['set-cookie']),
        });
        const ret = Array.isArray(json.ret) ? json.ret.join('; ') : String(json.ret || '');
        if (ret && !ret.includes('SUCCESS')) {
          lastError = new Error('mtop ' + api + ': ' + ret);
          if (ret.includes('TOKEN') && attempt === 0) continue;
          throw lastError;
        }
        return json;
      } catch (err) {
        lastError = err;
        if (attempt === 0 && /TOKEN|SIGN/i.test(String(err.message))) continue;
        throw err;
      }
    }
    throw lastError || new Error('mtop ' + api + ': неизвестная ошибка');
  }

  async search({ keyword, priceMin = null, priceMax = null, sort = 'new', page = 1, personalOnly = true }) {
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
    const json = await this.callMtop(this.apis.search.api, this.apis.search.version, data);
    let items = normalizeSearchResponse(json);
    if (priceMin !== null) items = items.filter((i) => i.price_cny !== null && i.price_cny >= priceMin);
    if (priceMax !== null) items = items.filter((i) => i.price_cny !== null && i.price_cny <= priceMax);
    if (sort === 'price_asc') items = items.slice().sort((a, b) => (a.price_cny || 0) - (b.price_cny || 0));
    return {
      items,
      total: items.length,
      page: data.pageNumber,
      page_size: data.rowsPerPage,
      personal_only: personalOnly,
      provider: 'http',
    };
  }

  async item(itemId) {
    const json = await this.callMtop(this.apis.item.api, this.apis.item.version, { itemId: String(itemId) });
    const item = normalizeItemResponse(json);
    if (!item.item_id) item.item_id = String(itemId);
    return item;
  }

  async seller(sellerId) {
    const json = await this.callMtop(this.apis.seller.api, this.apis.seller.version, { sellerId: String(sellerId) });
    const seller = normalizeSellerResponse(json);
    if (!seller.seller_id) seller.seller_id = String(sellerId);
    return seller;
  }

  async reviews(sellerId, page = 1) {
    const json = await this.callMtop(this.apis.reviews.api, this.apis.reviews.version, {
      sellerId: String(sellerId),
      pageNumber: Math.max(1, Math.floor(page || 1)),
      pageSize: 10,
    });
    const normalized = normalizeReviewsResponse(json);
    if (!normalized.seller_id) normalized.seller_id = String(sellerId);
    normalized.page = Math.max(1, Math.floor(page || 1));
    return normalized;
  }
}
