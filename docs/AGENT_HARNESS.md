# Agent Harness

How unattended, isolated Claude Code sessions pick up work on this repo — from a GitHub issue to a merged PR — without a human watching in real time.

## Why this exists

This repo's own commit history is five rounds of bugs that only ever showed up when actually run against live Amazon and live SMTP — a wrong CSS selector, a DOM virtualization race, a flaky first-party API, a DNS library picking a random address, a port/TLS mismatch. None of these were visible from reading the code. That history motivates the two constraints this harness is built around:

1. **Don't burn live Amazon requests carelessly.** Repeated rapid runs during this project's initial debugging appeared to trigger Amazon rate-limiting or throttling — items that had valid prices in one run came back with no price data moments later. A pipeline that iterates by re-running against live Amazon on every change is both slow and actively risks degrading the thing it's testing.
2. **Don't let an unattended agent land something broken with nobody watching.** The whole point of this harness is that no human is in the loop turn-by-turn — so the checks that would normally happen via conversation need to happen structurally instead.

**The one principle everything below follows from: scrutiny scales with risk, not with pipeline position.** A pure-logic change (e.g. the notification-dedup work in issue #1 — pure JSON/date-math, no network) should move through this pipeline fast and cheap: cheap models, no live checks, minimal review overhead. A change touching the scraping/DOM/SMTP code called out in `CLAUDE.md` should get independent plan review, a live spot-check, and a stronger model — every time, without exception. This shows up in three separate places below (which stages get invoked, which model runs them, whether a live Amazon call is authorized) — it's one rule applied three times, not three different rules.

## Risk classification (the thing everything else branches on)

Before any other stage runs, the Analyzer classifies the task as one of:

- **Pure-logic** — touches only application state/config/logic with no DOM parsing or SMTP changes (e.g. the dedup/pruning feature in issue #1).
- **Scraping-touching** — touches `scrapeWishlist()`, its selectors, the scroll/merge/retry logic, or anything in `sendEmail()`'s connection handling.

This classification gates: whether the Plan Validator runs at all, whether the Tester is authorized to spend its one live Amazon check, and whether the PR Risk Analyzer's rubric can even consider the change low-risk (scraping-touching changes are never low-risk, regardless of test coverage — see the rubric below).

## Pipeline stages

The **Orchestrator** is not a subagent — it's the top-level Claude Code session itself, invoked by whatever triggers a pipeline run (a labeled issue, a scheduled Routine, a manual dispatch). It reads the target issue, creates a branch and worktree (`issue-<number>-<slug>`), and spawns the stages below in sequence via the `Agent` tool, handing each one the branch/worktree location plus enough context to work cold — it does not hand-carry findings between stages itself; that's what the git branch is for (see below).

| Stage | Subagent file | Default model | Live Amazon? |
|---|---|---|---|
| Analyzer | `.claude/agents/analyzer.md` | Haiku 4.5 (Orchestrator overrides to Sonnet 5 for anything that might be scraping-touching) | No |
| Planner | `.claude/agents/planner.md` | Sonnet 5 | No |
| Plan Validator | `.claude/agents/plan-validator.md` | Sonnet 5 | No — only invoked when the Analyzer classified the task scraping-touching |
| Implementer | `.claude/agents/implementer.md` | Sonnet 5 | No |
| Tester | `.claude/agents/tester.md` | Sonnet 5 | **At most once**, only when the task is scraping-touching and fixtures alone weren't conclusive |
| PR Risk Analyzer | `.claude/agents/pr-risk-analyzer.md` | Haiku 4.5 | No |
| Deployer | `.claude/agents/deployer.md` | Sonnet 5 | No — opens/updates the PR, does not merge |

Haiku is deliberately used only for the two stages we designed to be *mechanical* rather than open-ended judgment (confirming a well-specified issue is complete; applying a fixed rubric) — the model choice is a consequence of that design decision, not a separate cost optimization layered on top. Planner, Implementer, and Tester never downgrade below Sonnet 5: a cheap model on the Planner in particular tends to cost more overall, since a bad plan poisons every stage that reads it.

**Model overrides happen at the call site, not in the subagent file.** The `Agent` tool's `model` parameter overrides a subagent's frontmatter default for one call — so the Orchestrator, having just seen the Analyzer's risk classification, decides per-invocation whether a stage needs to run hotter than its default.

**A caveat worth being honest about:** tool-list restriction (below) reduces the *surface* for a stage to reach live Amazon or trigger a merge, but a Bash-equipped agent can technically still run arbitrary commands — tool omission is not a hard sandbox. The one genuinely hard guarantee in this design is GitHub branch protection requiring human review before merge (see Deployer, below); everything else here is a strong convention plus PR-level review, not a technical impossibility. Don't oversell this to yourself when extending the harness — say so explicitly if a future addition is a convention rather than an enforced boundary.

## Snapshot/fixture testing (how iteration avoids hitting live Amazon)

The workflow's `SAVE_DEBUG_ARTIFACTS=true` step already produces exactly what's needed here: a full DOM dump (`wishlist-debug.html`) of a real Amazon wishlist page. Puppeteer's `page.setContent(html)` loads a static HTML string into a page with zero network activity, and the same extraction code (`extractCurrentItems`, the selectors, etc.) runs against it identically to how it runs against a live page.

- **Fixture corpus** lives at `test/fixtures/*.html` (does not exist yet — created as part of the infrastructure work in issue #2). Each fixture is a real `wishlist-debug.html` captured from an actual run, committed with a name describing the scenario it covers (e.g. `partial-price-failure.html` for the "10 items missing price" scenario that motivated the reload-retry logic).
- **What fixtures can and can't test.** A static snapshot validates parsing/selector logic against a frozen DOM state. It cannot reproduce Amazon's *live* virtualization behavior (a dynamic client-side race, not a DOM state) — that logic is validated by the fact that it exists for a documented, live-diagnosed reason (see `CLAUDE.md`), not by a fixture pretending to simulate it.
- **Capture-once-replay-forever.** Any time the Tester's one live spot-check produces a new `wishlist-debug.html`, save it as a new fixture regardless of whether the run passed or failed. The corpus should only ever grow; future pipelines need live Amazon less often as a result.
- **Pure-logic changes need zero fixtures and zero live calls.** The dedup/pruning feature in issue #1 is a good example — it's pure JSON + date-math operating on an already-scraped array, fully unit-testable with `node:test` and no browser at all.

## Git as the inter-stage handoff mechanism

Every stage-agent commits its own work to the shared feature branch, with a substantive commit message — not just code changes, but a record of *why*. Concretely:

- Analyzer commits `.agents/analysis.md` (scope confirmation, risk classification, any caveats found).
- Planner commits `.agents/plan.md` (the seams it's introducing, the test table, an explicit checklist mapping each issue acceptance criterion to a test case — see "Planner" below).
- Plan Validator (when invoked) commits `.agents/plan-validation.md`.
- Implementer commits actual code + tests, ideally as separate red/green/refactor commits — the commit history *is* the TDD record, which is the reason to do this in git rather than a scratch file.
- Tester commits any fixes it had to make.
- PR Risk Analyzer doesn't commit to the branch — see its own section below for where its output goes.

**Why git and not a shared context or a state file:** this is the same "no database, commit files" idiom the project already uses for `notified.json` (see issue #1), applied one level up to pipeline coordination instead of app runtime state. It gives a fresh session — one with zero memory of this conversation, picking up hours or days later, or resuming after a crash — a durable, inspectable record: `git log --stat` on the branch shows exactly which stages have completed and what each one found, with no separate state file that could drift out of sync with reality.

**Squash-merge only, no other technique.** A GitHub squash merge captures the branch's *final* tree state as one diff against `main` — it discards all intermediate history in the process. So:

- The Deployer's last action before requesting merge is `git rm -r .agents/` and a commit — this must happen *before* the squash, since squash only cares about the tree state at merge time. Get the ordering wrong and `.agents/` permanently lands in `main`.
- No history rewriting on the branch, ever (no `git commit --amend`, no interactive rebase) — matches this environment's existing git-safety norms. If a later stage finds an earlier stage's work wrong, that's a new commit, not an edit to history.
- The full stage-by-stage trail survives on the branch for as long as the branch exists (visible in the PR's Commits tab), but that's best-effort, not permanent — once the branch is deleted post-merge, those commits are no longer reachable from any ref and could eventually be garbage collected. The one thing guaranteed to survive forever is the **squash commit's message on `main`**, which is why the Deployer's actual job is composing a good PR description (see below) rather than relying on branch history sticking around.

## The Planner (TDD, specifically)

The Planner's job is not "write tests then implement" — that's too vague for a downstream agent with no back-and-forth to execute deterministically. Its actual deliverable, `.agents/plan.md`, has three required parts in order:

1. **Seams.** Which pure functions get extracted, with signatures, before any test is written. You cannot TDD logic that's inlined into an anonymous IIFE with nothing to call independently — naming the seams is what makes the rest of the plan executable.
2. **Test table.** For each seam, concrete input → expected output pairs, including boundary cases (an entry exactly at a time threshold, malformed input, an empty collection) — not vague descriptions of what should be tested.
3. **Coverage checklist.** Every acceptance criterion in the source issue mapped to at least one test case in the table above, plus an explicit list of what the plan does *not* touch, checked against the issue's stated non-goals. This is the Planner's own self-check, required on every plan regardless of risk level (see Plan Validator below for when a second, independent check also happens).

## Plan Validator

Only invoked when the Analyzer classified the task as scraping-touching. The case for a *separate* agent here rather than folding this into the Planner's own self-check is objectivity: the same reasoning that produced a flawed plan is often blind to that exact flaw on a re-read, which is why code review is a different person rather than the same author reading their own diff again. Running this on every trivial change would be flat overhead with little payoff, since most of what it checks (does every acceptance criterion map to a test case, does the plan stay inside the issue's non-goals) is a mechanical cross-reference — so it's gated to the one class of task where this project's actual bug history says the stakes are highest.

## PR Risk Analyzer

Runs after the Tester, before the Deployer. **Determines and logs a risk level. Does not act on it — no auto-merge, no label-based merge trigger, nothing that touches merge state.** This is intentionally a dry run: the goal is to build a track record (how often would the low-risk calls have actually held up, with no follow-up fixes needed) before ever considering flipping on real auto-merge for real.

The determination is a fixed rubric, not a subjective call — that's what makes Haiku sufficient for this stage:

**HIGH RISK if any of:**
- Touches the load-bearing scraping/SMTP code called out in `CLAUDE.md`
- Touches workflow YAML permissions, secrets, or the state-file commit/push step
- Adds or changes a dependency
- Diff is large (>100 lines or >3 files)
- No test coverage for what changed, or — for scraping-touching changes specifically — no fixture added/updated

**LOW RISK requires all of:** pure-logic change only, small focused diff, adequate test coverage, all required checks green, no dependency/permission/secret changes.

Two output artifacts, both reusing patterns already established in this repo rather than inventing new infrastructure:

1. A **PR comment** stating the risk level and which rubric items fired — human-visible immediately, so a reviewer can sanity-check the call before merging.
2. An append to **`.github/pr-risk-log.jsonl`** (one line per PR: `{pr, sha, risk, reasons, checks_passed, timestamp}`) — same "commit a small file back to the repo" idiom as `notified.json`. This is the evidence base for eventually deciding auto-merge is trustworthy.

## Deployer

Composes the PR description — synthesized from `.agents/*.md` and the individual stage commit messages, not a dump of their raw content — then does the pre-squash `.agents/` cleanup described above. **Opens or updates the PR and stops.** A human clicks merge.

This is a "for now," not a permanent stance: the project's author is generally open to real auto-merge once the PR Risk Analyzer's track record (from `.github/pr-risk-log.jsonl`) earns that trust. Until then, the actual enforcement mechanism should be **GitHub branch protection requiring human review before merge** — not merely "the Deployer wasn't given a merge tool." Tool-list omission is a convention easily defeated by a Bash-equipped agent finding another way to call the GitHub API; branch protection is enforced by GitHub itself regardless of what any step tries. Wiring up that branch protection is tracked in issue #2, alongside the CI workflow it depends on.

## Cost levers beyond model choice

- **`effort` parameter** — same model, tunable reasoning depth. Cheap stages can also run at `effort: low` even on Sonnet, compounding with model choice.
- **Prompt caching** — every stage re-reads the same issue text and this doc. Structuring that as a cached prefix (stable content first, volatile content — the specific task — last) cuts repeat-read cost to roughly a tenth of full price across a single pipeline run's six-plus stages.

## Explicit non-goals

- No price-drop override or other scope creep on the dedup feature (see issue #1's own non-goals — this harness doesn't relitigate them).
- No database, no external service, no GitHub Actions cache/artifacts for pipeline state — git commits only, per "Git as the inter-stage handoff mechanism" above.
- No auto-merge until the PR Risk Analyzer has an actual track record to point to.
- No recursive delegation — subagents in this pipeline don't spawn further subagents; only the Orchestrator (the top-level session) calls `Agent`.

## Open questions (tracked in issue #2, not resolved here)

- Whether the pipeline runs as one long Claude Code session with `Agent`-tool subagent calls in-process, or as discrete GitHub Actions jobs/steps each invoking Claude Code fresh — affects how strictly the "only Tester gets live Amazon / GH Actions trigger access" rule can be enforced via token/permission scoping rather than just prompt convention.
- Exact CI wiring for the required `npm test` status check — blocked on issue #1 landing first, since there's no test suite or `npm test` script in this repo yet.
