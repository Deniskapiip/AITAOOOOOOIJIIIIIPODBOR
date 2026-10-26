import { stripHtml } from '../goofish/normalize.js';

let sharpModule;
async function getSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default || mod;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

const analysisCache = new Map();

function cacheGet(key, ttlMs) {
  const entry = analysisCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) {
    analysisCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (analysisCache.size > 300) {
    const oldest = analysisCache.keys().next().value;
    if (oldest !== undefined) analysisCache.delete(oldest);
  }
  analysisCache.set(key, { at: Date.now(), value });
}

function buildPrompt(item, index, total) {
  const title = String((item && item.title) || '—').slice(0, 260);
  const desc = String((item && item.description) || '—').slice(0, 500);
  return [
    'Ты проверяешь ОДНО фото лота с Goofish (闲鱼), фото ' + index + ' из ' + total + '.',
    'Заголовок лота: ' + title,
    'Описание: ' + desc,
    '',
    'Опиши только то, что реально видно на ЭТОМ фото. Не угадывай модель и не придумывай дефекты.',
    'Проверь: экран (трещины, сколы, царапины, выгорание/透图, полосы), корпус (вмятины, сколы), камеры, следы вскрытия, комплект.',
    'Если экран не виден — screen_ok=null и verdict не "ок".',
    '',
    'Верни СТРОГО JSON без markdown:',
    '{"summary_ru":"что видно","defects":["..."],"screen_ok":null,"battery_health_percent":null,"verdict":"сомнительно"}',
    'verdict: "ок" — зона видна и дефектов нет; "плохо" — трещины/сколы/выгорание/сильные повреждения; иначе "сомнительно".',
  ].join('\n');
}

