import { calcPrice } from '../tools/pricing.js';

const BAD_TITLE = /(拆件|配件|练手|报废|料板|板底|主板|坏板|置换|寄修|电源IC|尾插|排线|屏幕总成|碎屏|屏幕破损|屏幕碎|花屏|不开机|无法开机|尸体|进水|漏液|烧屏|绿线|透图|屏幕老化|换屏|屏幕维修|小黑点|黑点|亮点|黑斑|漏光|坏点|id锁|账号锁|监管|组装|翻新|山寨|高仿|演示机|模型机|已root|root|bl刷|刷入|解锁bl|已解锁|手机壳|钢化膜|数据线|充电器|耳机|表带|支架|保护套|贴膜|包装盒|包装|说明书|取卡针|空盒|盒子|发票|保修卡|贴纸|原包装)/i;
const MINOR_RISK = /(换过电池|换电池|拆修|维修|磕碰|划痕|使用痕迹|磨损|掉漆|后盖|外壳)/i;
const ACCESSORY = /(手机壳|钢化膜|数据线|充电器|耳机|表带|支架|保护套|贴膜)/i;

export function parseBudgetRub(query) {
  const text = String(query || '');
  const match = text.match(/(?:до|бюджет|макс(?:имум)?|не более|около)\s*([\d\s]{3,9})\s*(?:₽|руб|rub|р\b)/i)
    || text.match(/([\d\s]{3,9})\s*(?:₽|руб|rub|р\b)/i);
  if (!match) return null;
  const value = Number(String(match[1]).replace(/\s+/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function fallbackKeyword(query) {
  return String(query || '')
    .replace(/(?:до|бюджет|макс(?:имум)?|не более)\s*[\d\s]{3,9}\s*(?:₽|руб|rub|р\b)/gi, ' ')
    .replace(/(?:только|нужен|нужна|ищу|подбери|найди|пожалуйста|состояние|регион|память|версия)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function parseJsonObject(text) {
  const raw = String(text || '').trim().replace(/^\u0060\u0060\u0060(?:json)?/i, '').replace(/\u0060\u0060\u0060$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function extractIntent({ query, llm, logger }) {
  const budget = parseBudgetRub(query);
  const fallback = {
    keyword: fallbackKeyword(query),
    budget_rub: budget,
    must_have: [],
    avoid: [],
    source: 'fallback',
  };
  if (!llm || !llm.chat) return fallback;
  try {
    const response = await llm.chat({
      messages: [
        {
          role: 'system',
          content:
            'Ты извлекаешь параметры поиска для Goofish. Верни СТРОГО JSON без markdown: ' +
            '{"keyword":"...","budget_rub":60000,"must_have":["国行"],"avoid":["..."]}. ' +
            'keyword — короткая строка на китайском для поиска (модель + память). budget_rub — число или null. ' +
            'must_have — важные требования (国行, 16+512, 无拆修). avoid — что исключить.',
        },
        { role: 'user', content: String(query) },
      ],
      tools: [],
    });
    const parsed = parseJsonObject(response && response.content);
    if (!parsed || !parsed.keyword) return fallback;
    return {
      keyword: String(parsed.keyword).trim().slice(0, 120) || fallback.keyword,
      budget_rub: Number.isFinite(Number(parsed.budget_rub)) && Number(parsed.budget_rub) > 0 ? Number(parsed.budget_rub) : budget,
      must_have: Array.isArray(parsed.must_have) ? parsed.must_have.map(String).filter(Boolean).slice(0, 6) : [],
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid.map(String).filter(Boolean).slice(0, 6) : [],
      source: 'llm',
    };
  } catch (err) {
    if (logger) logger.warn('search-only: не удалось извлечь intent', { error: err.message });
    return fallback;
  }
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function memoryKey(text) {
  const match = String(text || '').match(/(\d{2,3})\s*(?:\+|加|\/)\s*(1TB|2TB|\d{2,4})/i);
  return match ? match[1] + '+' + String(match[2]).toUpperCase() : null;
}

export function rankSearchOnly(items, { intent, settings } = {}) {
  const list = Array.isArray(items) ? items : [];
  const raw = list.filter((item) => item && item.item_id && item.title && !ACCESSORY.test(item.title) && !BAD_TITLE.test(item.title));
  const tokens = String((intent && intent.keyword) || '')
    .toLowerCase()
    .split(/[\s,，+/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !/^\d+(g|gb|tb)$/i.test(token));
  const primary = tokens.filter((token) => /\d/.test(token) && !/^\d+$/.test(token));
  const memoryNeed = ((intent && intent.keyword) || '') + ' ' + ((intent && intent.must_have) || []).join(' ');
  const needMemory = memoryKey(memoryNeed);
  const relevant = raw.filter((item) => {
    const title = item.title.toLowerCase();
    if (primary.length && !primary.some((token) => title.includes(token))) return false;
    if (needMemory) {
      const itemMemory = memoryKey(title);
      if (itemMemory && itemMemory !== needMemory) return false;
    }
    return true;
  });
  const safe = relevant.filter((item) => Number(item.price_cny) >= 100);
  const prices = safe.map((item) => Number(item.price_cny)).filter((n) => Number.isFinite(n) && n > 0);
  const med = median(prices);
  const rate = settings ? Number(settings.rate_cny_rub) : null;
  const maxCny = intent && intent.budget_rub && Number.isFinite(rate) && rate > 0
    ? Math.floor((intent.budget_rub / rate) * 1.05)
    : null;
  const mustHave = (intent && intent.must_have) || [];

  const ranked = safe.map((item) => {
    const price = Number(item.price_cny);
    let score = 50;
    const risks = [];
    if (Number.isFinite(price) && price < 80) {
      score -= 35;
      risks.push('подозрительно дешёвый лот');
    }
    if (maxCny !== null) {
      if (price <= maxCny) score += 15;
      else {
        score -= 30;
        risks.push('выше бюджета');
      }
    }
    if (med && price > 0) {
      const delta = (med - price) / med;
      score += Math.max(-15, Math.min(20, delta * 60));
    }
    for (const need of mustHave) {
      if (need && item.title.includes(need)) score += 5;
    }
    if (MINOR_RISK.test(item.title)) {
      score -= 8;
      risks.push('в заголовке есть следы/ремонт');
    }
    if (item.image_url) score += 2;
    else risks.push('нет фото в поиске');
    if (!item.seller_nick) risks.push('ник продавца не виден');
    return { item, score: Math.max(0, Math.min(100, Math.round(score))), risks };
  }).sort((a, b) => b.score - a.score || Number(a.item.price_cny) - Number(b.item.price_cny));

  const top = ranked.slice(0, 3);
  let priced = {};
  if (settings && top.length) {
    try {
      const result = calcPrice({
        budget_rub: intent && intent.budget_rub ? intent.budget_rub : undefined,
        items: top.map((entry) => ({ item_id: entry.item.item_id, price_cny: entry.item.price_cny })),
      }, settings);
      if (!result.error) {
        for (const row of result.results) priced[row.item_id] = row;
      }
    } catch {
      priced = {};
    }
  }

  return top.map((entry, index) => {
    const item = entry.item;
    const priceRow = priced[item.item_id] || null;
    const finalRub = priceRow ? priceRow.final_rub : null;
    const budgetStatus = intent && intent.budget_rub && finalRub && finalRub > intent.budget_rub
      ? 'выше бюджета'
      : maxCny !== null && Number(item.price_cny) > maxCny
        ? 'выше бюджета'
        : 'в рамках';
    const risks = entry.risks.slice();
    if (budgetStatus === 'выше бюджета') risks.push('итоговая цена выше бюджета');
    return {
      rank: index + 1,
      item_id: item.item_id,
      title: item.title,
      price_cny: item.price_cny,
      final_price_rub: finalRub,
      url: 'https://www.goofish.com/item?id=' + encodeURIComponent(item.item_id),
      image_url: item.image_url || null,
      seller_nick: item.seller_nick || '',
      location: item.location || '',
      publish_time: item.publish_time || '',
      score: entry.score,
      confidence: 'низкая',
      verdict: 'проверить',
      budget_status: budgetStatus,
      risks,
      photo_check: 'не проверялось',
    };
  });
}

export async function runSearchOnly({ query, provider, llm, settings, logger, reason }) {
  const startedAt = Date.now();
  const intent = await extractIntent({ query, llm, logger });
  let data = await provider.search({ keyword: intent.keyword, page: 1, sort: 'new', personalOnly: true });
  let items = rankSearchOnly(data.items || [], { intent, settings });
  if (!items.length) {
    const modelKeyword = fallbackKeyword(intent.keyword).replace(/[\s,，]*\d+\s*[+/]\s*\d+.*$/, '').trim();
    if (modelKeyword && modelKeyword !== intent.keyword) {
      data = await provider.search({ keyword: modelKeyword, page: 1, sort: 'new', personalOnly: true });
      items = rankSearchOnly(data.items || [], { intent, settings });
    }
  }
  return {
    mode: 'search_only',
    keyword: intent.keyword,
    intent,
    items,
    total_found: data.total || 0,
    reason: reason || 'карточки Goofish временно недоступны',
    duration_ms: Date.now() - startedAt,
    disclaimer: 'Это только поиск: карточка, продавец, отзывы и фото не проверены. Перед покупкой проверь вручную.',
  };
}
