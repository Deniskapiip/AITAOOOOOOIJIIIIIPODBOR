import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function newRunId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
}

export function saveRun(dataDir, run, logger) {
  try {
    const dir = path.join(dataDir, 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const id = run.id || newRunId();
    const file = path.join(dir, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ ...run, id }, null, 2), 'utf8');
    return { id, file };
  } catch (err) {
    if (logger) logger.warn('runs: не удалось сохранить прогон', { error: err.message });
    return null;
  }
}
