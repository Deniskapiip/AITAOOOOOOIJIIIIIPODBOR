import { TRAP_IDS, CATEGORIES } from './scenarios.js';

const VERDICTS = new Set(['брать', 'проверить', 'пропустить']);
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

export function validateScenario(s) {
  const errors = [];
  if (!s || typeof s !== 'object') return ['scenario is not an object'];
  if (!s.id || !/^[a-z0-9_-]+$/.test(s.id)) errors.push('bad id');
  if (!CATEGORY_IDS.has(s.category)) errors.push('bad category: ' + s.category);
  if (!s.client_query || s.client_query.length < 8) errors.push('empty client_query');
  if (!(Number(s.budget_cny) > 0)) errors.push('bad budget_cny');
  const pd = s.provider_data || {};
  const search = Array.isArray(pd.search) ? pd.search : [];
  if (search.length < 8 || search.length > 25) errors.push('search must be 8-25 lots, got ' + search.length);
  if (!pd.items || typeof pd.items !== 'object') errors.push('no items');
  if (!pd.sellers || typeof pd.sellers !== 'object') errors.push('no sellers');
  if (!pd.reviews || typeof pd.reviews !== 'object') errors.push('no reviews');
  const itemIds = new Set(Object.keys(pd.items || {}));
  for (const entry of search) {
    if (!entry.item_id || !itemIds.has(entry.item_id)) errors.push('search item missing: ' + (entry.item_id || '?'));
    if (!Number.isFinite(Number(entry.price_cny))) errors.push('search price bad: ' + (entry.item_id || '?'));
  }
  for (const [id, item] of Object.entries(pd.items || {})) {
    if (!item.title || !Number.isFinite(Number(item.price_cny))) errors.push('item fields bad: ' + id);
    if (!item.seller_id || !pd.sellers[item.seller_id]) errors.push('seller missing for ' + id);
    if (!Array.isArray(item.image_urls)) errors.push('image_urls not array: ' + id);
  }
  for (const [id, list] of Object.entries(s.images || {})) {
    if (!itemIds.has(id)) errors.push('image for unknown item: ' + id);
    if (!Array.isArray(list) || !list.length) errors.push('empty images: ' + id);
    for (const entry of list || []) {
      if (!entry.file || !entry.url || !entry.truth) errors.push('bad image entry: ' + id);
      if (typeof entry.truth.screen_visible !== 'boolean') errors.push('truth.screen_visible bad: ' + id);
      if (!Array.isArray(entry.truth.cracks)) errors.push('truth.cracks bad: ' + id);
    }
  }
  const exp = s.expected || {};
  if (!Array.isArray(exp.top_must_include)) errors.push('top_must_include not array');
  if (!Array.isArray(exp.top_must_exclude)) errors.push('top_must_exclude not array');
  if (!Array.isArray(exp.traps)) errors.push('expected.traps not array');
  if (!exp.notes || String(exp.notes).length < 5) errors.push('empty notes');
  for (const id of [...(exp.top_must_include || []), ...(exp.top_must_exclude || [])]) {
    if (!itemIds.has(id)) errors.push('expected id missing: ' + id);
  }
  for (const [id, verdict] of Object.entries(exp.verdicts || {})) {
    if (!itemIds.has(id)) errors.push('verdict id missing: ' + id);
    if (!VERDICTS.has(verdict)) errors.push('bad verdict: ' + verdict);
  }
  for (const [id, reason] of Object.entries(exp.stop_factor_ids || {})) {
    if (!itemIds.has(id)) errors.push('stop id missing: ' + id);
    if (!reason) errors.push('empty stop reason: ' + id);
  }
  for (const trap of s.traps || []) if (!TRAP_IDS.includes(trap)) errors.push('unknown trap: ' + trap);
  return errors;
}

export function validateCatalog(scenarios) {
  const errors = [];
  if (!Array.isArray(scenarios) || scenarios.length < 40) errors.push('need >=40 scenarios, got ' + (scenarios ? scenarios.length : 0));
  const categories = new Set();
  const trapCounts = {};
  const ids = new Set();
  let allBad = 0;
  for (const s of scenarios || []) {
    for (const error of validateScenario(s)) errors.push(s.id + ': ' + error);
    if (ids.has(s.id)) errors.push('duplicate scenario id: ' + s.id);
    ids.add(s.id);
    categories.add(s.category);
    for (const trap of s.traps || []) trapCounts[trap] = (trapCounts[trap] || 0) + 1;
    if (!(s.expected.top_must_include || []).length) allBad += 1;
  }
  for (const category of CATEGORY_IDS) if (!categories.has(category)) errors.push('missing category: ' + category);
  for (const trap of TRAP_IDS) if ((trapCounts[trap] || 0) < 2) errors.push('trap ' + trap + ' used <2 times');
  if (allBad < 2) errors.push('need >=2 all-bad scenarios');
  return errors;
}
