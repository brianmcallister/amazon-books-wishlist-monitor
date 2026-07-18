const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAsin, loadNotifiedState, saveNotifiedState } = require('../notification-state');

test('extractAsin extracts the 10-character ASIN from a /dp/ URL', () => {
  const url = 'https://www.amazon.com/Some-Book-Title/dp/B003P9VZLQ/ref=something';
  assert.equal(extractAsin(url), 'B003P9VZLQ');
});

test('extractAsin falls back to the full URL when the pattern does not match', () => {
  const url = 'https://www.amazon.com/some/other/path/with/no/asin';
  assert.equal(extractAsin(url), url);
});

test('loadNotifiedState returns {} when the file does not exist', () => {
  const missingPath = path.join(os.tmpdir(), `notified-state-missing-${Date.now()}.json`);
  assert.deepEqual(loadNotifiedState(missingPath), {});
});

test('loadNotifiedState returns {} when the file contains malformed JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notified-state-'));
  const filePath = path.join(dir, 'notified.json');
  fs.writeFileSync(filePath, '{not valid json');
  assert.deepEqual(loadNotifiedState(filePath), {});
});

test('loadNotifiedState returns the parsed object when the file is valid JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notified-state-'));
  const filePath = path.join(dir, 'notified.json');
  const state = { B003P9VZLQ: '2026-07-01T00:00:00.000Z' };
  fs.writeFileSync(filePath, JSON.stringify(state));
  assert.deepEqual(loadNotifiedState(filePath), state);
});

test('saveNotifiedState writes state that loadNotifiedState can read back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notified-state-'));
  const filePath = path.join(dir, 'notified.json');
  const state = { B003P9VZLQ: '2026-07-01T00:00:00.000Z' };
  saveNotifiedState(filePath, state);
  assert.deepEqual(loadNotifiedState(filePath), state);
});
