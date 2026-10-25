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
    .replace(/\r/g, '')
    .trim();
}

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

function normalizeItemId(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  if (!/^https?:\/\//.test(u)) return null;
  return u;
}

export function toIso(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' || /^\d{10,}$/.test(String(value))) {
    const n = Number(value);
    const ms = String(value).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export function normalizeSearchItem(raw) {
  const main = (raw && raw.data && raw.data.item && raw.data.item.main) || (raw && raw.data && raw.data.item) || (raw && raw.data) || raw || {};
  const args = (main.clickParam && main.clickParam.args) || {};
  const ex = main.exContent || {};
  const detail = ex.detailParams || {};
  const itemId = args.id || args.item_id || detail.itemId || ex.itemId;
  const price = toNumber(args.price !== undefined ? args.price : detail.soldPrice !== undefined ? detail.soldPrice : ex.soldPrice);
  return {
    item_id: normalizeItemId(itemId),
    title: stripHtml(ex.title || detail.title || args.title || ''),
    price_cny: price,
    location: String(ex.area || args.area || ''),
    seller_id: null,
    seller_nick: String(ex.userNickName || detail.userNick || ''),
    seller_ref: String(args.seller_id || ''),
    publish_time: toIso(args.publishTime !== undefined ? args.publishTime : ex.publishTime),
    condition_tags: [],
    want_count: toNumber(ex.want !== undefined ? ex.want : args.want),
    image_url: normalizeImageUrl(ex.picUrl || args.picUrl),
  };
}

export function normalizeSearchResponse(json) {
  const list = deepArray(json, ['resultList', 'itemList', 'items', 'list', 'auctions', 'dataList'], 4) || [];
  return list.map(normalizeSearchItem).filter((item) => item.item_id && item.title);
}

export function normalizeItemResponse(json) {
  const data = (json && json.data) || {};
  const item = data.itemDO || {};
  const seller = data.sellerDO || {};
  const labels = Array.isArray(item.itemLabelExtList) ? item.itemLabelExtList : [];
  const labelMap = {};
  for (const label of labels) {
    if (label && label.propertyText) labelMap[label.propertyText] = label.valueText;
  }
  const conditionTags = ['成色', '版本', '存储容量', '运行内存', '拆修和功能', '品牌', '型号']
    .filter((key) => labelMap[key])
    .map((key) => key + ': ' + labelMap[key]);
  const images = (Array.isArray(item.imageInfos) ? item.imageInfos : [])
    .map((entry) => normalizeImageUrl(entry && (entry.url || entry.majorUrl || entry.originUrl)))
    .filter(Boolean);
  const fee = toNumber(item.transportFee);
  const statusText = String(item.itemStatusStr || '');
  let status = 'active';
  if (!/在线|在售/.test(statusText) && Number(item.itemStatus) !== 0) status = 'sold';
  const zhima = seller.zhimaLevelInfo || {};
  return {
    item_id: normalizeItemId(item.itemId || data.itemId),
    title: stripHtml(item.title || ''),
    price_cny: toNumber(item.soldPrice !== undefined ? item.soldPrice : item.defaultPrice),
    original_price_cny: toNumber(item.originalPrice) || null,
    status,
    description: stripHtml(item.desc || ''),
    condition_tags: conditionTags,
    image_urls: images,
    has_video: Boolean(deepFirst(data, ['videoUrl', 'videoInfo', 'hasVideo']) || false),
    delivery: {
      mode: fee === 0 ? '包邮' : fee !== null ? 'доставка' : '',
      ship_fee_cny: fee,
      from_city: String(seller.publishCity || seller.city || ''),
    },
    location: String(seller.publishCity || seller.city || ''),
    want_count: toNumber(item.wantCnt),
    view_count: toNumber(item.browseCnt),
    publish_time: toIso(item.gmtCreate),
    seller_id: normalizeItemId(seller.sellerId),
    seller_nick: String(seller.nick || ''),
    seller_credit: String(zhima.levelName || ''),
    seller_registered_at: toIso(seller.registerTime),
    provider: 'http',
  };
}

export function normalizeSellerResponse(json) {
  const data = (json && json.data) || {};
  const baseInfo = data.baseInfo || {};
  const module = data.module || {};
  const base = module.base || {};
  const tags = baseInfo.tags || {};
  const levelTag = (Array.isArray(base.ylzTags) ? base.ylzTags : []).find((tag) => tag && tag.code === 'cs_seller_level');
  const rateTab = (module.tabs && module.tabs.rate) || {};
  return {
    seller_id: normalizeItemId(baseInfo.kcUserId || deepFirst(data, ['sellerId', 'userId'])),
    nickname: String(base.displayName || deepFirst(data, ['nick', 'nickname']) || ''),
    zhima_credit: null,
    zhima_text: String((levelTag && levelTag.text) || ''),
    verified: Boolean(tags.real_name_certification_77 || tags.real_person_certification_77 || false),
    registered_at: toIso(deepFirst(data, ['registerTime', 'userRegDay', 'gmtCreate'])),
    sold_count: toNumber(deepFirst(data, ['soldCount', 'sellCount', 'hasSoldNumInteger'])),
    praise_rate: toNumber(deepFirst(data, ['praiseRate', 'goodRate', 'positiveRate'])),
    location: String(base.ipLocation || ''),
    items_sample: [],
    reviews_count: toNumber(rateTab.number),
    provider: 'http',
  };
}

export function normalizeReviewsResponse(json) {
  const data = (json && json.data) || {};
  const list = Array.isArray(data.cardList) ? data.cardList : [];
  const reviews = list.map((card) => {
    const cardData = card && (card.cardData || card.data || card);
    const content = cardData && (cardData.feedback || cardData.content || cardData.rateContent || cardData.comment || cardData.text);
    return {
      review_id: String((cardData && (cardData.rateId || cardData.id)) || ''),
      created_at: toIso(cardData && (cardData.gmtCreate || cardData.rateTime || cardData.createTime || cardData.gmtCreateStr)),
      rating: toNumber(cardData && (cardData.rate !== undefined ? cardData.rate : cardData.rateStar || cardData.score || cardData.star)),
      text: stripHtml(typeof content === 'string' ? content : ''),
      item_id: normalizeItemId(cardData && (cardData.itemId || cardData.auctionId)),
    };
  });
  return {
    reviews,
    total: toNumber(data.totalCount || data.total || data.rateCount) || reviews.length,
    page: 1,
    provider: 'http',
  };
}
