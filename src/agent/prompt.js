import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlaybookBlock } from './playbooks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = path.resolve(here, '..', '..', 'prompts', 'system.md');

let cachedPrompt = null;

export function loadSystemPrompt() {
  if (cachedPrompt === null) {
    cachedPrompt = fs.readFileSync(PROMPT_FILE, 'utf8').trim();
  }
  return cachedPrompt;
}

export function sanitizeQuery(query) {
  return String(query || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

export function parseBudgetHint(query) {
  const text = String(query || '');
  const cny = text.match(/(?:до|бюджет|макс(?:имум)?|не более)?\s*([\d\s]{3,9})\s*(?:¥|юан\w*|元|CNY|RMB)/i);
  if (cny) {
    const amount = Number(String(cny[1]).replace(/\s+/g, ''));
    if (Number.isFinite(amount) && amount > 0) return { currency: 'CNY', amount, source: 'query' };
  }
  const rub = text.match(/(?:до|бюджет|макс(?:имум)?|не более)?\s*([\d\s]{3,9})\s*(?:₽|руб\w*|RUB)/i);
  if (rub) {
    const amount = Number(String(rub[1]).replace(/\s+/g, ''));
    if (Number.isFinite(amount) && amount > 0) return { currency: 'RUB', amount, source: 'query' };
  }
  return null;
}

export function buildTaskContext({ query, settings, playbook = '' }) {
  const clientQuery = sanitizeQuery(query);
  const budgetHint = parseBudgetHint(clientQuery);
  const lines = [
    '<task_context>',
    'client_query: ' + JSON.stringify(clientQuery),
    'commission_percent: ' + Number(settings.commission_percent),
    'commission_min_rub: ' + Number(settings.commission_min_rub),
    ...(budgetHint ? ['budget_hint: ' + JSON.stringify(budgetHint)] : []),
    ...(playbook ? ['', playbook] : []),
    '</task_context>',
  ];
  return lines.join('\n');
}

export function buildMessages({ query, settings }) {
  const playbook = buildPlaybookBlock(query);
  return [
    { role: 'system', content: loadSystemPrompt() },
    { role: 'user', content: buildTaskContext({ query, settings, playbook }) },
  ];
}
