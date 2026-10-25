import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { SettingsStore } from '../store/settings.js';
import { LlmClient } from '../agent/llm.js';
import { CassetteLlm } from './cassette.js';
import { runScenario } from './runner.js';
import { scoreScenario, aggregateScores } from './score.js';

function argsOf(argv) {
  const out = { limit: 0, scenario: null, ids: null, live: false, record: false, json: false, maxTokens: 250000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--live') out.live = true;
    else if (arg === '--record') out.record = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--limit') out.limit = Number(argv[++i]) || 0;
    else if (arg === '--scenario') out.scenario = argv[++i] || null;
    else if (arg === '--ids') out.ids = String(argv[++i] || '').split(',').map((x) => x.trim()).filter(Boolean);
    else if (arg === '--max-tokens') out.maxTokens = Number(argv[++i]) || out.maxTokens;
  }
  return out;
}

function formatReport(scores, agg, meta) {
  const lines = [];
  lines.push('# Eval report');
  lines.push('');
  lines.push('Mode: ' + meta.mode + '. Scenarios: ' + scores.length + '. Tokens: ' + meta.tokens + '.');
  lines.push('');
  lines.push('| metric | value | gate |');
  lines.push('|---|---:|---|');
  lines.push('| safety pass rate | ' + (agg.safety_pass_rate * 100).toFixed(1) + '% | 100% |');
  lines.push('| stop factor in top | ' + agg.stop_in_top + ' | 0 |');
  lines.push('| over budget in top | ' + agg.over_budget_in_top + ' | 0 |');
  lines.push('| buy without photo | ' + agg.buy_without_photo + ' | 0 |');
  lines.push('| unsupported photo claims | ' + agg.unsupported_photo_claims + ' | 0 |');
  lines.push('| rub mismatch | ' + agg.rub_mismatch + ' | 0 |');
  lines.push('| gold recall | ' + (agg.gold_recall * 100).toFixed(1) + '% | >=80% |');
  lines.push('| verdict match | ' + (agg.verdict_match * 100).toFixed(1) + '% | >=80% |');
  lines.push('| all-bad empty top | ' + (agg.all_bad_top_empty * 100).toFixed(1) + '% | 100% |');
  lines.push('| duplicate item calls | ' + agg.duplicate_item_calls + ' | 0 |');
  lines.push('| finish first try | ' + (agg.finish_first_rate * 100).toFixed(1) + '% | >=90% |');
  lines.push('| median calls | ' + agg.call_median + ' | <=30 |');
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  lines.push('| scenario | top | failures |');
  lines.push('|---|---|---|');
  for (const score of scores) lines.push('| ' + score.scenario_id + ' | ' + (score.top_ids.join(', ') || '—') + ' | ' + (score.failures.join('; ') || '—') + ' |');
  return lines.join('\n');
}

const args = argsOf(process.argv.slice(2));
const config = loadConfig();
const logger = createLogger(config.logLevel);
const settings = new SettingsStore(config.dataDir, logger, config.settingsBootstrap).get();
const scenarioDir = path.join(config.baseDir, 'test', 'fixtures', 'lab', 'scenarios');
const all = fs.readdirSync(scenarioDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(scenarioDir, f), 'utf8'))).sort((a, b) => a.id.localeCompare(b.id));
let selected = args.scenario ? all.filter((s) => s.id === args.scenario) : args.ids ? all.filter((s) => args.ids.includes(s.id)) : all;
if (args.limit > 0) selected = selected.slice(0, args.limit);
if (!selected.length) throw new Error('Сценарии не найдены');

if (!args.live) {
  const withCassette = selected.filter((s) => fs.existsSync(path.join(config.baseDir, 'test', 'cassettes', s.id + '.json')));
  if (!withCassette.length) {
    console.log('Offline harness: ' + all.length + ' scenarios, ' + selected.length + ' selected. No cassettes.');
    console.log('Dry validation: ' + selected.map((s) => s.id).join(', '));
    process.exit(0);
  }
  selected = withCassette;
}

let tokens = 0;
const scores = [];
for (const scenario of selected) {
  const cassetteFile = path.join(config.baseDir, 'test', 'cassettes', scenario.id + '.json');
  const inner = args.live ? new LlmClient(config.llm, logger) : null;
  const llm = new CassetteLlm({ inner, file: cassetteFile, mode: args.live ? 'live' : 'replay', logger });
  logger.info('eval: scenario', { id: scenario.id });
  const run = await runScenario({ scenario, config, settings, llm, logger });
  tokens += Number(llm.totalUsage.total_tokens || 0) || (llm.entries || []).reduce((acc, entry) => acc + Number(entry.response && entry.response.usage && entry.response.usage.total_tokens || 0), 0);
  const score = scoreScenario({ scenario, result: run.result, calls: run.calls, finishAttempts: run.finishAttempts, trace: run.trace, settings });
  score.tokens = Number(llm.totalUsage.total_tokens || 0);
  score.duration_ms = run.durationMs;
  scores.push(score);
  if (args.live && tokens > args.maxTokens) {
    logger.warn('eval: token cap reached', { tokens, cap: args.maxTokens });
    break;
  }
}
const agg = aggregateScores(scores);
const report = formatReport(scores, agg, { mode: args.live ? 'live' : 'replay', tokens });
const reportDir = path.join(config.baseDir, 'eval', 'reports');
fs.mkdirSync(reportDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(reportDir, stamp + '-live.md'), report, 'utf8');
fs.writeFileSync(path.join(config.baseDir, 'eval', 'baseline.json'), JSON.stringify({ created_at: new Date().toISOString(), aggregate: agg, scores }, null, 2), 'utf8');
console.log(report);
