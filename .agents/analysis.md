# Analyzer (#14): Issue Specification and Risk Classification

## Scope Confirmation

Issue #14 is **fully specified** and ready for planning. All required details are present:

### Specified requirements:
- **Feature**: Add opt-in `DRY_RUN` environment variable that runs full scrape/match/suppression logic but skips `sendEmail()` and `saveNotifiedState()`
- **Where**: Tail IIFE in `check-wishlist.js`, after suppression summary is logged (after line 228), before the zero-matches early return (line 230)
- **Implementation details**:
  - Read `DRY_RUN` from `process.env`
  - Case-sensitive string match: treat `'true'` as enabled (matches existing `SAVE_DEBUG_ARTIFACTS === 'true'` convention)
  - If dry-run is enabled AND there's at least one fresh match: log `[DRY RUN] Would send email for N fresh match(es) -- no email sent, notification state not updated.`, then return without calling `sendEmail()` or `buildUpdatedState`/`pruneState`/`saveNotifiedState()`
  - If dry-run is enabled and zero fresh matches: existing path already handles it correctly (no special message needed)
  - Log format is specified with example text
- **Suggested structure**: Small pure function like `isDryRun(env)` can be placed inline in `check-wishlist.js` or alongside `notification-state.js` (Planner's call)
- **Non-goals**: No email content changes, no workflow file changes, no live Amazon check needed

### Code locations confirmed:
- `check-wishlist.js`: Lines 201-244 show the tail IIFE where the change goes
- `notification-state.js`: Lines 20-22 show `saveNotifiedState()` that must not be called in dry-run
- Line 235: `sendEmail()` call that must be skipped in dry-run
- Line 238-240: `buildUpdatedState()`, `pruneState()`, `saveNotifiedState()` that must be skipped in dry-run

### Testing guidance provided:
- `DRY_RUN=true` with fresh matches: logs the dry-run message, `sendEmail` not called, `notified.json` not written
- `DRY_RUN=true` with zero fresh matches: behaves identically to normal run with zero fresh matches
- `DRY_RUN` unset or `'false'`: behavior completely unchanged

## Risk Classification

**PURE-LOGIC**

This task touches only application state/control-flow logic with no DOM parsing or SMTP changes.

**Evidence:**
- Does not touch `scrapeWishlist()` internals — scraping logic is untouched
- Does not touch `sendEmail()` internals — SMTP connection/email generation is untouched
- Does not touch scroll/merge/retry logic, DOM selectors, or any load-bearing code from CLAUDE.md's list
- Only changes: conditional logic in the tail IIFE around when `sendEmail()` gets called and when `saveNotifiedState()` gets called
- Only new code: a small pure function to check an environment variable, and a log statement

The issue explicitly states: "pure-logic, no scraping/SMTP changes, meant to exercise Analyzer → Planner → Implementer → Tester → Deployer → PR Risk Analyzer end-to-end for real" and "only touches the tail IIFE's control flow — specifically where `sendEmail()` gets called and where state gets saved — never what happens inside those functions."

## Caveats

None. Issue is well-specified and ready for planning.

## Acceptance Criteria Check

All acceptance criteria from the issue are fully specified:
1. ✓ `DRY_RUN=true` with fresh matches: logs message, skips email, skips state update
2. ✓ `DRY_RUN=true` with zero fresh matches: behaves same as normal run
3. ✓ `DRY_RUN` unset or `'false'`: unchanged behavior
4. ✓ Scraping, matching, and suppression logic are not affected
5. ✓ Exact log format specified
6. ✓ Case-sensitive 'true' matching specified
7. ✓ Location in code specified
