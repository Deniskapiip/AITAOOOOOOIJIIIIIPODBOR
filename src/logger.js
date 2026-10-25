const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function formatBindings(bindings) {
  if (!bindings || !Object.keys(bindings).length) return '';
  const parts = [];
  for (const [k, v] of Object.entries(bindings)) {
    if (v === undefined) continue;
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    parts.push(k + '=' + val);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

export function createLogger(level = 'info', bindings = {}) {
  const threshold = LEVELS[level] || LEVELS.info;
  const emit = (lvl, msg, extra) => {
    if ((LEVELS[lvl] || 0) < threshold) return;
    const line =
      new Date().toISOString() +
      ' ' +
      lvl.toUpperCase().padEnd(5) +
      ' ' +
      String(msg) +
      formatBindings({ ...bindings, ...(extra || {}) });
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    level,
    debug: (msg, extra) => emit('debug', msg, extra),
    info: (msg, extra) => emit('info', msg, extra),
    warn: (msg, extra) => emit('warn', msg, extra),
    error: (msg, extra) => emit('error', msg, extra),
    child: (childBindings) => createLogger(level, { ...bindings, ...childBindings }),
  };
}
