# Fixtures

Each file here is a real `wishlist-debug.html` DOM dump captured by `check-wishlist.js`
(`SAVE_DEBUG_ARTIFACTS=true`, see `.github/workflows/check-wishlist.yml`), pulled from a past
workflow run's artifact rather than hand-written. Tests parse these offline instead of hitting
live Amazon, per `docs/AGENT_HARNESS.md`'s "don't hammer live Amazon" rule and the pipeline's
Implementer stage having no live network access at all.

- `wishlist-happy-path.html` — a clean run: every item's price parsed on the first pass.
- `wishlist-partial-price-failures.html` — captured from a run before the scroll-merge and
  reload-retry fixes landed (see `CLAUDE.md`'s load-bearing fixes list, items 2 and 3);
  Amazon's client-side price API failed for a subset of items, leaving their `itemPrice_`
  elements present but empty. Exists to catch a regression on that exact bug class.

## Adding a new fixture

Only add a fixture from a live Amazon check that already happened for another reason (a
manual debugging run, or the pipeline's approval-gated live-check job — see
`docs/AGENT_HARNESS.md`). Never trigger a live run just to seed a fixture; pull the
`wishlist-debug` artifact from a run that already exists. Name the file for the scenario it
covers, not the run it came from, and add a line to the list above explaining what it's for.
