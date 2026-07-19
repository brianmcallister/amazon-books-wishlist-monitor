# DRY_RUN Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Pipeline note:** this file lives at `.agents/plan.md`, not the writing-plans skill's own default location — every other stage in this repo's pipeline (Implementer, Tester, Deployer) reads this exact path.

**Goal:** Add an opt-in `DRY_RUN=true` environment variable that runs the full scrape/match/suppression pipeline but skips `sendEmail()` and skips writing `notified.json`, logging what *would* have happened instead.

**Architecture:** Two new pure, unit-testable functions (`isDryRun`, `formatDryRunMessage`) live in `notification-state.js` next to the existing pure suppression-window functions and their established `test/notification-state.test.js` test pattern. `check-wishlist.js`'s tail IIFE imports both and adds one small control-flow branch — no change to `scrapeWishlist()` or `sendEmail()` internals, no change to any line before the branch.

**Tech Stack:** Node.js built-in `node:test` + `node:assert/strict` (existing convention — see `test/notification-state.test.js`). No new dependencies.

## Global Constraints

- `DRY_RUN` is read via `process.env.DRY_RUN`, matched with **exact, case-sensitive `=== 'true'`** — the same convention `SAVE_DEBUG_ARTIFACTS === 'true'` already uses in `check-wishlist.js`. Anything else (unset, `'false'`, `''`, `'TRUE'`) is disabled.
- The dry-run log line, verbatim, when enabled and `freshMatches.length > 0`:
  `[DRY RUN] Would send email for N fresh match(es) -- no email sent, notification state not updated.`
  (`N` is the fresh-match count.)
