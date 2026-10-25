import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';

const cache = new Map();

function connectViaProxy(proxy, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80), proxy.hostname);
    socket.setTimeout(timeoutMs);
    let buffer = Buffer.alloc(0);
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx === -1) return;
      socket.removeListener('data', onData);
      const head = buffer.slice(0, idx).toString('latin1');
      const statusLine = head.split('\r\n')[0] || '';
      const status = Number(statusLine.split(' ')[1]);
      if (status !== 200) {
        fail(new Error('proxy CONNECT failed: ' + statusLine));
        return;
      }
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      resolve(socket);
    };

    socket.once('connect', () => {
      const auth = proxy.username
        ? 'Proxy-Authorization: Basic ' +
          Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password || '')).toString('base64') +
          '\r\n'
        : '';
      socket.write(
        'CONNECT ' + targetHost + ':' + targetPort + ' HTTP/1.1\r\n' +
          'Host: ' + targetHost + ':' + targetPort + '\r\n' +
          auth +
          'Proxy-Connection: keep-alive\r\n\r\n',
      );
      socket.on('data', onData);
    });
    socket.once('timeout', () => fail(new Error('proxy CONNECT timeout')));
    socket.once('error', fail);
  });
}

export function createProxyAgent(proxyUrl, timeoutMs = 20000) {
  const key = proxyUrl + '|' + timeoutMs;
  if (cache.has(key)) return cache.get(key);
  let proxy;
  try {
    proxy = new URL(proxyUrl);
  } catch {
    throw new Error('Некорректный адрес прокси: ' + proxyUrl);
  }
  const agent = new https.Agent({ keepAlive: true, maxSockets: 16 });
  agent.createConnection = (options, callback) => {
    connectViaProxy(proxy, options.host, options.port || 443, timeoutMs)
      .then((socket) => {
        const tlsSocket = tls.connect({
          socket,
          servername: options.servername || options.host,
          rejectUnauthorized: true,
        });
        tlsSocket.once('secureConnect', () => callback(null, tlsSocket));
        tlsSocket.once('error', (err) => callback(err));
      })
      .catch((err) => callback(err));
  };
  cache.set(key, agent);
  return agent;
}
