import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const window = {};
const sourcePath = fileURLToPath(new URL('../../../form-validation.js', import.meta.url));
try {
  runInNewContext(readFileSync(sourcePath, 'utf8'), { window });
} catch {}
const validateContact = window.DigitalMFormValidation?.validateContact;

test('accepts a valid email when phone is blank', () => {
  assert.equal(typeof validateContact, 'function');
  const result = validateContact('ana@example.com', '');
  assert.equal(result.valid, true);
  assert.equal(Object.keys(result.errors).length, 0);
});

test('accepts a valid phone when email is blank', () => {
  assert.equal(typeof validateContact, 'function');
  const result = validateContact('', '+7 (999) 123-45-67');
  assert.equal(result.valid, true);
  assert.equal(Object.keys(result.errors).length, 0);
});

test('rejects malformed email and too-short phone with field-specific errors', () => {
  assert.equal(typeof validateContact, 'function');
  const result = validateContact('mail', '123');
  assert.equal(result.valid, false);
  assert.match(result.errors.email, /корректный e-mail/i);
  assert.match(result.errors.phone, /пятью цифрами/i);
});

test('does not let a malformed optional field pass just because the other contact is valid', () => {
  assert.equal(typeof validateContact, 'function');
  const result = validateContact('ana@example.com', '123');
  assert.equal(result.valid, false);
  assert.equal(result.errors.email, undefined);
  assert.match(result.errors.phone, /пятью цифрами/i);
});

test('requires at least one valid contact method', () => {
  assert.equal(typeof validateContact, 'function');
  const result = validateContact('', '');
  assert.equal(result.valid, false);
  assert.match(result.errors.email, /укажите email или телефон/i);
});
