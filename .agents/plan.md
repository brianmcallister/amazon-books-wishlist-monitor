# Suppress Repeat Notifications (14-Day Window) Implementation Plan

> **For agentic workers:** This plan is executed by this repo's own agent pipeline (see
> `docs/AGENT_HARNESS.md`), not Superpowers' own `subagent-driven-development` dispatch
> scripts — the Orchestrator dispatches a **fresh Implementer subagent per task below**
> via the `Agent` tool, one task at a time, in order. Each Implementer uses Superpowers'
> `test-driven-development` skill (RED-GREEN-REFACTOR, one commit per step) for its one
> assigned task only. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a book has been emailed, don't email about that specific book again for at
least 14 days, even if it stays under `PRICE_THRESHOLD` on subsequent daily runs — without
touching scraping/DOM or SMTP connection logic.

**Architecture:** All new logic lives in a new, dependency-free CommonJS module,
`notification-state.js`, at the repo root — a set of small pure(-ish) functions covering
ASIN extraction, state-file load/save, 14-day-window partitioning, state update, pruning,
and log-line formatting. `check-wishlist.js` changes in exactly two places: one new
`require` + constant near the top, and its tail IIFE, which calls into the new module
between computing `matches` and calling the (untouched) `sendEmail`. `scrapeWishlist()` and
`sendEmail()`'s bodies are not modified anywhere in this plan. The GitHub Actions workflow
gains a `contents: write` permission and one new step that commits `notified.json` only
when it actually changed.

**Tech Stack:** Plain Node.js (CommonJS, matching the existing single-file style), no new
npm dependencies, `node:test` + `node:assert/strict` for tests (built into Node 18+, no
test-framework dependency to add).

## Global Constraints

- Node.js: repo CI pins `node-version: 20` (`.github/workflows/check-wishlist.yml`); local
  environment is Node 22 — both support `node:test` natively. Don't add a test-runner
  dependency.
