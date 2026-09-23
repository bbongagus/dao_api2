import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createPageFetcher, isPublicAddress, BlockedAddressError } from './pageFetch.js';

/** A local server whose routes answer with whatever each handler writes. */
async function serve(routes) {
  const server = http.createServer((req, res) => {
    const handler = routes[req.url];
    if (!handler) { res.writeHead(404); res.end(); return; }
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); },
  };
}

const html = (body) => (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
};

// The page tests talk to 127.0.0.1, which the real policy refuses — that is
// the point of it. They run with loopback let through and nothing else.
const loopbackOnly = (ip) => ip === '127.0.0.1';

// --- which addresses are reachable ---

test('public addresses pass; loopback, private, link-local and metadata do not', () => {
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  for (const ip of [
    '127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '0.0.0.0',
    '100.64.0.1', // carrier-grade NAT
    '::1', 'fe80::1', 'fd12:3456::1', // Railway's private network is fd12::/16
    '::ffff:127.0.0.1', '::ffff:7f00:1', // IPv4-mapped loopback, both spellings
    '224.0.0.1', 'not an ip',
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('a name that resolves to loopback is refused at connect', async () => {
  const fetchPage = createPageFetcher();
  await assert.rejects(fetchPage('http://localhost/'), BlockedAddressError);
});

test('an IP literal is refused before any connection, however it is spelt', async () => {
  const fetchPage = createPageFetcher();
  // A literal never goes through DNS, so the connect-time check never sees
  // it; these all mean 127.0.0.1 or the cloud metadata address.
  for (const url of [
    'http://127.0.0.1/', 'http://0x7f.1/', 'http://2130706433/', 'http://0177.0.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/',
  ]) {
    await assert.rejects(fetchPage(url), BlockedAddressError, url);
  }
});

test('only http and https, and no credentials in the address', async () => {
  const fetchPage = createPageFetcher();
  await assert.rejects(fetchPage('file:///etc/passwd'), /http/);
  await assert.rejects(fetchPage('ftp://example.com/'), /http/);
  await assert.rejects(fetchPage('http://user:pass@example.com/'), /credentials/);
});

// --- fetching a page ---

test('a page comes back as its text, title and final address', async () => {
  const server = await serve({
    '/article': html(`<html><head><title>Как получить визу</title></head><body>
      <nav>menu menu menu</nav>
      <article><h1>Как получить визу</h1>
      <p>Сначала соберите документы о происхождении. Потом запишитесь в консульство.</p>
      <p>Третий абзац, чтобы статья была похожа на статью, а не на обрывок текста.</p></article>
      </body></html>`),
  });
  try {
    const fetchPage = createPageFetcher({ isAllowedAddress: loopbackOnly });
    const page = await fetchPage(`${server.base}/article`);

    assert.equal(page.url, `${server.base}/article`);
    assert.equal(page.title, 'Как получить визу');
    assert.match(page.text, /соберите документы о происхождении/);
  } finally {
    await server.close();
  }
});

test('links keep their words and lose their addresses — an address is tokens, not content', async () => {
  const server = await serve({
    '/links': html(`<html><body><article>
      <p>Подайте <a href="https://example.com/very/long/path?with=query">заявление</a> в консульство.
      <img src="https://example.com/pic.png" alt="схема"> Потом ждите ответа несколько месяцев.</p>
      <p>Второй абзац, чтобы статья выглядела статьёй для извлечения текста.</p>
      </article></body></html>`),
  });
  try {
    const page = await createPageFetcher({ isAllowedAddress: loopbackOnly })(`${server.base}/links`);
    assert.match(page.text, /Подайте заявление в консульство/);
    assert.doesNotMatch(page.text, /example\.com/);
  } finally {
    await server.close();
  }
});

test('plain text is taken as it is', async () => {
  const server = await serve({
    '/notes.txt': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('шаг 1\nшаг 2'); },
  });
  try {
    const page = await createPageFetcher({ isAllowedAddress: loopbackOnly })(`${server.base}/notes.txt`);
    assert.equal(page.text, 'шаг 1\nшаг 2');
  } finally {
    await server.close();
  }
});

test('a redirect is followed, and every hop is checked again', async () => {
  const server = await serve({
    '/moved': (req, res) => { res.writeHead(301, { Location: '/article' }); res.end(); },
    '/article': html('<html><body><p>arrived</p></body></html>'),
    '/to-metadata': (req, res) => { res.writeHead(302, { Location: 'http://169.254.169.254/' }); res.end(); },
    '/to-v6-loopback': (req, res) => { res.writeHead(302, { Location: 'http://[::1]/' }); res.end(); },
  });
  try {
    const fetchPage = createPageFetcher({ isAllowedAddress: loopbackOnly });

    const page = await fetchPage(`${server.base}/moved`);
    assert.equal(page.url, `${server.base}/article`);
    assert.match(page.text, /arrived/);

    await assert.rejects(fetchPage(`${server.base}/to-metadata`), BlockedAddressError);
    await assert.rejects(fetchPage(`${server.base}/to-v6-loopback`), BlockedAddressError);
  } finally {
    await server.close();
  }
});

test('a redirect loop ends', async () => {
  const server = await serve({
    '/a': (req, res) => { res.writeHead(302, { Location: '/b' }); res.end(); },
    '/b': (req, res) => { res.writeHead(302, { Location: '/a' }); res.end(); },
  });
  try {
    await assert.rejects(createPageFetcher({ isAllowedAddress: loopbackOnly })(`${server.base}/a`), /redirects/);
  } finally {
    await server.close();
  }
});

test('anything but a web page or plain text is refused', async () => {
  const server = await serve({
    '/file.pdf': (req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end('%PDF-1.7'); },
    '/gone': (req, res) => { res.writeHead(500); res.end(); },
  });
  try {
    const fetchPage = createPageFetcher({ isAllowedAddress: loopbackOnly });
    await assert.rejects(fetchPage(`${server.base}/file.pdf`), /application\/pdf/);
    await assert.rejects(fetchPage(`${server.base}/gone`), /500/);
  } finally {
    await server.close();
  }
});

test('a huge page is cut off rather than read whole', async () => {
  const server = await serve({
    '/huge.txt': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('x'.repeat(50_000));
    },
  });
  try {
    const page = await createPageFetcher({ isAllowedAddress: loopbackOnly, maxBytes: 10_000 })(`${server.base}/huge.txt`);
    assert.ok(page.text.length <= 10_000, `read ${page.text.length} bytes`);
  } finally {
    await server.close();
  }
});

test('the text handed on is capped, however long the article', async () => {
  const server = await serve({
    '/long.txt': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('слово '.repeat(5_000)); },
  });
  try {
    const page = await createPageFetcher({ isAllowedAddress: loopbackOnly, maxChars: 1_000 })(`${server.base}/long.txt`);
    assert.ok(page.text.length <= 1_000);
  } finally {
    await server.close();
  }
});

test('a server that never answers is given up on', async () => {
  const server = await serve({ '/slow': () => {} });
  try {
    await assert.rejects(
      createPageFetcher({ isAllowedAddress: loopbackOnly, timeoutMs: 200 })(`${server.base}/slow`),
      (error) => error.name === 'TimeoutError' || error.name === 'AbortError' || /timeout/i.test(error.message),
    );
  } finally {
    await server.close();
  }
});
