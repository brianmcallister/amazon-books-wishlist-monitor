# Changelog

## 2026-07-19 — DRY_RUN mode
- Added an opt-in `DRY_RUN=true` environment variable so a run can exercise the full scrape, match, and suppression pipeline and log what would happen — without sending email or mutating the committed `notified.json` state. (#14, PR #15)

## 2026-07-18 — Notification suppression
- Added a 14-day suppression window so the same under-threshold book isn't emailed again every day it stays under `PRICE_THRESHOLD` — once a book has been emailed, it's suppressed for at least 14 days. (#1, PR #9)

## 2026-07-18 — Initial release
- Daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under `PRICE_THRESHOLD`, and emails a digest of matches.
