import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function buildTaskContext({ query, settings }) {
  const clientQuery = sanitizeQuery(query);
  const lines = [
    '<task_context>',
    'client_query: ' + JSON.stringify(clientQuery),
    'commission_percent: ' + Number(settings.commission_percent),
    'commission_min_rub: ' + Number(settings.commission_min_rub),
    '</task_context>',
  ];
  return lines.join('\n');
}

export function buildMessages({ query, settings }) {
  return [
    { role: 'system', content: loadSystemPrompt() },
    { role: 'user', content: buildTaskContext({ query, settings }) },
  ];
}
