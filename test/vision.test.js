import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { analyzePhotos, parseVisionJson } from '../src/agent/vision.js';

test('parseVisionJson понимает markdown-обёртку и дефолты', () => {
  const bt = String.fromCharCode(96).repeat(3);
  const payload = 'json\n{"summary_ru":"Экран чистый","defects":[],"mismatches":[],"screen_ok":true,"battery_health_percent":97,"verdict":"ок"}\n';
  const parsed = parseVisionJson(bt + payload + bt);
  assert.equal(parsed.verdict, 'ок');
  assert.equal(parsed.battery_health_percent, 97);
  assert.equal(parseVisionJson('нет json'), null);
  assert.equal(parseVisionJson('{"verdict":"ужасно"}').verdict, 'сомнительно');
});

test('analyzePhotos: локальный mock vision-сервер', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const server = http.createServer((req, res) => {
    if (req.url === '/img.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
      return;
    }
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: '{"summary_ru":"Виден телефон, трещин нет","defects":[],"mismatches":[],"screen_ok":true,"battery_health_percent":97,"verdict":"ок"}' } }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const result = await analyzePhotos({
      urls: ['http://127.0.0.1:' + port + '/img.png'],
      item: { title: 'Xiaomi 13 Ultra', description: '测试', condition_tags: [], price_cny: 1000 },
      config: {
        vision: {
          enabled: true,
          baseUrl: 'http://127.0.0.1:' + port + '/v1',
          apiKey: 'test',
          model: 'mock-vl',
          maxPhotos: 1,
          timeoutMs: 10000,
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.analysis.verdict, 'ок');
    assert.equal(result.analysis.images_used, 1);
  } finally {
    server.close();
  }
});

test('analyzePhotos: повторный URL берётся из кэша', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let calls = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/img.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return; }
    calls += 1; req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"summary_ru":"clean","defects":[],"mismatches":[],"screen_ok":true,"battery_health_percent":95,"verdict":"ок"}' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const cfg = { vision: { enabled: true, baseUrl: 'http://127.0.0.1:' + port + '/v1', apiKey: 'test', model: 'cache-vl', maxPhotos: 1, timeoutMs: 10000, cacheTtlMs: 60000 } };
  try {
    const a = await analyzePhotos({ urls: ['http://127.0.0.1:' + port + '/img.png'], item: { title: 'x' }, config: cfg });
    const b = await analyzePhotos({ urls: ['http://127.0.0.1:' + port + '/img.png'], item: { title: 'x' }, config: cfg });
    assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(calls, 1);
  } finally { server.close(); }
});
