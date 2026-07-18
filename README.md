# amazon-books-wishlist-monitor

Checks a public Amazon wish list daily for books under a price threshold and
emails a digest. Read-only detection only — it does not purchase anything.

## How it works

`check-wishlist.js` launches headless Chrome (Puppeteer), loads the wish
list, scrolls to force lazy-loaded items in, and parses each item's title
and price directly from the page. Amazon's own on-page sort order isn't
trusted (it appears to promote some items out of price order), so the
script parses every item's price itself and sorts/filters in code.

If one or more items are under `PRICE_THRESHOLD`, it emails a digest via
SMTP. If nothing qualifies, no email is sent (to avoid daily noise) — check
the Action's run log to confirm it actually ran.

## Setup

### Required repo secrets

Settings → Secrets and variables → Actions → Secrets:

- `SMTP_HOST` — e.g. `smtp.gmail.com`
- `SMTP_PORT` — e.g. `587`
- `SMTP_SECURE` — `true` for port 465, `false` for 587/STARTTLS
- `SMTP_USER` — mailbox username
- `SMTP_PASS` — app-specific password (not your regular account password)

### Optional repo variables

Settings → Secrets and variables → Actions → Variables:

- `WISHLIST_URL` — defaults to the wish list hardcoded in the script
- `PRICE_THRESHOLD` — defaults to `5`
- `EMAIL_TO` — defaults to `brian@brianmcallister.com`
- `EMAIL_FROM` — defaults to `SMTP_USER`

### Testing

Run the workflow manually first via Actions → Check Amazon Wishlist → Run
workflow, rather than waiting for the daily schedule. Check the run log —
it prints the item count scanned and how many matched, even when no email
is sent.

## Known risks

- **Bot detection.** A real headless browser reads the public wish list
  cleanly today, but Amazon can start challenging automated requests at
  any time (CAPTCHA, blocked IP ranges), especially on a predictable daily
  schedule from GitHub's runner IPs. If runs start failing consistently,
  this is the likely cause — there's no built-in retry/backoff for it yet.
- **Selector drift.** The parsing selectors are based on Amazon's current
  wish list markup. If Amazon changes their page structure, the script may
  return zero items or fail outright rather than silently returning wrong
  data — but verify a real run's output against the actual list, especially
  the first few times.
- **Terms of Service.** Automated access to Amazon is against their
  Conditions of Use. This is a personal, low-volume, read-only monitor —
  worth knowing the risk is there even so (e.g. account flags).
