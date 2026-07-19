# CHANGELOG.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CHANGELOG.md` at the repo root with brief, most-recent-first entries for the three notable changes so far: the initial scraper/digest feature, issue #1's notification-suppression window (PR #9), and issue #14's `DRY_RUN` mode (PR #15).

**Architecture:** This is a content-only documentation task — one new static Markdown file, no application code touched, no new dependencies. To keep it inside this pipeline's normal TDD mechanics rather than being a bare "just write the file" exception, the one task below still runs RED → GREEN: a `node:test` file asserts the required sections/keywords exist in `CHANGELOG.md` (RED, since the file doesn't exist yet), then the file is written to make it pass (GREEN).

**Tech Stack:** Plain Markdown; `node:test` + `node:assert/strict` for the verification harness (matches `test/notification-state.test.js`'s existing pattern — no new test framework).

## Global Constraints

- File location: `CHANGELOG.md` at repo root (issue #17).
- Format: simple `## <date/version>` heading + bullet list per entry, one or two lines per entry, **most-recent-first** (issue #17).
- Content must reflect the *actual* summaries of the referenced PRs/issues, not invented wording (issue #17) — verified against PR #9's and PR #15's real descriptions, quoted below in Task 1.
- Non-goals (issue #17, must remain untouched by this plan): no workflow integration, no auto-generation mechanism for future entries, no README or other doc changes — `CHANGELOG.md` is the only file this plan creates or modifies.

---

## Seams

**None.** This task introduces no pure functions and no new modules. The issue's own "Design" section scopes this as "Content only" — a single static Markdown file — and the "Non-goals" section explicitly rules out building any generation mechanism. Naming seams here would mean inventing structure the issue deliberately doesn't ask for (YAGNI). The only executable artifact this plan adds is a `node:test` file whose job is to assert against the *content* of `CHANGELOG.md` (existence, section headers, key terms, ordering) — it has no functions of its own to name as seams.

## Coverage Checklist

Every acceptance criterion in issue #17, mapped to the task that satisfies it:

| Acceptance criterion (issue #17) | Task |
|---|---|
| New file `CHANGELOG.md` at repo root | Task 1 |
| Entry for the initial scraper/digest feature | Task 1 |
| Entry for issue #1 / PR #9 (notification suppression) | Task 1 |
| Entry for issue #14 / PR #15 (`DRY_RUN` mode) | Task 1 |
| Format: `## <date/version>` + bullets, brief (1-2 lines/entry) | Task 1 |
| Most-recent-first ordering | Task 1 |
| Wording pulled from the actual PRs/issues, not invented | Task 1 |

**Explicit non-goals this plan does not touch** (per issue #17's own "Non-goals" section):
- No changes to any `.github/workflows/*` file — this plan creates zero workflow wiring for the changelog.
- No auto-generation mechanism for future entries — `CHANGELOG.md` is hand-written, static content, added once.
- No README or other documentation file is created or modified — only `CHANGELOG.md`.

---

### Task 1: Create `CHANGELOG.md` with the three notable-change entries

**Files:**
- Create: `CHANGELOG.md`
- Test: `test/changelog.test.js`

**Interfaces:**
- Consumes: nothing (no prior tasks).
- Produces: nothing (this is the only task; no later task depends on it).

**Source material to pull entry wording from (do not invent new wording):**
- Initial feature — from `README.md`'s opening description: "Checks a public Amazon wish list daily for books under a price threshold and emails a digest."
- Issue #1 / PR #9, title: "Suppress repeat notifications for the same book within 14 days." PR body's "Why" section: "repeated daily emails for the same under-threshold book, every day it stays under `PRICE_THRESHOLD`, are noise. This adds a 14-day suppression window — once a book has been emailed, it's not emailed again for at least 14 days, even if it stays under threshold on subsequent runs." Merged 2026-07-18.
- Issue #14 / PR #15, title: "Add DRY_RUN mode to skip sending email and updating notification state." PR body's "Why" section: "an opt-in `DRY_RUN=true` environment variable so a run ... can exercise the full scrape + match + suppression pipeline and log what *would* happen, without actually emailing anyone or mutating committed `notified.json` state." Merged 2026-07-19.

- [ ] **Step 1: Write the failing test**

Create `test/changelog.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/changelog.test.js`
Expected: FAIL — `CHANGELOG.md` does not exist yet, so every assertion reading it errors (`ENOENT`) or the existence check fails first.

- [ ] **Step 3: Write `CHANGELOG.md`**

```markdown
# Changelog

## 2026-07-19 — DRY_RUN mode
- Added an opt-in `DRY_RUN=true` environment variable so a run can exercise the full scrape, match, and suppression pipeline and log what would happen — without sending email or mutating the committed `notified.json` state. (#14, PR #15)

## 2026-07-18 — Notification suppression
- Added a 14-day suppression window so the same under-threshold book isn't emailed again every day it stays under `PRICE_THRESHOLD` — once a book has been emailed, it's suppressed for at least 14 days. (#1, PR #9)

## 2026-07-18 — Initial release
- Daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under `PRICE_THRESHOLD`, and emails a digest of matches.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/changelog.test.js`
Expected: PASS — all 5 assertions green.

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: PASS — all pre-existing `test/notification-state.test.js` cases plus the 5 new `test/changelog.test.js` cases green, nothing else changed.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md test/changelog.test.js
git commit -m "Implementer (#17): Add CHANGELOG.md with initial-release, suppression, and DRY_RUN entries."
```
