export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function toBool(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
  return false;
}

export function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

// Ищет первое значение по списку ключей на любом уровне вложенности.
export function deepFirst(obj, keys, maxDepth = 8) {
  if (!obj || typeof obj !== 'object' || maxDepth < 0) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== null && value !== undefined && value !== '') return value;
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = deepFirst(value, keys, maxDepth - 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function deepArray(obj, keys, maxDepth = 8) {
  if (!obj || typeof obj !== 'object' || maxDepth < 0) return null;
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value) && value.length) return value;
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = deepArray(value, keys, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}

function pick(obj, paths) {
  for (const p of paths) {
    let cur = obj;
    let ok = true;
    for (const part of p.split('.')) {
      if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
      else {
        ok = false;
        break;
      }
    }
    if (ok && cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
}

function normalizeItemId(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return /^\d+$/.test(s) ? s : s || null;
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//.test(u)) return null;
  return u;
}

export function normalizeSearchItem(raw) {
  const data = raw && (raw.data || raw.item || raw) ? raw.data || raw.item || raw : {};
  const price = toNumber(
    pick(data, ['price', 'priceCny', 'soldPrice', 'priceInfo.price', 'priceInfo.priceText']) ??
      deepFirst(data, ['price', 'soldPrice', 'priceText']),
  );
  const itemId = normalizeItemId(
    pick(data, ['itemId', 'id', 'item_id', 'itemid']) ?? deepFirst(data, ['itemId', 'item_id', 'id']),
  );
  const title = stripHtml(
    pick(data, ['title', 'itemTitle', 'subject']) ?? deepFirst(data, ['title', 'itemTitle', 'subject']) ?? '',
  );
  return {
    item_id: itemId,
    title,
    price_cny: price,
    location: String(pick(data, ['location', 'area', 'city']) ?? deepFirst(data, ['location', 'area']) ?? ''),
    seller_id: normalizeItemId(pick(data, ['sellerId', 'userId', 'seller_id']) ?? deepFirst(data, ['sellerId', 'userId'])),
    publish_time: String(pick(data, ['publishTime', 'createTime', 'gmtCreate']) ?? deepFirst(data, ['publishTime', 'createTime']) ?? ''),
    condition_tags: Array.isArray(pick(data, ['conditionTags', 'tags'])) ? pick(data, ['conditionTags', 'tags']) : [],
    want_count: toNumber(pick(data, ['wantCount', 'want_cnt']) ?? deepFirst(data, ['wantCount'])),
    image_url: normalizeImageUrl(
      pick(data, ['imageUrl', 'picUrl', 'image']) ?? deepFirst(data, ['imageUrl', 'picUrl']),
    ),
  };
}

export function normalizeSearchResponse(json) {
  const list =
    deepArray(json, ['resultList', 'itemList', 'items', 'list', 'auctions', 'dataList'], 4) || [];
  return list
    .map(normalizeSearchItem)
    .filter((item) => item.item_id && item.title);
}

export function normalizeItemResponse(json) {
  const item = pick(json, ['data.itemDO', 'data.item', 'data', 'itemDO', 'item']) || json;
  const data = item && item.itemDO ? item.itemDO : item;
  const itemId = normalizeItemId(
    pick(data, ['itemId', 'id']) ?? pick(json, ['itemId']) ?? deepFirst(json, ['itemId', 'item_id']),
  );
  const price = toNumber(
    pick(data, ['soldPrice', 'price', 'priceInfo.price']) ?? deepFirst(json, ['soldPrice', 'price']),
  );
  const originalPrice = toNumber(
    pick(data, ['originalPrice', 'oriPrice', 'priceInfo.originalPrice']) ?? deepFirst(json, ['originalPrice', 'oriPrice']),
  );
  const description = stripHtml(
    pick(data, ['desc', 'description', 'itemDesc']) ?? deepFirst(json, ['desc', 'description']) ?? '',
  );
  const imagesRaw =
    pick(data, ['imageInfos', 'images', 'imageList', 'picUrlList']) ??
    deepArray(json, ['imageInfos', 'images', 'imageList'], 3) ??
    [];
  const imageUrls = (Array.isArray(imagesRaw) ? imagesRaw : [])
    .map((entry) => {
      if (typeof entry === 'string') return normalizeImageUrl(entry);
      return normalizeImageUrl(entry && (entry.url || entry.imageUrl || entry.picUrl || entry.originUrl));
    })
    .filter(Boolean);
  const soldOut = toBool(deepFirst(json, ['soldOut', 'isSoldOut']) || false);
  const itemStatus = pick(data, ['itemStatus', 'status']) ?? deepFirst(json, ['itemStatus']);
  let status = 'active';
  if (soldOut) status = 'sold';
  else if (itemStatus !== undefined) {
    const n = Number(itemStatus);
    if (Number.isFinite(n) && n !== 0 && n !== 1) status = 'offline';
  }
  const delivery = {
    mode: String(
      pick(data, ['delivery.mode', 'deliveryMode', 'shippingMode']) ??
        deepFirst(json, ['deliveryMode', 'shippingMode']) ??
        '',
    ),
    ship_fee_cny: toNumber(deepFirst(json, ['shipFee', 'postFee', 'freight'])),
    from_city: String(
      pick(data, ['delivery.fromCity', 'city']) ?? deepFirst(json, ['fromCity', 'city']) ?? '',
    ),
  };
  const sellerId = normalizeItemId(
    pick(data, ['sellerId', 'userId']) ?? deepFirst(json, ['sellerId', 'userId']),
  );
  return {
    item_id: itemId,
    title: stripHtml(pick(data, ['title', 'subject']) ?? deepFirst(json, ['title', 'subject']) ?? ''),
    price_cny: price,
    original_price_cny: originalPrice,
    status,
    description,
    condition_tags: Array.isArray(deepFirst(json, ['conditionTags', 'tags'])) ? deepFirst(json, ['conditionTags', 'tags']) : [],
    image_urls: imageUrls,
    has_video: toBool(deepFirst(json, ['hasVideo', 'videoUrl']) || false),
    delivery,
    location: String(pick(data, ['location', 'area']) ?? deepFirst(json, ['location']) ?? ''),
    want_count: toNumber(deepFirst(json, ['wantCount', 'want_cnt'])),
    view_count: toNumber(deepFirst(json, ['viewCount', 'browseCount'])),
    publish_time: String(deepFirst(json, ['publishTime', 'createTime', 'gmtCreate']) ?? ''),
    seller_id: sellerId,
    provider: 'http',
  };
}

export function normalizeSellerResponse(json) {
  const data = pick(json, ['data.userDO', 'data.user', 'data', 'userDO', 'user']) || json;
  const sellerId = normalizeItemId(deepFirst(json, ['sellerId', 'userId', 'id']));
  return {
    seller_id: sellerId,
    nickname: stripHtml(String(deepFirst(json, ['nick', 'nickname', 'userNick']) ?? '')),
    zhima_credit: toNumber(deepFirst(json, ['zhimaCredit', 'zhimaScore', 'creditScore'])),
    verified: toBool(deepFirst(json, ['verified', 'realNameVerified', 'idCardVerified']) || false),
    registered_at: String(deepFirst(json, ['registeredAt', 'registerTime', 'gmtCreate', 'createdAt']) ?? ''),
    sold_count: toNumber(deepFirst(json, ['soldCount', 'sellCount', 'soldNum'])),
    praise_rate: toNumber(deepFirst(json, ['praiseRate', 'goodRate', 'positiveRate'])),
    location: String(deepFirst(json, ['location', 'city', 'area']) ?? ''),
    items_sample: [],
    provider: 'http',
  };
}

export function normalizeReviewsResponse(json) {
  const list =
    deepArray(json, ['reviews', 'rateList', 'commentList', 'list', 'dataList'], 4) || [];
  return {
    seller_id: normalizeItemId(deepFirst(json, ['sellerId', 'userId'])) || '',
    reviews: list.map((entry) => ({
      review_id: String(deepFirst(entry, ['reviewId', 'rateId', 'id']) ?? ''),
      created_at: String(deepFirst(entry, ['createdAt', 'gmtCreate', 'createTime', 'rateTime']) ?? ''),
      rating: toNumber(deepFirst(entry, ['rating', 'rateStar', 'score', 'star'])),
      text: stripHtml(String(deepFirst(entry, ['content', 'text', 'comment', 'feedback']) ?? '')),
      item_id: normalizeItemId(deepFirst(entry, ['itemId', 'auctionId'])),
    })),
    total: toNumber(deepFirst(json, ['total', 'totalCount', 'count'])) || list.length,
    page: 1,
    provider: 'http',
  };
}
