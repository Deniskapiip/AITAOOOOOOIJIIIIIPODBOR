import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'));
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '');
}

function summary(listing) {
  return {
    item_id: listing.item_id,
    title: listing.title,
    price_cny: listing.price_cny,
    location: listing.location,
    seller_id: listing.seller_id,
    publish_time: listing.publish_time,
    condition_tags: listing.condition_tags,
    want_count: listing.want_count,
    image_url: (listing.image_urls || [])[0] || null,
  };
}

export class MockGoofishProvider {
  constructor({ logger, latencyMs = 0 } = {}) {
    this.logger = logger;
    this.latencyMs = latencyMs;
    this.listings = readJson('listings.json');
    this.sellers = readJson('sellers.json');
    this.reviewsBySeller = readJson('reviews.json');
    this.byId = new Map(this.listings.map((l) => [l.item_id, l]));
    this.sellerById = new Map(this.sellers.map((s) => [s.seller_id, s]));
  }

  async delay() {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  health() {
    return {
      provider: 'mock',
      accounts: [],
      search_available: true,
      item_available: true,
      next_search_at: null,
      next_item_at: null,
    };
  }

  itemAvailable() {
    return true;
  }

  searchAvailable() {
    return true;
  }

  async search(params) {
    const {
      keyword,
      priceMin = null,
      priceMax = null,
      sort = 'new',
      page = 1,
      personalOnly = true,
    } = params || {};
    await this.delay();
    const kw = normalize(keyword);
    if (!kw) throw new Error('Пустой поисковый запрос');

    let items = this.listings.filter((l) => {
      const patterns = (l.match || []).map(normalize);
      return patterns.some((p) => p && kw.includes(p));
    });

    if (personalOnly) {
      items = items.filter((l) => {
        const seller = this.sellerById.get(l.seller_id);
        return !seller || !seller.is_shop;
      });
    }
    if (priceMin !== null) items = items.filter((l) => l.price_cny >= priceMin);
    if (priceMax !== null) items = items.filter((l) => l.price_cny <= priceMax);

    items = items.slice().sort((a, b) => {
      if (sort === 'price_asc') return a.price_cny - b.price_cny;
      return new Date(b.publish_time).getTime() - new Date(a.publish_time).getTime();
    });

    const pageSize = 20;
    const total = items.length;
    const safePage = Math.max(1, Math.floor(page || 1));
    const slice = items.slice((safePage - 1) * pageSize, safePage * pageSize);

    return {
      items: slice.map(summary),
      total,
      page: safePage,
      page_size: pageSize,
      personal_only: personalOnly,
      provider: 'mock',
    };
  }

  async item(itemId) {
    await this.delay();
    const listing = this.byId.get(String(itemId));
    if (!listing) {
      const err = new Error('Лот не найден: ' + itemId);
      err.code = 'item_not_found';
      throw err;
    }
    return {
      item_id: listing.item_id,
      title: listing.title,
      price_cny: listing.price_cny,
      original_price_cny: listing.original_price_cny,
      status: listing.status,
      description: listing.description,
      condition_tags: listing.condition_tags,
      image_urls: listing.image_urls,
      has_video: listing.has_video,
      delivery: listing.delivery,
      location: listing.location,
      want_count: listing.want_count,
      view_count: listing.view_count,
      publish_time: listing.publish_time,
      seller_id: listing.seller_id,
      provider: 'mock',
    };
  }

  async seller(sellerId) {
    await this.delay();
    const seller = this.sellerById.get(String(sellerId));
    if (!seller) {
      const err = new Error('Продавец не найден: ' + sellerId);
      err.code = 'seller_not_found';
      throw err;
    }
    return { ...seller, provider: 'mock' };
  }

  async reviews(sellerId, page = 1) {
    await this.delay();
    const list = this.reviewsBySeller[String(sellerId)];
    if (!list) {
      const err = new Error('Отзывы не найдены: ' + sellerId);
      err.code = 'seller_not_found';
      throw err;
    }
    const pageSize = 10;
    const safePage = Math.max(1, Math.floor(page || 1));
    const slice = list.slice((safePage - 1) * pageSize, safePage * pageSize);
    return {
      seller_id: String(sellerId),
      reviews: slice,
      total: list.length,
      page: safePage,
      page_size: pageSize,
      provider: 'mock',
    };
  }
}
