import https from 'node:https';
import { createProxyAgent } from './proxy.js';

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export function requestJson(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeoutMs = 20000,
    proxyUrl = '',
    userAgent = DEFAULT_UA,
    onResponseHeaders = null,
  } = options;

  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error('Некорректный URL: ' + url));
      return;
    }
    if (target.protocol !== 'https:') {
      reject(new Error('Поддерживается только https: ' + url));
      return;
    }

    const payload = body === null || body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method,
        agent: proxyUrl ? createProxyAgent(proxyUrl, timeoutMs) : undefined,
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-encoding': 'identity',
          'user-agent': userAgent,
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (onResponseHeaders) {
          try {
            onResponseHeaders(res.headers);
          } catch {
            /* ignore header callback errors */
          }
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new HttpError('HTTP ' + res.statusCode + ' ' + url, res.statusCode, text.slice(0, 2000)));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new HttpError('Ответ не является JSON: ' + url, res.statusCode, text.slice(0, 2000)));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Таймаут запроса: ' + url)));
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}
