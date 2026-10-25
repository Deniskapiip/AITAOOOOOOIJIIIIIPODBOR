import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { generateScenarios } from './scenarios.js';

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function svgFor(truth, scenarioId, itemId, index) {
  const cracks = Array.isArray(truth.cracks) && truth.cracks.length;
  const stock = truth.mismatch;
  const bg = stock ? '#3a1f1f' : cracks ? '#2b1d1d' : '#10243a';
  const accent = stock ? '#ff8a65' : cracks ? '#ff5252' : '#4fc3f7';
  const lines = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">',
    '<rect width="640" height="480" fill="' + bg + '"/>',
    '<rect x="30" y="30" width="580" height="420" rx="24" fill="none" stroke="' + accent + '" stroke-width="4"/>',
    '<text x="50" y="80" fill="' + accent + '" font-family="Arial" font-size="24">' + esc(scenarioId) + ' / ' + esc(itemId) + ' / frame ' + index + '</text>',
    '<text x="50" y="130" fill="#e0e0e0" font-family="Arial" font-size="22">' + esc(truth.label || 'photo') + '</text>',
  ];
  if (truth.battery_pct) lines.push('<text x="50" y="180" fill="#b0e0ff" font-family="Arial" font-size="28">battery health: ' + truth.battery_pct + '%</text>');
  if (stock) lines.push('<text x="50" y="240" fill="#ffab91" font-family="Arial" font-size="42">OTHER STORE / STOCK</text>');
  if (cracks) {
    lines.push('<path d="M120 220 L260 300 L210 390 L380 450" stroke="#ff5252" stroke-width="7" fill="none"/>');
    lines.push('<path d="M260 300 L430 250 L540 330" stroke="#ff5252" stroke-width="5" fill="none"/>');
    lines.push('<text x="50" y="430" fill="#ff8a80" font-family="Arial" font-size="30">SCREEN CRACKS</text>');
  } else if (!stock) {
    lines.push('<text x="50" y="240" fill="#8bc34a" font-family="Arial" font-size="30">screen looks clean</text>');
  }
  lines.push('</svg>');
  return lines.join('');
}

export async function writeLab({ root, seed = 42 } = {}) {
  const base = root || process.cwd();
  const scenarios = generateScenarios(seed);
  const scenarioDir = path.join(base, 'test', 'fixtures', 'lab', 'scenarios');
  const imageDir = path.join(base, 'test', 'fixtures', 'lab', 'images');
  fs.mkdirSync(scenarioDir, { recursive: true });
  fs.mkdirSync(imageDir, { recursive: true });

  let images = 0;
  for (const scenario of scenarios) {
    fs.writeFileSync(path.join(scenarioDir, scenario.id + '.json'), JSON.stringify(scenario, null, 2), 'utf8');
    for (const [itemId, list] of Object.entries(scenario.images || {})) {
      let index = 0;
      for (const entry of list) {
        index += 1;
        const file = path.join(base, entry.file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await sharp(Buffer.from(svgFor(entry.truth, scenario.id, itemId, index))).png().toFile(file);
        images += 1;
      }
    }
  }
  return { scenarios: scenarios.length, images };
}
