const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractAsin,
  loadNotifiedState,
  saveNotifiedState,
  isSuppressed,
  partitionMatches,
  buildUpdatedState,
} = require('../notification-state');

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

test('isSuppressed returns true for a notification less than 14 days old', () => {
  const now = new Date('2026-07-18T00:00:00.000Z');
  const notifiedAt = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000 - 1)).toISOString();
  assert.equal(isSuppressed(notifiedAt, now), true);
});

test('isSuppressed returns false for a notification exactly 14 days old (boundary is fresh)', () => {
  const now = new Date('2026-07-18T00:00:00.000Z');
  const notifiedAt = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isSuppressed(notifiedAt, now), false);
});

test('isSuppressed returns false for a notification older than 14 days', () => {
  const now = new Date('2026-07-18T00:00:00.000Z');
  const notifiedAt = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isSuppressed(notifiedAt, now), false);
});

test('partitionMatches splits matches into fresh and suppressed using the 14-day window', () => {
  const now = new Date('2026-07-18T00:00:00.000Z');
  const recentlyNotifiedUrl = 'https://www.amazon.com/dp/B003P9VZLQ/ref=x';
  const longAgoNotifiedUrl = 'https://www.amazon.com/dp/B0011111AA/ref=x';
  const neverNotifiedUrl = 'https://www.amazon.com/dp/B0022222BB/ref=x';
  const state = {
    B003P9VZLQ: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    B0011111AA: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days ago
  };
  const matches = [
    { title: 'Recently notified', url: recentlyNotifiedUrl },
    { title: 'Notified long ago', url: longAgoNotifiedUrl },
    { title: 'Never notified', url: neverNotifiedUrl },
  ];

  const { freshMatches, suppressedMatches } = partitionMatches(matches, state, now);

  assert.deepEqual(freshMatches.map((m) => m.url), [longAgoNotifiedUrl, neverNotifiedUrl]);
  assert.deepEqual(suppressedMatches.map((m) => m.url), [recentlyNotifiedUrl]);
});

test('buildUpdatedState sets the current timestamp for every fresh match, leaving other entries untouched', () => {
  const now = new Date('2026-07-18T00:00:00.000Z');
  const state = { B0099999ZZ: '2026-07-01T00:00:00.000Z' };
  const freshMatches = [{ title: 'New match', url: 'https://www.amazon.com/dp/B003P9VZLQ/ref=x' }];

  const updated = buildUpdatedState(state, freshMatches, now);

  assert.deepEqual(updated, {
    B0099999ZZ: '2026-07-01T00:00:00.000Z',
    B003P9VZLQ: '2026-07-18T00:00:00.000Z',
  });
  assert.deepEqual(state, { B0099999ZZ: '2026-07-01T00:00:00.000Z' }); // not mutated
});