- **No `npm test` script exists yet** (`package.json` — see `.agents/analysis.md` caveat 1,
  tracked separately as issue #2). Every task's verification below runs tests directly via
  `node --test <path>`, never `npm test`. Do not add a `test` script to `package.json` in
  this plan — that's issue #2's job, not this one's.
- CommonJS only (`require`/`module.exports`), matching every existing file in this repo.
  No ESM, no TypeScript, no build step.
- `SUPPRESSION_WINDOW_DAYS` is hardcoded to `14` — not read from an environment variable,
  not a function parameter with a default that could be overridden. Per issue #1's explicit
  non-goal: no per-book configurable window.
- Do not modify a single line inside `scrapeWishlist()` or `sendEmail()`'s function bodies
  (`check-wishlist.js` lines 31–141, 143–190 as of this plan's writing). Per `CLAUDE.md`'s
  load-bearing list and the issue's own "leave the scraping/SMTP code alone" instruction.
- All new functions in `notification-state.js` are pure with respect to their inputs (no
  hidden global state, no mutation of argument objects) with the sole exception of
  `loadNotifiedState`/`saveNotifiedState`, whose only side effect is the one file read/write
  each is explicitly responsible for.
- `notified.json` lives at the repo root and is *not* added to `.gitignore` (verified
  against the current `.gitignore`, which lists only `node_modules/`, `*.png`, and
  `wishlist-debug.html` — no change needed there, just don't add one).

## File Structure

- **Create:** `notification-state.js` (repo root) — the new pure-function module holding
  all suppression/state-file logic. Nothing in here touches Puppeteer, nodemailer, or the
  network.
- **Create:** `test/notification-state.test.js` — `node:test` suite for every function in
  the module above. Fully offline, no fixtures needed (pure JSON + date math, per
  `docs/AGENT_HARNESS.md`'s "pure-logic changes need zero fixtures").
- **Modify:** `check-wishlist.js` — one new `require`, one new path constant near the top;
  the tail IIFE (currently lines 192–219) reworked to load state, partition matches, log the
  summary, early-return when nothing fresh, send only fresh matches, then update/prune/save
  state after a successful send.
- **Modify:** `.github/workflows/check-wishlist.yml` — add `permissions: contents: write` to
  the `check` job, and one new step after the `node check-wishlist.js` step that commits
  `notified.json` only when it changed.

## Seams (pure functions introduced, for the coverage checklist and every task below)

All of these live in `notification-state.js` and are exported via `module.exports`:

| Function | Signature | Responsibility |
|---|---|---|
| `extractAsin` | `(url: string) => string` | Parses the 10-char ASIN out of a `/dp/<ASIN>` URL; returns the full URL unchanged if the pattern doesn't match. |
| `loadNotifiedState` | `(filePath: string) => object` | Reads and JSON-parses the state file at `filePath`; returns `{}` if the file is missing or the contents don't parse. |
| `saveNotifiedState` | `(filePath: string, state: object) => void` | Writes `state` to `filePath` as pretty-printed JSON via `fs.writeFileSync`. |
| `isSuppressed` | `(notifiedAtIso: string, now: Date) => boolean` | True if `now - notifiedAtIso` is strictly less than 14 days (i.e. still within the suppression window). |
| `partitionMatches` | `(matches: Array<{url}>, state: object, now: Date) => { freshMatches, suppressedMatches }` | Splits `matches` by ASIN lookup against `state`, using `isSuppressed`; no entry or an entry ≥14 days old is fresh. |
| `buildUpdatedState` | `(state: object, freshMatches: Array<{url}>, now: Date) => object` | Returns a new state object with `now.toISOString()` recorded for every fresh match's ASIN; does not mutate `state`. |
| `pruneState` | `(state: object, now: Date) => object` | Returns a new state object keeping only entries still within the 14-day window (via `isSuppressed`); does not mutate `state`. |
| `formatSuppressionSummary` | `({ totalMatches, suppressedCount, freshCount, threshold }) => string` | Formats the exact required log line: `"X item(s) under $Y. Z already notified within 14 days, suppressed. W fresh match(es)."` |

Note on why the wiring step (Task 7) has no automated test: every branch of *decision logic*
is covered by the seams above, each independently unit-tested. The remaining code in
`check-wishlist.js`'s IIFE is thin glue — call `scrapeWishlist`, call these pure functions,
call `sendEmail` — and `scrapeWishlist`/`sendEmail` are both real network/browser calls with
no exported, mockable entry points in this codebase today. Introducing dependency injection
or an exported test seam for them would itself be the kind of "unrelated refactoring of
`scrapeWishlist()`/`sendEmail()`" the issue explicitly rules out. Task 7's verification is
therefore a syntax check plus an explicit manual diff-scope check instead of a `node --test`
run — this is a deliberate, documented choice, not an oversight.

---

### Task 1: `extractAsin`

**Files:**
- Create: `notification-state.js`
- Test: `test/notification-state.test.js`

**Interfaces:**
- Produces: `extractAsin(url: string): string` — used by `partitionMatches` (Task 3) and
  `buildUpdatedState` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `test/notification-state.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/notification-state.test.js`
Expected: FAIL — `Error: Cannot find module '../notification-state'` (module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `notification-state.js`:

```js
const fs = require('fs');

const SUPPRESSION_WINDOW_DAYS = 14;
const SUPPRESSION_WINDOW_MS = SUPPRESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function extractAsin(url) {
  const match = url.match(/\/dp\/([A-Z0-9]{10})/);
  return match ? match[1] : url;
}

module.exports = {
  SUPPRESSION_WINDOW_DAYS,
  SUPPRESSION_WINDOW_MS,
  extractAsin,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/notification-state.test.js`
Expected: PASS — `# pass 2`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add notification-state.js test/notification-state.test.js
git commit -m "Add extractAsin for parsing ASINs out of wishlist item URLs"
git push
```

---

### Task 2: `loadNotifiedState` / `saveNotifiedState`

**Files:**
- Modify: `notification-state.js`
- Modify: `test/notification-state.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `loadNotifiedState(filePath: string): object`, `saveNotifiedState(filePath: string, state: object): void` — both used by the Task 7 wiring.

- [ ] **Step 1: Write the failing tests**

Append to `test/notification-state.test.js` (add `fs`, `os`, `path` requires at the top
alongside the existing ones, and widen the destructured import):

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAsin, loadNotifiedState, saveNotifiedState } = require('../notification-state');
```

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/notification-state.test.js`
Expected: FAIL on the 4 new tests — `loadNotifiedState is not a function` /
`saveNotifiedState is not a function` (the 2 Task 1 tests still pass).

- [ ] **Step 3: Write minimal implementation**

In `notification-state.js`, add below `extractAsin`:

```js
function loadNotifiedState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function saveNotifiedState(filePath, state) {
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}
```

Update the `module.exports` object to include both:

```js
module.exports = {
  SUPPRESSION_WINDOW_DAYS,
  SUPPRESSION_WINDOW_MS,
  extractAsin,
  loadNotifiedState,
  saveNotifiedState,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/notification-state.test.js`
Expected: PASS — `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add notification-state.js test/notification-state.test.js
git commit -m "Add loadNotifiedState/saveNotifiedState with missing/malformed-file fallback to {}"
git push
```

---

### Task 3: `isSuppressed` / `partitionMatches`

**Files:**
- Modify: `notification-state.js`
- Modify: `test/notification-state.test.js`

**Interfaces:**
- Consumes: `extractAsin` (Task 1).
- Produces: `isSuppressed(notifiedAtIso: string, now: Date): boolean` (also used by Task 5's
  `pruneState`), `partitionMatches(matches, state, now): { freshMatches, suppressedMatches }`
  (used by the Task 7 wiring).

- [ ] **Step 1: Write the failing tests**

Append to `test/notification-state.test.js` (widen the destructured import to add
`isSuppressed, partitionMatches`):

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/notification-state.test.js`
Expected: FAIL on the 4 new tests — `isSuppressed is not a function` /
`partitionMatches is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `notification-state.js`, add:

```js
function isSuppressed(notifiedAtIso, now) {
  const notifiedAt = new Date(notifiedAtIso).getTime();
  if (Number.isNaN(notifiedAt)) return false;
  return now.getTime() - notifiedAt < SUPPRESSION_WINDOW_MS;
}

function partitionMatches(matches, state, now) {
  const freshMatches = [];
  const suppressedMatches = [];
  for (const match of matches) {
    const asin = extractAsin(match.url);
    const notifiedAt = state[asin];
    if (notifiedAt && isSuppressed(notifiedAt, now)) {
      suppressedMatches.push(match);
    } else {
      freshMatches.push(match);
    }
  }
  return { freshMatches, suppressedMatches };
}
```

Update `module.exports` to add `isSuppressed, partitionMatches`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/notification-state.test.js`
Expected: PASS — `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add notification-state.js test/notification-state.test.js
git commit -m "Add isSuppressed/partitionMatches for the 14-day suppression window"
git push
```

---

### Task 4: `buildUpdatedState`

**Files:**
- Modify: `notification-state.js`
- Modify: `test/notification-state.test.js`

**Interfaces:**
- Consumes: `extractAsin` (Task 1).
- Produces: `buildUpdatedState(state, freshMatches, now): object` — used by the Task 7 wiring.

- [ ] **Step 1: Write the failing test**

Append to `test/notification-state.test.js` (add `buildUpdatedState` to the import):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/notification-state.test.js`
Expected: FAIL — `buildUpdatedState is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `notification-state.js`, add:

```js
function buildUpdatedState(state, freshMatches, now) {
  const updated = { ...state };
  const nowIso = now.toISOString();
  for (const match of freshMatches) {
    updated[extractAsin(match.url)] = nowIso;
  }
  return updated;
}
```

Update `module.exports` to add `buildUpdatedState`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/notification-state.test.js`
Expected: PASS — `# pass 11`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add notification-state.js test/notification-state.test.js
git commit -m "Add buildUpdatedState to record notification timestamps for fresh matches"
git push
```

---

### Task 5: `pruneState`

**Files:**
- Modify: `notification-state.js`
- Modify: `test/notification-state.test.js`

**Interfaces:**
- Consumes: `isSuppressed` (Task 3).
- Produces: `pruneState(state, now): object` — used by the Task 7 wiring.

- [ ] **Step 1: Write the failing test**

Append to `test/notification-state.test.js` (add `pruneState` to the import):

```js
test('pruneState removes entries older than 14 days and keeps recent ones', () => {
  const now = new Date('2026-07-18T00:00:00.000Z');
  const state = {
    RECENT000A: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago, kept
    STALE0000B: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days ago, pruned
    BOUNDARY0C: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(), // exactly 14 days, pruned
  };

  const pruned = pruneState(state, now);

  assert.deepEqual(pruned, { RECENT000A: state.RECENT000A });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/notification-state.test.js`
Expected: FAIL — `pruneState is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `notification-state.js`, add:

```js
function pruneState(state, now) {
  const pruned = {};
  for (const [asin, notifiedAtIso] of Object.entries(state)) {
    if (isSuppressed(notifiedAtIso, now)) {
      pruned[asin] = notifiedAtIso;
    }
  }
  return pruned;
}
```

Update `module.exports` to add `pruneState`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/notification-state.test.js`
Expected: PASS — `# pass 12`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add notification-state.js test/notification-state.test.js
git commit -m "Add pruneState to drop stale (>=14-day-old) suppression entries before writing"
git push
```

---

### Task 6: `formatSuppressionSummary`

**Files:**
- Modify: `notification-state.js`
- Modify: `test/notification-state.test.js`

**Interfaces:**
- Consumes: nothing from other seams.
- Produces: `formatSuppressionSummary({ totalMatches, suppressedCount, freshCount, threshold }): string` — used by the Task 7 wiring.

- [ ] **Step 1: Write the failing test**

Append to `test/notification-state.test.js` (add `formatSuppressionSummary` to the import):

```js
test('formatSuppressionSummary formats the exact required summary line', () => {
  const line = formatSuppressionSummary({ totalMatches: 3, suppressedCount: 1, freshCount: 2, threshold: 5 });
  assert.equal(line, '3 item(s) under $5. 1 already notified within 14 days, suppressed. 2 fresh match(es).');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/notification-state.test.js`
Expected: FAIL — `formatSuppressionSummary is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `notification-state.js`, add:

```js
function formatSuppressionSummary({ totalMatches, suppressedCount, freshCount, threshold }) {
  return `${totalMatches} item(s) under $${threshold}. ${suppressedCount} already notified within 14 days, suppressed. ${freshCount} fresh match(es).`;
}
```

Final `module.exports` for `notification-state.js` (all seven functions plus the two
constants, confirm the full object matches this exactly):

```js
module.exports = {
  SUPPRESSION_WINDOW_DAYS,
  SUPPRESSION_WINDOW_MS,
  extractAsin,
  loadNotifiedState,
  saveNotifiedState,
  isSuppressed,
  partitionMatches,
  buildUpdatedState,
  pruneState,
  formatSuppressionSummary,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/notification-state.test.js`
Expected: PASS — `# pass 13`, `# fail 0` (full suite, all 6 tasks' tests).

- [ ] **Step 5: Commit**

```bash
git add notification-state.js test/notification-state.test.js
git commit -m "Add formatSuppressionSummary for the required per-run suppression log line"
git push
```

---

### Task 7: Wire suppression logic into `check-wishlist.js`

**Files:**
- Modify: `check-wishlist.js`

**Interfaces:**
- Consumes: every export of `notification-state.js` (Tasks 1–6) — `loadNotifiedState`,
  `saveNotifiedState`, `partitionMatches`, `buildUpdatedState`, `pruneState`,
  `formatSuppressionSummary`.
- Produces: nothing new for later tasks (this is the last code task).

**Important — read before editing:** Do not change anything inside `scrapeWishlist()`
(current lines 31–141) or `sendEmail()` (current lines 143–190). Only touch the top of the
file (requires/constants) and the tail IIFE (current lines 192–219).

- [ ] **Step 1: Add the new require and path constant**

In `check-wishlist.js`, immediately after the existing requires (after the current line 6,
`const nodemailer = require('nodemailer');`), add:

```js
const {
  loadNotifiedState,
  saveNotifiedState,
  partitionMatches,
  buildUpdatedState,
  pruneState,
  formatSuppressionSummary,
} = require('./notification-state');
```

Immediately after the existing `PRICE_THRESHOLD` constant (current line 12), add:

```js
const NOTIFIED_STATE_PATH = 'notified.json';
```

- [ ] **Step 2: Replace the tail IIFE**

Replace the current tail IIFE (current lines 192–219) with:

```js
(async () => {
  const items = await scrapeWishlist(WISHLIST_URL);
  console.log(`Scanned ${items.length} items.`);

  items.forEach((i) => {
    console.log(`  - "${i.title.slice(0, 70)}" raw="${i.priceText}" parsed=${i.price}`);
  });

  const priced = items.filter((i) => i.price !== null).sort((a, b) => a.price - b.price);
  const skipped = items.length - priced.length;
  if (skipped > 0) {
    console.log(`${skipped} item(s) had no parseable price and were excluded.`);
  }

  const matches = priced.filter((i) => i.price < PRICE_THRESHOLD);

  const notifiedState = loadNotifiedState(NOTIFIED_STATE_PATH);
  const now = new Date();
  const { freshMatches, suppressedMatches } = partitionMatches(matches, notifiedState, now);

  console.log(
    formatSuppressionSummary({
      totalMatches: matches.length,
      suppressedCount: suppressedMatches.length,
      freshCount: freshMatches.length,
      threshold: PRICE_THRESHOLD,
    })
  );

  if (freshMatches.length === 0) {
    console.log('No email sent (all matches already notified recently).');
    return;
  }

  await sendEmail({ matches: freshMatches, totalScanned: items.length });
  console.log('Email sent.');

  const updatedState = buildUpdatedState(notifiedState, freshMatches, now);
  const prunedState = pruneState(updatedState, now);
  saveNotifiedState(NOTIFIED_STATE_PATH, prunedState);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Note: this removes the old standalone `console.log(`${matches.length} item(s) under
$${PRICE_THRESHOLD}.`);` and the old `if (matches.length === 0) { console.log('No email
sent.'); return; }` block, replacing both with the single combined summary line and single
early-return message the issue specifies. This is a deliberate, spec-required change to this
one log/branch, not the "unrelated refactoring of existing console logging" the issue rules
out elsewhere — every other `console.log` call in the file (scan count, per-item lines,
skipped count, "Email sent.") is untouched.

- [ ] **Step 3: Verify syntax**

Run: `node --check check-wishlist.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify the diff is scoped correctly**

Run: `git diff check-wishlist.js`
Expected: the diff touches only (a) the new require + `NOTIFIED_STATE_PATH` constant near
the top, and (b) the tail IIFE. No line inside `scrapeWishlist()` or `sendEmail()` appears
in the diff.

- [ ] **Step 5: Re-run the full pure-logic test suite as a regression check**

Run: `node --test test/notification-state.test.js`
Expected: PASS — `# pass 13`, `# fail 0` (unaffected by this task, confirms nothing in
Tasks 1–6 was accidentally broken).

- [ ] **Step 6: Manual trace-through checklist (record answers in the commit message)**

Confirm, by reading the new IIFE:
- [ ] State is loaded (`loadNotifiedState`) before matches are partitioned.
- [ ] The summary line is logged for every run, including when `matches.length === 0`.
- [ ] `sendEmail` is called with `freshMatches` only, never the unfiltered `matches`.
- [ ] `saveNotifiedState` is only reachable *after* a successful `await sendEmail(...)` — the
      early return for `freshMatches.length === 0` happens before it, and any thrown error
      from `sendEmail` propagates to the outer `.catch`, skipping the save entirely.
- [ ] `pruneState` runs before `saveNotifiedState`, not after.

- [ ] **Step 7: Commit**

```bash
git add check-wishlist.js
git commit -m "Suppress repeat notifications: wire 14-day dedup into check-wishlist.js's send path"
git push
```

---

### Task 8: Workflow changes — commit `notified.json` after a successful run

**Files:**
- Modify: `.github/workflows/check-wishlist.yml`

**Interfaces:** none (YAML only, no code seams).

- [ ] **Step 1: Add `contents: write` permission to the `check` job**

In `.github/workflows/check-wishlist.yml`, change:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
```

to:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
```

- [ ] **Step 2: Add the state-commit step after `node check-wishlist.js`**

Insert this new step immediately after the existing `- run: node check-wishlist.js` step
(with its `env:` block) and before the existing `- name: Upload debug artifacts` step:

```yaml
      - name: Commit updated notification state
        run: |
          if [ -n "$(git status --porcelain notified.json)" ]; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add notified.json
            git commit -m "Update notification state"
            git push origin main
          else
            echo "No state changes to commit."
          fi
```

Note: no `if: always()` on this step — default conditioning means it only runs if the
`node check-wishlist.js` step succeeded, per the issue's explicit instruction. If the `git
push` fails (e.g. a race with another push to `main`), this step fails/warns; no retry logic
is added, per the issue's explicit "push failure: fine to just fail/warn."

- [ ] **Step 3: Verify the YAML is well-formed**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/check-wishlist.yml')); print('valid')"`
Expected: `valid`.

- [ ] **Step 4: Verify `notified.json` is not gitignored**

Run: `git check-ignore -v notified.json; echo "exit code: $?"`
Expected: no output before the echo, `exit code: 1` (nothing matched — the file is not
ignored). This is already true today (`.gitignore` only lists `node_modules/`, `*.png`,
`wishlist-debug.html`); this step just confirms this plan didn't add one.

- [ ] **Step 5: Verify the existing "Upload debug artifacts" step is untouched**

Run: `git diff .github/workflows/check-wishlist.yml`
Expected: the diff shows only the new `permissions:` block and the new "Commit updated
notification state" step; the "Upload debug artifacts" step (with its `if: always()`) is
unchanged.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/check-wishlist.yml
git commit -m "Commit notified.json to main after a successful run, only when it changed"
git push
```

---

## Coverage Checklist

Every acceptance criterion from issue #1, mapped to the task(s) that implement it:

| Issue #1 requirement | Task(s) |
|---|---|
| State file `notified.json` at repo root, keyed by ASIN, ISO timestamp value | Task 7 (writes via `saveNotifiedState`/`NOTIFIED_STATE_PATH`) |
| `extractAsin` regex + full-URL fallback | Task 1 |
| Missing file or unparseable JSON → `{}`, not a crash | Task 2 |
| Load `notified.json` before computing suppression | Task 7, Step 2 |
| Partition `matches` into fresh/suppressed via 14-day window | Task 3 |
| Log summary: `X item(s) under $Y. Z already notified within 14 days, suppressed. W fresh match(es).` | Task 6 (formatting) + Task 7 (calls it every run) |
| `freshMatches.length === 0` → log `No email sent (all matches already notified recently).` and return | Task 7, Step 2 |
| Otherwise call `sendEmail` with `freshMatches` only | Task 7, Step 2 + Step 6 checklist |
| After successful send, update state for each fresh match | Task 4 (`buildUpdatedState`) + Task 7 (calls it only after `await sendEmail` returns) |
| Prune entries older than 14 days before writing | Task 5 (`pruneState`) + Task 7 (calls it before save) |
| Write pruned state via `fs.writeFileSync`, only if an email was actually sent | Task 2 (`saveNotifiedState`) + Task 7 (unreachable on the early-return path) |
| Workflow: add `permissions: contents: write` | Task 8, Step 1 |
| Workflow: commit step — bot identity, `git add notified.json`, commit, `push origin main`, only if changed | Task 8, Step 2 |
| Workflow: default conditioning (not `if: always()`) | Task 8, Step 2 |
| Workflow: push failure is fine to fail/warn (no retry logic) | Task 8, Step 2 (documented, no code added) |
| `notified.json` NOT gitignored | Task 8, Step 4 (verified, no change needed) |
| Testing: first-run-ever (no `notified.json`) doesn't crash | Task 2 test ("returns {} when the file does not exist") |
| Testing: suppression boundary (<14 days excluded, ≥14 days included) | Task 3 tests (`isSuppressed` boundary cases) |
| Testing: pruning of entries older than 14 days | Task 5 test (`pruneState`, including the exact-14-day boundary case) |
| Testing: `notified.json` committed to `main` only when email sent, only touching that file | Task 8, Step 2 (`git status --porcelain notified.json` gate, `git add notified.json` only) + Task 7 (save is unreachable when nothing was sent) |

## Explicit Non-Goals (confirmed against issue #1's own non-goals — nothing in this plan touches these)

- **No price-drop override.** Nothing in `partitionMatches`/`isSuppressed` considers price
  at all, only ASIN + elapsed time — a book that dropped in price further is suppressed
  exactly the same as one that didn't.
- **No per-book configurable suppression window.** `SUPPRESSION_WINDOW_DAYS = 14` is a
  module-level constant in `notification-state.js` (Task 1), not read from an env var, not
  a parameter with a caller-supplied override anywhere in Tasks 1–8.
- **No database, external service, GitHub Actions cache, or artifacts for this state.**
  `notified.json` is a plain JSON file, read/written with `fs.readFileSync`/
  `fs.writeFileSync` (Task 2) and committed via plain `git add`/`git commit`/`git push`
  (Task 8) — the same idiom `docs/AGENT_HARNESS.md` already uses for pipeline state.
- **No unrelated refactoring of `scrapeWishlist()`, `sendEmail()`, or existing console
  logging.** Task 7 Step 4 is an explicit verification step for this; the only logging
  change made anywhere in this plan is the one line the issue itself specifies replacing
  (Task 7 Step 2's note).
- **This plan does not touch:** `README.md`, `package.json` (no `test` script added — see
  Global Constraints), `.gitignore`, `test/fixtures/*` (no fixtures needed — pure-logic
  change per `docs/AGENT_HARNESS.md`), or any dependency in `package-lock.json`.
