---
name: issue-17-plan
description: Task breakdown for adding CHANGELOG.md (three entries) per issue #17
---

# Add CHANGELOG.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this pipeline specifically, each task below is dispatched as its own fresh Implementer subagent — see `docs/AGENT_HARNESS.md`'s "The Implementer" section.

**Goal:** Add a `CHANGELOG.md` at the repo root with one short, most-recent-first entry for each of the three notable changes so far: the initial scraper/digest feature, issue #1 (notification suppression), and issue #14 (DRY_RUN mode).

**Architecture:** A single new static Markdown file, built up incrementally — one task per entry — so each addition is independently reviewable against its source issue/commit. No code, no functions, no build step.

**Tech Stack:** None beyond Markdown. No dependency, no workflow, no script touches anything here.

## Global Constraints

- New file only: `CHANGELOG.md` at repo root. Do not touch `README.md`, any workflow file, or any other doc (per the issue's explicit non-goals).
- No auto-generation tooling, no changelog-linting, no template system — this is a one-time, manually-scoped file (per the issue's explicit non-goals).
- Entries are most-recent-first, one or two lines each, format `## <date>` + a short bullet — no strict schema required (per the issue).
- Content must be sourced from the real issues/commits, not invented wording:
  - Initial scraper/digest feature: commit `d4ac280` ("Add daily Amazon wishlist price monitor"), 2026-07-18.
  - Issue #1, notification suppression: commit `8b74814` ("Suppress repeat notifications for the same book within 14 days (#9)"), 2026-07-18.
  - Issue #14, DRY_RUN mode: commit `9abcd67` ("Add DRY_RUN mode to skip sending email and updating notification state (#14) (#15)"), 2026-07-19.
- This is a pure-logic, prototype test issue per the Analyzer's classification (`.agents/analysis.md`) — no live Amazon check, no fixture work, no test suite changes are needed or expected.

## Seams

**None.** This plan introduces zero functions and zero executable logic — the entire deliverable is static Markdown content. There is nothing to name a signature for and nothing to unit-test in the `node:test` sense; "verification" below means confirming the file's literal text, not running assertions against a pure function's return value. Recorded here explicitly (rather than left implicit) so a fresh Implementer subagent doesn't go looking for a seam that doesn't exist.

---

### Task 1: Create CHANGELOG.md with header and the initial-feature entry

**Files:**
- Create: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `CHANGELOG.md` exists at repo root with a top-level `# Changelog` heading and one dated entry. Task 2 and Task 3 each append one more dated entry below the existing content, in the same format.

- [ ] **Step 1: Write CHANGELOG.md**

```markdown
# Changelog

## 2026-07-18

- Initial release: a daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under a configurable price threshold, and emails a digest.
```

- [ ] **Step 2: Verify the file's exact content**

Run: `cat CHANGELOG.md`
Expected output (exact):

```
# Changelog

## 2026-07-18

- Initial release: a daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under a configurable price threshold, and emails a digest.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "Add CHANGELOG.md with initial scraper/digest entry"
```

---

### Task 2: Add the issue #1 (notification suppression) entry

**Files:**
- Modify: `CHANGELOG.md` (append below the existing `## 2026-07-18` entry from Task 1)

**Interfaces:**
- Consumes: `CHANGELOG.md` as produced by Task 1 — do not alter the existing `# Changelog` heading or the 2026-07-18 initial-release entry, only add to the file.
- Produces: `CHANGELOG.md` with two dated entries. Task 3 appends a third below this one.

- [ ] **Step 1: Append the issue #1 entry**

Add this text to the end of `CHANGELOG.md`, so the full file reads:

```markdown
# Changelog

## 2026-07-18

- Initial release: a daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under a configurable price threshold, and emails a digest.
- Suppress repeat email notifications for the same book within a 14-day window, tracked via a `notified.json` state file (keyed by ASIN) committed back to the repo. ([#1](https://github.com/brianmcallister/amazon-books-wishlist-monitor/issues/1))
```

(Note: both the initial release and this suppression feature landed the same day, so they share the `## 2026-07-18` heading rather than getting a duplicate heading.)

- [ ] **Step 2: Verify the file's exact content**

Run: `cat CHANGELOG.md`
Expected output (exact):

```
# Changelog

## 2026-07-18

- Initial release: a daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under a configurable price threshold, and emails a digest.
- Suppress repeat email notifications for the same book within a 14-day window, tracked via a `notified.json` state file (keyed by ASIN) committed back to the repo. ([#1](https://github.com/brianmcallister/amazon-books-wishlist-monitor/issues/1))
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "Add CHANGELOG.md entry for issue #1 (notification suppression)"
```

---

### Task 3: Add the issue #14 (DRY_RUN mode) entry

**Files:**
- Modify: `CHANGELOG.md` (add a new `## 2026-07-19` heading above the `## 2026-07-18` section, since this entry lands on a later date)

**Interfaces:**
- Consumes: `CHANGELOG.md` as produced by Task 2 — do not alter either existing bullet under `## 2026-07-18`.
- Produces: final `CHANGELOG.md`, most-recent-first, matching the issue's full required scope (all three entries present).

- [ ] **Step 1: Add the 2026-07-19 heading and DRY_RUN entry above the existing section**

The full file should read:

```markdown
# Changelog

## 2026-07-19

- Add an opt-in `DRY_RUN=true` mode that runs the full scrape/match/suppression pipeline and logs what would happen, without sending email or mutating the committed `notified.json` state. ([#14](https://github.com/brianmcallister/amazon-books-wishlist-monitor/issues/14))

## 2026-07-18

- Initial release: a daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under a configurable price threshold, and emails a digest.
- Suppress repeat email notifications for the same book within a 14-day window, tracked via a `notified.json` state file (keyed by ASIN) committed back to the repo. ([#1](https://github.com/brianmcallister/amazon-books-wishlist-monitor/issues/1))
```

- [ ] **Step 2: Verify the file's exact final content**

Run: `cat CHANGELOG.md`
Expected output (exact, matching Step 1's block above).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "Add CHANGELOG.md entry for issue #14 (DRY_RUN mode)"
```

---

## Coverage Checklist

Mapping every acceptance criterion in issue #17 to a task:

| Issue #17 requirement | Task |
|---|---|
| New `CHANGELOG.md` at repo root | Task 1 |
| Brief entry for the initial scraper/digest feature | Task 1 |
| Brief entry for issue #1 (notification suppression) | Task 2 |
| Brief entry for issue #14 (DRY_RUN mode) | Task 3 |
| Keep it short — one or two lines per entry | Tasks 1–3 (each entry is a single bullet) |
| Most-recent-first ordering | Task 3 (places 2026-07-19 above 2026-07-18) |
| No strict format — simple `## <date>` + bullets is fine | Tasks 1–3 |
| Pull actual summaries from the real issues/PRs, not invented wording | Tasks 1–3 (each cites its source commit/issue above) |

**Explicitly not touched, matching issue #17's stated non-goals:**
- No workflow, README, or other doc is wired to this file or modified — only `CHANGELOG.md` is created.
- No auto-generation mechanism for future changelog entries — this is a one-time, manually-authored file.
- No test suite changes, no fixtures, no live Amazon check — matches the Analyzer's pure-logic classification in `.agents/analysis.md`.
