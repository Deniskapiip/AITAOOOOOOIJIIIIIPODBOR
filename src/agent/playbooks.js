import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..', '..', 'prompts', 'playbooks');
const cache = new Map();

const RULES = [
  ['audio', /airpods|наушник|headphone|wh-1000|qc ultra|freebuds|sennheiser|ie 600|audio/i],
  ['camera', /sony a7|a7m|a7r|a7s|canon eos|eos r|nikon z|fujifilm|x-t5|x-h2|panasonic|lumix|камера|объектив|camera|lens/i],
  ['tablet', /ipad|tablet|планшет|tab s|matepad|pad 6|y700|lenovo tab/i],
  ['laptop', /macbook|thinkpad|ноутбук|笔记本|zephyrus|legion|xps|rog|surface laptop/i],
  ['console', /playstation|ps5|xbox|switch|steam deck|консол|nintendo/i],
  ['pc_parts', /rtx|gtx|radeon|geforce|ryzen|threadripper|intel i[3579]|ddr[45]|ssd|gpu|видеокарт|процессор|материнск/i],
  ['smartphone', /iphone|xiaomi|redmi|poco|huawei|mate \d|samsung|galaxy|oneplus|pixel|смартфон|телефон|手机/i],
];

export function selectCategory(query) {
  const text = String(query || '');
  for (const [id, rule] of RULES) if (rule.test(text)) return id;
  return 'generic';
}

export function loadPlaybook(category) {
  const id = category || 'generic';
  if (cache.has(id)) return cache.get(id);
  const file = path.join(dir, id + '.md');
  if (!fs.existsSync(file)) return '';
  const text = fs.readFileSync(file, 'utf8').trim();
  cache.set(id, text);
  return text;
}

export function buildPlaybookBlock(query) {
  const category = selectCategory(query);
  const text = loadPlaybook(category);
  if (!text) return '';
  return '<playbook category="' + category + '">\n' + text + '\n</playbook>';
}
