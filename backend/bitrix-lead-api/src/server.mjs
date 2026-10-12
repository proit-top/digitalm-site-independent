import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildLeadFields, ValidationError } from './lead.mjs';

const SITE_ORIGINS = new Set(['https://digitalm.agency']);
const ROUTE = '/lead';
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;

function checkedWebhookURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('BITRIX_WEBHOOK_URL is invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== 'bitrix.digitalm.agency'
      || !/^\/rest\/\d+\/[^/]+\/?$/u.test(url.pathname) || url.search || url.hash) {
    throw new Error('BITRIX_WEBHOOK_URL must be an HTTPS Bitrix webhook for the configured portal');
  }
  return `${url.origin}${url.pathname.replace(/\/?$/u, '/')}`;
}

function sendJson(response, status, data, origin) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Vary', 'Origin');
  if (origin && SITE_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
  }
  response.end(JSON.stringify(data));
}

async function readForm(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw Object.assign(new Error('request_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw Object.assign(new Error('multipart_required'), { status: 415 });
  }
  const webRequest = new Request('http://localhost/lead', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: Buffer.concat(chunks),
  });
  const form = await webRequest.formData();
  const input = Object.create(null);
  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      if (value.size > 0) throw Object.assign(new Error('file_field_not_configured'), { status: 422 });
      continue;
    }
    if (Object.hasOwn(input, key)) throw Object.assign(new Error('duplicate_field'), { status: 400 });
    input[key] = value;
  }
  return input;
}

function peerAddress(request) {
  // The service binds to loopback only; nginx overwrites X-Real-IP.
  const value = request.headers['x-real-ip'];
  if (typeof value === 'string' && value.length <= 64) return value;
  return request.socket.remoteAddress || 'unknown';
}

export function createLeadServer({
  webhookURL = process.env.BITRIX_WEBHOOK_URL,
  fetchImpl = fetch,
  now = () => new Date(),
  rateLimit = RATE_LIMIT,
  rateWindowMs = RATE_WINDOW_MS,
} = {}) {
  const baseURL = checkedWebhookURL(webhookURL);
  const buckets = new Map();

  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const origin = request.headers.origin;
    if (request.url !== ROUTE) return sendJson(response, 404, { ok: false }, origin);
    if (origin && !SITE_ORIGINS.has(origin)) return sendJson(response, 403, { ok: false }, null);
    if (request.method === 'OPTIONS') {
      if (!origin || !SITE_ORIGINS.has(origin)) return sendJson(response, 403, { ok: false }, null);
      response.statusCode = 204;
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Max-Age', '600');
      response.setHeader('Vary', 'Origin');
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS');
      return sendJson(response, 405, { ok: false }, origin);
    }
    if (!origin || !SITE_ORIGINS.has(origin)) return sendJson(response, 403, { ok: false }, null);

    const ip = peerAddress(request);
    const timestamp = now().getTime();
    if (buckets.size > 5000) {
      for (const [key, bucket] of buckets) if (timestamp - bucket.startedAt >= rateWindowMs) buckets.delete(key);
      if (buckets.size > 5000) return sendJson(response, 503, { ok: false }, origin);
    }
    let bucket = buckets.get(ip);
    if (!bucket || timestamp - bucket.startedAt >= rateWindowMs) {
      bucket = { startedAt: timestamp, count: 0 };
      buckets.set(ip, bucket);
    }
    if (bucket.count >= rateLimit) return sendJson(response, 429, { ok: false }, origin);
    bucket.count += 1;

    try {
      const input = await readForm(request);
      const fields = buildLeadFields(input, now().toISOString());
      const upstream = await fetchImpl(`${baseURL}crm.lead.add.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ fields }),
        signal: AbortSignal.timeout(15000),
      });
      let result;
      try { result = await upstream.json(); } catch { result = null; }
      if (!upstream.ok || !result || !Object.hasOwn(result, 'result')) {
        console.error(JSON.stringify({ event: 'bitrix_rejected', requestId, status: upstream.status }));
        return sendJson(response, 502, { ok: false }, origin);
      }
      console.info(JSON.stringify({ event: 'lead_created', requestId }));
      return sendJson(response, 200, { ok: true }, origin);
    } catch (error) {
      if (error instanceof ValidationError) return sendJson(response, 400, { ok: false, error: error.code }, origin);
      if (error?.status) return sendJson(response, error.status, { ok: false, error: error.message }, origin);
      const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'bitrix_timeout' : 'request_failed';
      console.error(JSON.stringify({ event: reason, requestId }));
      return sendJson(response, 502, { ok: false }, origin);
    }
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const port = Number(process.env.PORT || '9016');
  const server = createLeadServer();
  server.listen(port, '127.0.0.1', () => console.info(JSON.stringify({ event: 'listening', address: '127.0.0.1', port })));
}
