import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.HCAPTCHA_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid HCAPTCHA_PORT');
const origin = `http://hcaptcha.test:${port}`;
const configPath = process.env.HCAPTCHA_CONFIG || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'donot-track-me', 'hcaptcha.local.json');
let credentials;
try { credentials = JSON.parse(await readFile(configPath, 'utf8')); }
catch { throw new Error(`Cannot read hCaptcha credentials. Set HCAPTCHA_CONFIG or create ${configPath}`); }
const sitekey = process.env.HCAPTCHA_SITEKEY || credentials.sitekey;
const secret = process.env.HCAPTCHA_SECRET || credentials.secret;
if (typeof sitekey !== 'string' || !sitekey || typeof secret !== 'string' || !secret) throw new Error('hCaptcha sitekey and secret are required');
const assets = new Map(await Promise.all([
  ['/', 'text/html; charset=utf-8', 'hcaptcha-test.html'],
  ['/app.js', 'application/javascript; charset=utf-8', 'hcaptcha-test.js'],
  ['/style.css', 'text/css; charset=utf-8', 'hcaptcha-test.css'],
].map(async ([path, type, file]) => [path, { type, body: await readFile(new URL(file, import.meta.url)) }])));

function respond(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
async function readJSON(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const host = (req.headers.host || '').toLowerCase();
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) {
    res.writeHead(302, { Location: origin + '/' });
    res.end();
    return;
  }
  if (host !== `hcaptcha.test:${port}`) return respond(res, 403, { error: 'Unexpected host' });
  const url = new URL(req.url, origin);
  if (req.method === 'GET' && assets.has(url.pathname)) {
    const { body, type } = assets.get(url.pathname);
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/config') {
    return respond(res, 200, { sitekey, origin, remoteip: 'omitted' });
  }
  if (req.method !== 'POST' || url.pathname !== '/verify') return respond(res, 404, { error: 'Not found' });
  if (req.headers.origin !== origin) return respond(res, 403, { error: 'Same-origin submission required' });
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return respond(res, 415, { error: 'JSON request required' });
  let data;
  try { data = await readJSON(req); }
  catch { return respond(res, 400, { error: 'Invalid or oversized request' }); }
  if (typeof data?.token !== 'string' || !data.token.trim() || data.token.length > 60000) {
    return respond(res, 400, { error: 'Complete the challenge before submitting', 'error-codes': ['missing-input-response'] });
  }
  const started = performance.now();
  try {
    const upstream = await fetch('https://api.hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: data.token, sitekey }),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (!upstream.ok) return respond(res, 502, { error: 'hCaptcha verification HTTP error', upstreamStatus: upstream.status });
    const answer = await upstream.json();
    if (typeof answer?.success !== 'boolean') return respond(res, 502, { error: 'Unexpected hCaptcha response' });
    // Return documented result fields only. Never expose credentials or tokens.
    const result = { success: answer.success };
    for (const field of ['error-codes', 'hostname', 'challenge_ts', 'credit', 'score', 'score_reason']) {
      if (Object.hasOwn(answer, field)) result[field] = answer[field];
    }
    return respond(res, 200, { result, elapsedMs: Math.round(performance.now() - started), checkedAt: new Date().toISOString(), remoteip: 'omitted' });
  } catch {
    return respond(res, 502, { error: '无法连接 hCaptcha 验证接口，或响应超时／无效。这不是验证码被判定失败。', elapsedMs: Math.round(performance.now() - started) });
  }
}
const server = http.createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) respond(res, 500, { error: 'Local server error' });
    else res.destroy();
  });
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use` : `Server failed: ${error.code || 'unknown'}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`hCaptcha local server ready: ${origin}/ (loopback only)`));
