const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');

test('CHANGELOG.md exists at repo root', () => {
  assert.equal(fs.existsSync(CHANGELOG_PATH), true);
});

test('CHANGELOG.md documents the initial scraper/digest feature', () => {
  const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  assert.match(content, /wish list/i);
  assert.match(content, /digest/i);
});

test('CHANGELOG.md documents the notification-suppression feature (issue #1 / PR #9)', () => {
  const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  assert.match(content, /#1\b/);
  assert.match(content, /14-day suppression/i);
});

test('CHANGELOG.md documents the DRY_RUN mode (issue #14 / PR #15)', () => {
  const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  assert.match(content, /#14\b/);
  assert.match(content, /DRY_RUN=true/);
});

test('entries are ordered most-recent-first', () => {
  const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const dryRunIndex = content.search(/DRY_RUN=true/);
  const suppressionIndex = content.search(/14-day suppression/i);
  const initialIndex = content.search(/Daily GitHub Actions cron/);

  assert.notEqual(dryRunIndex, -1);
  assert.notEqual(suppressionIndex, -1);
  assert.notEqual(initialIndex, -1);
  assert.ok(dryRunIndex < suppressionIndex, 'DRY_RUN entry should appear before the suppression entry');
  assert.ok(suppressionIndex < initialIndex, 'suppression entry should appear before the initial-release entry');
});