- When dry-run is enabled and `freshMatches.length === 0`, no new message — the existing `'No email sent (all matches already notified recently).'` path already covers it unchanged.
- Do not touch `scrapeWishlist()` or `sendEmail()`'s internals (CLAUDE.md load-bearing code list). Do not touch any `check-wishlist.js` line before the new branch — scraping, filtering, partitioning, and the suppression-summary log must be byte-identical to today's output regardless of `DRY_RUN`.
- No `.github/workflows/*` changes (non-goal — `DRY_RUN` is just another `process.env` read, same as `PRICE_THRESHOLD`).
- No email content changes.
- No live Amazon check — this diff never touches `scrapeWishlist()`/`sendEmail()` bodies (per Analyzer's PURE-LOGIC classification in `.agents/analysis.md`).
- Tests use `node:test`/`node:assert/strict`, run via `npm test` (`node --test`).

---

## Seams

Two new pure functions, both added to `notification-state.js` (chosen over inlining in `check-wishlist.js` because that file has no test file, no exports, and top-level side effects on require — `notification-state.js` already has the working `test/notification-state.test.js` harness these can slot into directly, matching the issue's own "alongside notification-state.js" option):

1. **`isDryRun(env)`**
   `(env: Record<string, string | undefined>) => boolean`
   Returns `true` iff `env.DRY_RUN === 'true'` (exact case-sensitive match). One-line responsibility: decide whether dry-run mode is enabled for this run, given an env-like object (pass `process.env` at the call site so this stays a pure function of its argument, not a hidden global read).

2. **`formatDryRunMessage(freshCount)`**
   `(freshCount: number) => string`
   Returns the exact required log line: `` `[DRY RUN] Would send email for ${freshCount} fresh match(es) -- no email sent, notification state not updated.` ``. One-line responsibility: format the dry-run notice text, mirroring how `formatSuppressionSummary` already formats its own log line as a pure function of its inputs.

No other seams are needed. The `check-wishlist.js` wiring itself (Task 3) is a plain `if`/`return` using these two functions — the same shape as the existing, already-untested `if (freshMatches.length === 0) { ...; return; }` branch right next to it. There is no existing (or planned) harness that unit-tests the tail IIFE's control flow directly (doing so would require mocking Puppeteer/SMTP, out of scope per the issue's non-goals), so Task 3 is verified by tracing the diff and running the full regression suite, not a new automated test.

---

## Task 1: Add `isDryRun(env)` to `notification-state.js`

**Files:**
- Modify: `notification-state.js` (add function after `isSuppressed`, around line 28; add to `module.exports`, currently lines 68-79)
- Test: `test/notification-state.test.js` (add `isDryRun` to the destructured import at the top, currently lines 6-15; add new tests after the last existing test, currently ending at line 125)

**Interfaces:**
- Produces: `isDryRun(env)` — used by Task 3's `check-wishlist.js` wiring as `isDryRun(process.env)`.

- [ ] **Step 1: Write the failing tests**

Add to the destructured import at the top of `test/notification-state.test.js` (line 6-15), inserting `isDryRun` into the list:

```js
const {
  extractAsin,
  loadNotifiedState,
  saveNotifiedState,
  isSuppressed,
  partitionMatches,
  buildUpdatedState,
  pruneState,
  formatSuppressionSummary,
  isDryRun,
} = require('../notification-state');
```

Append these tests at the end of the file (after the existing `formatSuppressionSummary` test, which currently ends at line 124):

```js

test('isDryRun returns true when DRY_RUN is exactly the string "true"', () => {
  assert.equal(isDryRun({ DRY_RUN: 'true' }), true);
});

test('isDryRun returns false when DRY_RUN is unset', () => {
  assert.equal(isDryRun({}), false);
});

test('isDryRun returns false when DRY_RUN is "false"', () => {
  assert.equal(isDryRun({ DRY_RUN: 'false' }), false);
});

test('isDryRun returns false when DRY_RUN is an empty string', () => {
  assert.equal(isDryRun({ DRY_RUN: '' }), false);
});

test('isDryRun is case-sensitive: "TRUE" or "True" do not enable dry-run', () => {
  assert.equal(isDryRun({ DRY_RUN: 'TRUE' }), false);
  assert.equal(isDryRun({ DRY_RUN: 'True' }), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `isDryRun` is not a function (it isn't exported/defined yet), reported for each of the 5 new tests.

- [ ] **Step 3: Write the minimal implementation**

In `notification-state.js`, add this function directly after `isSuppressed` (after line 28, before `function partitionMatches`):

```js
function isDryRun(env) {
  return env.DRY_RUN === 'true';
}
```

Add `isDryRun,` to `module.exports` (in the existing block at lines 68-79), placed after `formatSuppressionSummary,`. Add **only** `isDryRun,` in this task — do not add `formatDryRunMessage` yet, since it isn't defined until Task 2 and referencing an undefined name in `module.exports` would throw a `ReferenceError` the moment anything requires this file, breaking this task's own tests:

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
  isDryRun,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests green, including the 5 new `isDryRun` tests.

- [ ] **Step 5: Commit**

```bash
git add notification-state.js test/notification-state.test.js
git commit -m "Add isDryRun(env) pure function for DRY_RUN env var check"
```

---

## Task 2: Add `formatDryRunMessage(freshCount)` to `notification-state.js`

**Files:**
- Modify: `notification-state.js` (add function after `formatSuppressionSummary`, currently lines 64-66; add to `module.exports`)
- Test: `test/notification-state.test.js` (add `formatDryRunMessage` to the destructured import; add new tests after Task 1's tests)

**Interfaces:**
- Consumes: nothing from Task 1 (independent pure function; order between Task 1 and Task 2 does not matter).
- Produces: `formatDryRunMessage(freshCount)` — used by Task 3's `check-wishlist.js` wiring as `formatDryRunMessage(freshMatches.length)`.

- [ ] **Step 1: Write the failing tests**

Add `formatDryRunMessage` to the destructured import at the top of `test/notification-state.test.js`:

```js
const {
  extractAsin,
  loadNotifiedState,
  saveNotifiedState,
  isSuppressed,
  partitionMatches,
  buildUpdatedState,
  pruneState,
  formatSuppressionSummary,
  isDryRun,
  formatDryRunMessage,
} = require('../notification-state');
```

Append these tests at the end of the file, after Task 1's `isDryRun` tests:

```js

test('formatDryRunMessage formats the exact required dry-run notice for multiple matches', () => {
  const line = formatDryRunMessage(3);
  assert.equal(
    line,
    '[DRY RUN] Would send email for 3 fresh match(es) -- no email sent, notification state not updated.'
  );
});

test('formatDryRunMessage formats the exact required dry-run notice for a single match', () => {
  const line = formatDryRunMessage(1);
  assert.equal(
    line,
    '[DRY RUN] Would send email for 1 fresh match(es) -- no email sent, notification state not updated.'
  );
});
```

(Note: `match(es)` is literal text, not grammatically pluralized — same convention `formatSuppressionSummary` already uses for `item(s)`/`match(es)` regardless of count.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `formatDryRunMessage` is not a function, reported for both new tests.

- [ ] **Step 3: Write the minimal implementation**

In `notification-state.js`, add this function directly after `formatSuppressionSummary` (after line 66, before `module.exports`):

```js
function formatDryRunMessage(freshCount) {
  return `[DRY RUN] Would send email for ${freshCount} fresh match(es) -- no email sent, notification state not updated.`;
}
```

Add `formatDryRunMessage,` to `module.exports`, after the `isDryRun,` line Task 1 already added:

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
  isDryRun,
  formatDryRunMessage,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests green, including the 2 new `formatDryRunMessage` tests (7 new tests total across Tasks 1 and 2, all passing alongside the pre-existing suite).

- [ ] **Step 5: Commit**

```bash
git add notification-state.js test/notification-state.test.js
git commit -m "Add formatDryRunMessage(freshCount) pure function for dry-run log line"
```

---

## Task 3: Wire `isDryRun`/`formatDryRunMessage` into `check-wishlist.js`'s tail IIFE

**Files:**
- Modify: `check-wishlist.js` (require list at lines 7-14; tail IIFE at lines 217-240)

**Interfaces:**
- Consumes: `isDryRun(env)` from Task 1, `formatDryRunMessage(freshCount)` from Task 2 — both already implemented and unit-tested by this point.
- Produces: nothing further downstream — this is the plan's final task.

There is no unit test for this task (see "Seams" above for why: the tail IIFE has top-level side effects — real Puppeteer, real SMTP — with no dependency-injection seam today, and adding one is out of scope for this issue). Verification is Steps 2-4 below: a syntax check, a full regression run, and an explicit manual trace against the acceptance criteria.

- [ ] **Step 1: Update the require list and add the dry-run branch**

In `check-wishlist.js`, update the destructured require (currently lines 7-14) to add `isDryRun` and `formatDryRunMessage`:

```js
const {
  loadNotifiedState,
  saveNotifiedState,
  partitionMatches,
  buildUpdatedState,
  pruneState,
  formatSuppressionSummary,
  isDryRun,
  formatDryRunMessage,
} = require('./notification-state');
```

In the tail IIFE, currently:

```js
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
```

Change to (inserting the new branch between the suppression-summary log and the existing zero-matches check, per `.agents/analysis.md`'s specified location):

```js
  console.log(
    formatSuppressionSummary({
      totalMatches: matches.length,
      suppressedCount: suppressedMatches.length,
      freshCount: freshMatches.length,
      threshold: PRICE_THRESHOLD,
    })
  );

  if (isDryRun(process.env) && freshMatches.length > 0) {
    console.log(formatDryRunMessage(freshMatches.length));
    return;
  }

  if (freshMatches.length === 0) {
    console.log('No email sent (all matches already notified recently).');
    return;
  }

  await sendEmail({ matches: freshMatches, totalScanned: items.length });
```

Everything from `const items = await scrapeWishlist(WISHLIST_URL);` (line 202) through the `formatSuppressionSummary` log (line 228) stays completely untouched — only the two lines shown above (`console.log(formatSuppressionSummary(...))` closing, and the code immediately after it) change.

- [ ] **Step 2: Syntax-check the file**

Run: `node -c check-wishlist.js`
Expected: no output, exit code 0 (valid syntax, no parse errors).

- [ ] **Step 3: Run the full regression suite**

Run: `npm test`
Expected: PASS — all pre-existing tests plus Tasks 1 and 2's new tests are unaffected by this change (this task adds no new tests of its own, per the "Interfaces"/no-unit-test note above); the count should match Task 2's final passing count exactly, since Task 3 touches no test file.

- [ ] **Step 4: Manually trace the diff against every acceptance criterion**

Run: `git diff HEAD~2 -- check-wishlist.js` (or `git diff` against the pre-Task-3 commit) and confirm, by reading the output line by line:

1. No line inside `scrapeWishlist()` (lines 40-150) or `sendEmail()` (lines 152-199) changed.
2. No line between `const items = await scrapeWishlist(...)` and the `console.log(formatSuppressionSummary(...))` call changed — scraping, filtering (`priced`, `skipped`), matching (`matches`), and suppression partitioning (`partitionMatches`) are byte-identical to before this diff.
3. `DRY_RUN` unset, `''`, or `'false'`: `isDryRun(process.env)` is `false`, so the new branch's condition is `false` regardless of `freshMatches.length`, and execution falls through exactly as before — `sendEmail()` still gets called when `freshMatches.length > 0`, matching Testing Guidance item 3 in the issue.
4. `DRY_RUN=true` with `freshMatches.length > 0`: the new branch's condition is `true`, so `formatDryRunMessage(freshMatches.length)` is logged and the function returns *before* `sendEmail()`, `buildUpdatedState()`, `pruneState()`, or `saveNotifiedState()` are reached — matching Testing Guidance item 1.
5. `DRY_RUN=true` with `freshMatches.length === 0`: the new branch's condition is `false` (short-circuited by `freshMatches.length > 0`), so control falls through unchanged to the existing `if (freshMatches.length === 0)` branch and its existing message — matching Testing Guidance item 2 (no new message, identical to a normal zero-match run).

- [ ] **Step 5: Commit**

```bash
git add check-wishlist.js
git commit -m "Wire DRY_RUN check into tail IIFE: skip sendEmail and state writes when enabled"
```

---

## Coverage Checklist

Every acceptance/testing-guidance line from the issue body, mapped to the task(s) that cover it:

| Issue requirement | Covered by |
|---|---|
| Read `DRY_RUN` from `process.env`, case-sensitive `'true'` match, same convention as `SAVE_DEBUG_ARTIFACTS === 'true'` | Task 1 (`isDryRun`) |
| `DRY_RUN=true` + at least one fresh match → logs `[DRY RUN] Would send email for N fresh match(es) -- no email sent, notification state not updated.` | Task 2 (`formatDryRunMessage`, exact string tested) + Task 3 Step 1 (wiring), Step 4 point 4 (trace) |
| `DRY_RUN=true` + at least one fresh match → does **not** call `sendEmail()` | Task 3 Step 1 (`return` before `sendEmail()`), Step 4 point 4 |
| `DRY_RUN=true` + at least one fresh match → does **not** call `buildUpdatedState`/`pruneState`/`saveNotifiedState` | Task 3 Step 1 (`return` before those calls), Step 4 point 4 |
| `DRY_RUN=true` + zero fresh matches → identical to normal zero-match run, no new message | Task 3 Step 1 (condition short-circuits on `freshMatches.length > 0`), Step 4 point 5 |
| `DRY_RUN` unset or `'false'` → behavior completely unchanged | Task 1 tests (`isDryRun` false for unset/`'false'`/`''`) + Task 3 Step 4 point 3 |
| Dry-run must not affect scraping/matching/suppression computation; every log line before the decision point identical to a normal run | Task 3 Step 1 (no lines before the new branch touched) + Step 4 points 1-2 |
| Seam suggestion: small pure function(s), unit-testable | Task 1 (`isDryRun`) + Task 2 (`formatDryRunMessage`), both with `node:test` coverage |

**Explicit non-goals — confirmed untouched by this plan:**

- **No email content changes.** No task modifies `sendEmail()`'s `text`/`html`/`subject` construction (lines 152-199 of `check-wishlist.js` are never touched by any task above).
- **No `.github/workflows/check-wishlist.yml` changes.** No task in this plan touches any file under `.github/workflows/`. `DRY_RUN` is read the same way `PRICE_THRESHOLD`/`SAVE_DEBUG_ARTIFACTS` already are — an ad hoc `env:` var on a manual/local invocation, no workflow-file plumbing required.
- **No live Amazon check.** No task requires running `scrapeWishlist()` against a real page or fixture; both new functions are pure and unit-tested in isolation, and Task 3's verification is a static diff trace, not an execution.
- **No README documentation task added**, consistent with this repo's existing precedent: `SAVE_DEBUG_ARTIFACTS` — an equivalent ad hoc `process.env` toggle already used the same way — is likewise undocumented in `README.md`'s "Optional repo variables" section. Adding docs for `DRY_RUN` specifically would be inconsistent with that existing convention rather than filling a real gap; if the project owner wants it documented, that's a separate, explicit ask.
