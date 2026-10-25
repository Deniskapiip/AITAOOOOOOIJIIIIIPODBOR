import { GOOFISH_KINDS, GoofishError } from '../goofish/errors.js';

export class LabProvider {
  constructor(scenario, options = {}) {
    this.scenario = scenario;
    this.trace = options.trace || [];
    this.logger = options.logger || null;
  }

  health() {
    return { provider: 'lab', accounts: [], search_available: true, item_available: true, next_search_at: null, next_item_at: null };
  }

  itemAvailable() { return true; }
  searchAvailable() { return true; }

  async search({ keyword, priceMin = null, priceMax = null, sort = 'new', page = 1 } = {}) {
    this.trace.push({ method: 'search', key: String(keyword || '') });
    let items = (this.scenario.provider_data.search || []).slice();
    if (priceMin !== null) items = items.filter((i) => Number(i.price_cny) >= Number(priceMin));
    if (priceMax !== null) items = items.filter((i) => Number(i.price_cny) <= Number(priceMax));
    if (sort === 'price_asc') items.sort((a, b) => Number(a.price_cny) - Number(b.price_cny));
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const pageSize = 30;
    const slice = items.slice((safePage - 1) * pageSize, safePage * pageSize);
    return { items: slice, total: items.length, page: safePage, page_size: pageSize, personal_only: true, provider: 'lab' };
  }

  async item(itemId) {
    const id = String(itemId);
    this.trace.push({ method: 'item', key: id });
    const errors = this.scenario.provider_data.errors || {};
    if (errors[id]) {
      throw new GoofishError(GOOFISH_KINDS.RATE_LIMIT, 'RGV587 на карточке (lab)', { scope: 'item', retryAfterMs: 30 * 60 * 1000 });
    }
    const item = this.scenario.provider_data.items[id];
    if (!item) {
      const err = new Error('Лот не найден: ' + id);
      err.code = 'item_not_found';
      throw err;
    }
    return { ...item, provider: 'lab' };
  }

  async seller(sellerId) {
    const id = String(sellerId);
    this.trace.push({ method: 'seller', key: id });
    const seller = this.scenario.provider_data.sellers[id];
    if (!seller) {
      const err = new Error('Продавец не найден: ' + id);
      err.code = 'seller_not_found';
      throw err;
    }
    return { ...seller, provider: 'lab' };
  }

  async reviews(sellerId, page = 1) {
    const id = String(sellerId);
    this.trace.push({ method: 'reviews', key: id + ':' + page });
    const list = this.scenario.provider_data.reviews[id] || [];
    return { seller_id: id, reviews: list, total: list.length, page: Math.max(1, Number(page) || 1), page_size: 20, provider: 'lab' };
  }
}
