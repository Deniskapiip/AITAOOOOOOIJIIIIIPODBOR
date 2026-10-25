export function createLabVision(scenario) {
  const truthByUrl = new Map();
  for (const list of Object.values(scenario.images || {})) {
    for (const entry of list) truthByUrl.set(entry.url, entry.truth);
  }
  return async function labVision({ urls } = {}) {
    const selected = (Array.isArray(urls) ? urls : []).slice(0, 8);
    const frames = [];
    const defects = [];
    let screenOk = null;
    let battery = null;
    let verdict = 'сомнительно';
    for (const url of selected) {
      const truth = truthByUrl.get(url);
      if (!truth) {
        frames.push({ url, truth: null, summary_ru: 'нет truth для кадра' });
        continue;
      }
      const extra = truth.system_ok ? '关于本机: модель/память/регион подтверждены; iCloud/аккаунт чист' : '';
      frames.push({ url, truth, summary_ru: [truth.label || '', extra].filter(Boolean).join('; ') });
      if (truth.screen_ok === true) screenOk = true;
      if (truth.screen_ok === false) screenOk = false;
      if (truth.battery_pct !== null && truth.battery_pct !== undefined) {
        battery = Math.max(battery === null ? 0 : battery, Number(truth.battery_pct));
      }
      if (Array.isArray(truth.cracks) && truth.cracks.length) defects.push('трещины экрана: ' + truth.cracks.join(','));
      if (truth.mismatch) defects.push(truth.mismatch);
      if (truth.verdict === 'плохо') verdict = 'плохо';
      else if (truth.verdict === 'сомнительно' && verdict !== 'плохо') verdict = 'сомнительно';
    }
    if (!defects.length && screenOk === true && verdict !== 'плохо') verdict = 'ок';
    if (screenOk === false && defects.some((d) => /трещин|экран/i.test(d))) verdict = 'плохо';
    if (screenOk === null && verdict === 'ок') verdict = 'сомнительно';
    return {
      ok: true,
      analysis: {
        summary_ru: frames.map((f) => f.summary_ru).filter(Boolean).join('; ').slice(0, 600),
        defects,
        mismatches: [],
        screen_ok: screenOk,
        battery_health_percent: battery,
        verdict,
        images_used: frames.length,
        frames,
      },
    };
  };
}
