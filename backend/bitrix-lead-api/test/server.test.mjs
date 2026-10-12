import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const serverModule = await import('../src/server.mjs').catch(() => ({}));
const { createLeadServer } = serverModule;

async function start(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

function validForm() {
  const form = new FormData();
  form.set('source', 'связаться');
  form.set('name', 'Тест');
  form.set('email', 'test@example.org');
  form.set('task', 'Тестовая заявка');
  form.set('agree', 'on');
  return form;
}

test('accepts only the website origin and forwards a lead without exposing CRM response data', async () => {
  assert.equal(typeof createLeadServer, 'function');
  const calls = [];
  const server = createLeadServer({
    webhookURL: 'https://bitrix.digitalm.agency/rest/1/TESTTOKEN/',
    now: () => new Date('2026-10-12T12:00:00.000Z'),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ result: 451, time: { secret: 'must-not-leak' } }), { status: 200 });
    },
  });
  try {
    const base = await start(server);
    const response = await fetch(`${base}/lead`, {
      method: 'POST', headers: { Origin: 'https://digitalm.agency' }, body: validForm(),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://digitalm.agency');
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/bitrix\.digitalm\.agency\/rest\/1\/TESTTOKEN\/crm\.lead\.add\.json$/);
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.fields.NAME, 'Тест');
    assert.match(payload.fields.COMMENTS, /Согласие на обработку/);
  } finally {
    server.close();
  }
});

test('rejects a non-site origin before calling Bitrix', async () => {
  assert.equal(typeof createLeadServer, 'function');
  let calls = 0;
  const server = createLeadServer({
    webhookURL: 'https://bitrix.digitalm.agency/rest/1/TESTTOKEN/',
    fetchImpl: async () => { calls++; return new Response('{"result":1}'); },
  });
  try {
    const base = await start(server);
    const response = await fetch(`${base}/lead`, {
      method: 'POST', headers: { Origin: 'https://attacker.example' }, body: validForm(),
    });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  } finally {
    server.close();
  }
});

test('rejects attachments until a Bitrix file field is explicitly configured', async () => {
  assert.equal(typeof createLeadServer, 'function');
  let calls = 0;
  const server = createLeadServer({
    webhookURL: 'https://bitrix.digitalm.agency/rest/1/TESTTOKEN/',
    fetchImpl: async () => { calls++; return new Response('{"result":1}'); },
  });
  try {
    const base = await start(server);
    const form = validForm();
    form.set('file', new File(['not actually uploaded'], 'brief.txt', { type: 'text/plain' }));
    const response = await fetch(`${base}/lead`, {
      method: 'POST', headers: { Origin: 'https://digitalm.agency' }, body: form,
    });
    assert.equal(response.status, 422);
    assert.equal(calls, 0);
  } finally {
    server.close();
  }
});
