import test from 'node:test';
import assert from 'node:assert/strict';

const leadModule = await import('../src/lead.mjs').catch(() => ({}));
const { buildLeadFields, ValidationError } = leadModule;

test('maps contact-form submission to a minimal Bitrix lead', () => {
  assert.equal(typeof buildLeadFields, 'function');
  const fields = buildLeadFields({
    source: 'связаться',
    name: 'Анна', company: 'Digital M', email: 'anna@example.org',
    phone: '+7 999 111-22-33', task: 'Нужен план кампании', agree: 'on',
  }, '2026-10-12T12:00:00.000Z');
  assert.equal(fields.TITLE, 'Заявка с сайта — Связаться');
  assert.equal(fields.NAME, 'Анна');
  assert.equal(fields.COMPANY_TITLE, 'Digital M');
  assert.deepEqual(fields.EMAIL, [{ VALUE: 'anna@example.org', VALUE_TYPE: 'WORK' }]);
  assert.deepEqual(fields.PHONE, [{ VALUE: '+7 999 111-22-33', VALUE_TYPE: 'WORK' }]);
  assert.match(fields.COMMENTS, /Нужен план кампании/);
  assert.match(fields.COMMENTS, /Согласие на обработку персональных данных: получено/);
  assert.equal(fields.SOURCE_DESCRIPTION, 'digitalm.agency — форма «Связаться»');
});

test('keeps a non-email case-contact in comments, not in CRM phone/email fields', () => {
  assert.equal(typeof buildLeadFields, 'function');
  const fields = buildLeadFields({
    source: 'кейсы', name: 'Иван', company: '', contact: '@ivan', agree: 'on',
  }, '2026-10-12T12:00:00.000Z');
  assert.equal(fields.TITLE, 'Запрос кейсов с сайта');
  assert.equal(fields.PHONE, undefined);
  assert.equal(fields.EMAIL, undefined);
  assert.match(fields.COMMENTS, /Контакт: @ivan/);
  assert.equal(fields.SOURCE_DESCRIPTION, 'digitalm.agency — форма «Кейсы»');
});

test('rejects submissions without recorded consent', () => {
  assert.equal(typeof buildLeadFields, 'function');
  assert.throws(() => buildLeadFields({
    source: 'связаться', name: 'Анна', email: 'anna@example.org', agree: '',
  }), ValidationError);
});

test('rejects submissions that fill the hidden spam honeypot', () => {
  assert.equal(typeof buildLeadFields, 'function');
  assert.throws(() => buildLeadFields({
    source: 'связаться', name: 'Bot', email: 'bot@example.org', agree: 'on', website: 'spam.example',
  }), error => error instanceof ValidationError && error.code === 'spam_detected');
});

test('rejects malformed email and overlong fields before they reach Bitrix', () => {
  assert.equal(typeof buildLeadFields, 'function');
  assert.throws(() => buildLeadFields({
    source: 'связаться', name: 'Анна', email: 'not-an-email', agree: 'on',
  }), ValidationError);
  assert.throws(() => buildLeadFields({
    source: 'связаться', name: 'x'.repeat(121), phone: '123', agree: 'on',
  }), ValidationError);
});
