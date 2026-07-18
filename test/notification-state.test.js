const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAsin } = require('../notification-state');

test('extractAsin extracts the 10-character ASIN from a /dp/ URL', () => {
  const url = 'https://www.amazon.com/Some-Book-Title/dp/B003P9VZLQ/ref=something';
  assert.equal(extractAsin(url), 'B003P9VZLQ');
});

test('extractAsin falls back to the full URL when the pattern does not match', () => {
  const url = 'https://www.amazon.com/some/other/path/with/no/asin';
  assert.equal(extractAsin(url), url);
});
