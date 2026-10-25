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

function buildPrompt(item) {
  const lines = [
    'Ты эксперт по б/у технике и проверяешь фотографии лота с Goofish (闲鱼).',
    'Опиши только то, что реально видно на фото. Не угадывай и не выдумывай.',
    '',
    'Заявление продавца:',
    'Заголовок: ' + String((item && item.title) || '—').slice(0, 300),
    'Описание: ' + String((item && item.description) || '—').slice(0, 900),
    'Теги: ' + ((item && Array.isArray(item.condition_tags) ? item.condition_tags.join(', ') : '') || '—'),
    'Цена: ' + ((item && item.price_cny) || '—') + ' ¥',
    '',
    'Проверь:',
    '1. Модель, цвет, память и регион — если видно экран «关于本机».',
    '2. Здоровье АКБ — если виден экран «电池健康» или отчёт 爱思/沙漏.',
    '3. Экран: трещины, сколы, царапины, выгорание/透图, битые пиксели, полосы, засветы.',
    '4. Корпус: вмятины, сколы, потёртости, состояние крышки и рамки.',
    '5. Камеры: царапины и повреждения стёкол.',
    '6. Признаки вскрытия/ремонта по зазорам и следам.',
    '7. Комплект: коробка, зарядка, кабель, чехол.',
    '8. Несоответствия заявлению продавца.',
    '',
    'Верни СТРОГО JSON без markdown:',
    '{"summary_ru":"кратко 1-2 предложения","defects":["..."],"mismatches":["..."],"screen_ok":true,"battery_health_percent":null,"verdict":"ок"}',
    'verdict: "ок" — видимых дефектов и несоответствий нет;',
    '"сомнительно" — фото мало/нечитаемо/есть мелкие дефекты;',
    '"плохо" — трещины, выгорание, сколы экрана, сильные повреждения или несоответствие модели/памяти/цвета.',
  ];
  return lines.join('\n');
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
  return {
    summary_ru: String(data.summary_ru || '').trim(),
    defects: Array.isArray(data.defects) ? data.defects.map((x) => String(x)).slice(0, 12) : [],
    mismatches: Array.isArray(data.mismatches) ? data.mismatches.map((x) => String(x)).slice(0, 8) : [],
    screen_ok: data.screen_ok === true ? true : data.screen_ok === false ? false : null,
    battery_health_percent: Number.isFinite(Number(data.battery_health_percent)) ? Number(data.battery_health_percent) : null,
    verdict: ['ок', 'сомнительно', 'плохо'].includes(verdict) ? verdict : 'сомнительно',
    raw_text: String(text || '').slice(0, 1500),
  };
}

async function prepareImage(url, config) {
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
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
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

export async function analyzePhotos({ urls, item, config, logger }) {
  const vision = config.vision;
  if (!vision || !vision.enabled || !vision.model) {
    return { ok: false, reason: 'vision не настроен' };
  }
  const selected = (Array.isArray(urls) ? urls : []).filter(Boolean).slice(0, vision.maxPhotos);
  if (!selected.length) return { ok: false, reason: 'нет фото' };

  const images = [];
  const errors = [];
  for (const url of selected) {
    try {
      images.push(await prepareImage(url, config));
    } catch (err) {
      errors.push(url + ': ' + err.message);
      if (logger) logger.warn('vision: фото не подготовлено', { error: err.message });
    }
  }
  if (!images.length) return { ok: false, reason: 'не удалось загрузить фото (' + errors.join('; ') + ')' };

  const body = {
    model: vision.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(item) + '\n\nФото: ' + images.length + '.' },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
    max_tokens: 900,
    temperature: 0.1,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(vision.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + vision.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(vision.timeoutMs),
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('vision вернул не JSON');
      }
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
      const content = json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : '';
      const analysis = parseVisionJson(content);
      if (!analysis) throw new Error('vision вернул текст без JSON: ' + String(content || '').slice(0, 200));
      analysis.images_used = images.length;
      return { ok: true, analysis };
    } catch (err) {
      if (logger) logger.warn('vision: попытка не удалась', { attempt: attempt + 1, error: err.message });
      if (attempt === 1) return { ok: false, reason: err.message };
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  return { ok: false, reason: 'vision недоступен' };
}
