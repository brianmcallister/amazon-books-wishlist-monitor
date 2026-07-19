# Changelog

## 2026-07-19

- Add an opt-in `DRY_RUN=true` mode that runs the full scrape/match/suppression pipeline and logs what would happen, without sending email or mutating the committed `notified.json` state. ([#14](https://github.com/brianmcallister/amazon-books-wishlist-monitor/issues/14))

## 2026-07-18

- Initial release: a daily GitHub Actions cron scrapes a public Amazon wish list with headless Chrome, filters books under a configurable price threshold, and emails a digest.
- Suppress repeat email notifications for the same book within a 14-day window, tracked via a `notified.json` state file (keyed by ASIN) committed back to the repo. ([#1](https://github.com/brianmcallister/amazon-books-wishlist-monitor/issues/1))