export function parseVisionJson(text) {
  let raw = String(text || '').trim();
  if (!raw) return null;
  raw = raw.replace(/^\u0060\u0060\u0060(?:json)?/i, '').replace(/\u0060\u0060\u0060$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const verdict = String(data.verdict || '').toLowerCase();
  let normalizedVerdict = ['ок', 'сомнительно', 'плохо'].includes(verdict) ? verdict : 'сомнительно';
  const defects = Array.isArray(data.defects) ? data.defects.map((x) => String(x)).slice(0, 12) : [];
  const mismatches = Array.isArray(data.mismatches) ? data.mismatches.map((x) => String(x)).slice(0, 8) : [];
  const screenOk = data.screen_ok === true ? true : data.screen_ok === false ? false : null;
  if (normalizedVerdict === 'ок' && screenOk !== true) normalizedVerdict = 'сомнительно';
  if (screenOk === false && defects.some((d) => /экран|трещин|скол|выгор|透图|老化|лини/i.test(d))) normalizedVerdict = 'плохо';
  const battery =
    data.battery_health_percent === null || data.battery_health_percent === undefined || data.battery_health_percent === ''
      ? null
      : Number.isFinite(Number(data.battery_health_percent))
        ? Number(data.battery_health_percent)
        : null;
  return {
    summary_ru: String(data.summary_ru || '').trim(),
    defects,
    mismatches,
    screen_ok: screenOk,
    battery_health_percent: battery,
    verdict: normalizedVerdict,
    raw_text: String(text || '').slice(0, 1500),
  };
}

async function prepareImage(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.goofish.com/', accept: 'image/*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 12_000_000) throw new Error('фото больше 12 МБ');
  const sharp = await getSharp();
  if (sharp) {
    const png = await sharp(buffer)
      .rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return 'data:image/png;base64,' + png.toString('base64');
  }
  const mime = String(res.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (mime === 'image/png' || mime === 'image/jpeg') {
    return 'data:' + mime + ';base64,' + buffer.toString('base64');
  }
  throw new Error('нет sharp, формат ' + (mime || 'unknown') + ' не поддержан');
}

async function callVision(model, dataUrl, prompt, vision) {
  const res = await fetch(vision.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + vision.apiKey,
      'HTTP-Referer': 'https://localhost',
      'X-Title': 'Goofish Agent',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(vision.timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('vision вернул не JSON (HTTP ' + res.status + ')');
  }
  if (json.error) throw new Error(json.error.message || 'vision error');
  const message = json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message : {};
  const content = String(message.content || '').trim();
  const analysis = parseVisionJson(content) || parseVisionJson(message.reasoning);
  if (analysis) return analysis;
  if (content) {
    return {
      summary_ru: content.slice(0, 400),
      defects: [],
      mismatches: [],
      screen_ok: null,
      battery_health_percent: null,
      verdict: 'сомнительно',
      raw_text: content.slice(0, 1500),
    };
  }
  throw new Error('vision вернул пустой ответ');
}

function aggregate(results, imagesUsed) {
  const defects = [...new Set(results.flatMap((r) => r.defects))];
  const mismatches = [...new Set(results.flatMap((r) => r.mismatches))];
  const summaries = [...new Set(results.map((r) => r.summary_ru).filter(Boolean))];
  const screenStates = results.map((r) => r.screen_ok).filter((v) => v !== null && v !== undefined);
  const screenOk = screenStates.includes(false) ? false : screenStates.includes(true) ? true : null;
  const batteries = results.map((r) => r.battery_health_percent).filter((v) => Number.isFinite(v));
  const verdicts = results.map((r) => r.verdict);
  let verdict = 'сомнительно';
  if (verdicts.includes('плохо')) verdict = 'плохо';
  else if (screenOk === false) verdict = 'плохо';
  else if (screenOk === true && verdicts.every((v) => v === 'ок')) verdict = 'ок';
  if (verdict === 'ок' && defects.length) verdict = 'сомнительно';
  return {
    summary_ru: summaries.slice(0, 3).join(' ').slice(0, 900),
    defects,
    mismatches,
    screen_ok: screenOk,
    battery_health_percent: batteries.length ? Math.max(...batteries) : null,
    verdict,
    images_used: imagesUsed,
  };
}

export async function analyzePhotos({ urls, item, config, logger }) {
  const vision = config.vision;
  if (!vision || !vision.enabled || !vision.model) return { ok: false, reason: 'vision не настроен' };
  const selected = (Array.isArray(urls) ? urls : []).filter(Boolean).slice(0, vision.maxPhotos);
  if (!selected.length) return { ok: false, reason: 'нет фото' };

  const models = Array.isArray(vision.models) && vision.models.length ? vision.models : [vision.model];
  const results = [];
  const errors = [];

  for (let index = 0; index < selected.length; index += 1) {
    const cacheKey = vision.model + '|' + selected[index];
    const cached = cacheGet(cacheKey, vision.cacheTtlMs || 0);
    if (cached) {
      results.push(cached);
      continue;
    }
    let dataUrl;
    try {
      dataUrl = await prepareImage(selected[index]);
    } catch (err) {
      errors.push('фото ' + (index + 1) + ': ' + err.message);
      continue;
    }
    const prompt = buildPrompt(item, index + 1, selected.length);
    let done = false;
    for (const model of models) {
      try {
        const analysis = await callVision(model, dataUrl, prompt, vision);
        cacheSet(cacheKey, analysis);
        results.push(analysis);
        done = true;
        break;
      } catch (err) {
        errors.push('фото ' + (index + 1) + ' ' + model + ': ' + err.message);
        if (logger) logger.warn('vision: модель не справилась', { model, image: index + 1, error: err.message });
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (!done && logger) logger.warn('vision: фото пропущено', { image: index + 1 });
  }

  if (!results.length) {
    return { ok: false, reason: 'vision не смог обработать фото (' + errors.slice(0, 3).join('; ') + ')' };
  }
  const analysis = aggregate(results, results.length);
  if (errors.length) analysis.errors = errors.slice(0, 5);
  return { ok: true, analysis };
}
