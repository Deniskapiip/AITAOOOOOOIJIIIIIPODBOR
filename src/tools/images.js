import { HttpError } from '../net/http.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function loadImage(url, { inline, maxBytes, timeoutMs = 15000 }) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Некорректный URL фото');
  if (!inline) return { url };
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/*' },
  });
  if (!res.ok) throw new HttpError('HTTP ' + res.status + ' при загрузке фото', res.status, '');
  const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) throw new Error('Не изображение: ' + (mime || 'unknown'));
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) throw new Error('Фото больше лимита ' + maxBytes + ' байт');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error('Фото больше лимита ' + maxBytes + ' байт');
  return { url, dataUrl: 'data:' + mime + ';base64,' + buffer.toString('base64') };
}
