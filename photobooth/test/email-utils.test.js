import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, maskEmail, normalizeEmail, suggestEmail } from '../public/email-utils.js';

test('real-world addresses are accepted, including the awkward ones', () => {
  for (const ok of [
    'jane@example.com',
    'Jane.Doe+booth@Example.CO.UK',
    'o\'brien@example.ie',
    'a_b-c@sub.domain.example.org',
    'x@y.io',
    '1234567890@example.com',
    'user@xn--bcher-kva.example'.replace('xn--bcher-kva.example', 'example.xn--p1ai'),
  ]) assert.equal(isValidEmail(ok), true, ok);
});

test('junk and typos are rejected', () => {
  for (const bad of [
    '',
    'jane',
    'jane@',
    '@example.com',
    'jane@example',
    'jane@@example.com',
    'jane@exa mple.com',
    'jane doe@example.com',
    '.jane@example.com',
    'jane.@example.com',
    'ja..ne@example.com',
    'jane@-example.com',
    'jane@example-.com',
    'jane@example..com',
    'jane@example.c',
    'jane@example.123',
    'jane@<script>.com',
    `${'a'.repeat(65)}@example.com`,
    `jane@${'a'.repeat(250)}.com`,
    'a@b.c',
    null,
    undefined,
  ]) assert.equal(isValidEmail(bad), false, String(bad));
});

test('addresses are normalised the same way everywhere (trim + lower case)', () => {
  assert.equal(normalizeEmail('  Jane.Doe@Example.COM \n'), 'jane.doe@example.com');
  assert.equal(isValidEmail('  JANE@EXAMPLE.COM  '), true);
});

test('common domain typos get a suggestion; correct and unknown domains do not', () => {
  assert.equal(suggestEmail('ana@gmial.com'), 'ana@gmail.com');
  assert.equal(suggestEmail('Ana@GMAIL.CON'), 'ana@gmail.com');
  assert.equal(suggestEmail('bo@hotmial.com'), 'bo@hotmail.com');
  assert.equal(suggestEmail('cy@yaho.com'), 'cy@yahoo.com');
  assert.equal(suggestEmail('di@mycompany.con'), 'di@mycompany.com');
  assert.equal(suggestEmail('ed@gmail.com'), null);
  assert.equal(suggestEmail('fay@mycompany.com'), null);
  assert.equal(suggestEmail('nonsense'), null);
});

test('masking keeps just enough to recognise an address and never leaks the rest', () => {
  assert.equal(maskEmail('Jane.Doe@gmail.com'), 'j***@gmail.com');
  assert.equal(maskEmail('x@y.io'), 'x***@y.io');
  assert.equal(maskEmail('not an email'), '***');
  assert.equal(maskEmail('jane.doe@gmail.com').includes('doe'), false);
});
