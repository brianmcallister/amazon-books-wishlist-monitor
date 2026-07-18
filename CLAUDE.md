# amazon-books-wishlist-monitor

A daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under a price threshold, and emails a digest. See `README.md` for user-facing setup and secrets.

## Load-bearing code — do not touch casually

Every item below was a live-debugged bug fix, not a stylistic choice. Changing any of them without re-validating against live Amazon/SMTP risks silently reintroducing a bug that already cost a full debugging cycle to find:

- **Item container selector is `[id^="item_"]`, not `[data-itemid]`** — that attribute doesn't exist anywhere on the page.
- **Items are scraped by merging results across every scroll step**, not read once at the end. Amazon virtualizes the wishlist — an item's price element can be unmounted once it scrolls out of view — so a single end-of-scroll read is a race.
- **A page reload-and-retry** runs if any item is still missing a price after the full scroll+merge pass. Amazon's own client-side price-fetch API sometimes fails outright for a subset of items; a reload re-issues the failed call.
- **SMTP connects to a pre-resolved IPv4 address, not the hostname.** nodemailer's own DNS resolution code picks a *random* address between the IPv4/IPv6 results it resolves — it does not respect Node's `dns.setDefaultResultOrder`. GitHub Actions runners frequently can't route IPv6 to Google's mail servers.
- **`SAVE_DEBUG_ARTIFACTS=true`** in the workflow writes a full-page screenshot and DOM dump on every run. This is how the four bugs above were actually diagnosed — don't remove it.

Full history and reasoning for each: `git log check-wishlist.js`.

## Multi-agent pipeline

Feature work on this repo is meant to move through a staged agent pipeline (Analyzer → Planner → [Plan Validator] → Implementer → Tester → Deployer → PR Risk Analyzer), not a single freeform session. PR Risk Analyzer is a deterministic script (`scripts/pr-risk-check.js`), not a model call — it runs last, after Deployer, because it needs a real PR number to comment on. Full design: `docs/AGENT_HARNESS.md`. Two rules that apply regardless of which stage you're running as:

1. **Don't hit live Amazon unless you are the Tester stage — and even then, at most once per pipeline run.** Use the HTML fixtures in `test/fixtures/` for everything else. Amazon's own price-fetch API appears to throttle repeated automated requests in a short window; several runs fired within minutes of each other during this project's initial debugging saw items lose price data that had been present moments earlier.
2. **Don't auto-merge.** Open or update the PR and stop — a human merges. See `docs/AGENT_HARNESS.md` for why this is a "for now," not a permanent rule.
