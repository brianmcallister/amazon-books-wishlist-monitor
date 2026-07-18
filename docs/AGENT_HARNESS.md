# Agent Harness

How unattended, isolated Claude Code sessions pick up work on this repo — from a GitHub issue to a merged PR — without a human watching in real time.

## Why this exists

This repo's own commit history is five rounds of bugs that only ever showed up when actually run against live Amazon and live SMTP — a wrong CSS selector, a DOM virtualization race, a flaky first-party API, a DNS library picking a random address, a port/TLS mismatch. None of these were visible from reading the code. That history motivates the two constraints this harness is built around:

1. **Don't burn live Amazon requests carelessly.** Repeated rapid runs during this project's initial debugging appeared to trigger Amazon rate-limiting or throttling — items that had valid prices in one run came back with no price data moments later. A pipeline that iterates by re-running against live Amazon on every change is both slow and actively risks degrading the thing it's testing.
2. **Don't let an unattended agent land something broken with nobody watching.** The whole point of this harness is that no human is in the loop turn-by-turn — so the checks that would normally happen via conversation need to happen structurally instead.

**The one principle everything below follows from: scrutiny scales with risk, not with pipeline position.** A pure-logic change (e.g. the notification-dedup work in issue #1 — pure JSON/date-math, no network) should move through this pipeline fast and cheap: cheap models, no live checks, minimal review overhead. A change touching the scraping/DOM/SMTP code called out in `CLAUDE.md` should get independent plan review, a live spot-check, and a stronger model — every time, without exception. This shows up in three separate places below (which stages get invoked, which model runs them, whether a live Amazon call is authorized) — it's one rule applied three times, not three different rules.

## Where brainstorming ends and this pipeline begins

**Brainstorming — turning a rough idea into a well-specified issue — is not part of this pipeline. It's synchronous, interactive work that happens before the pipeline is ever triggered**, the same way issues #1 through #3 in this repo were written: a human working with Claude Code in conversation, refining a rough idea through questions until it's specific enough to hand off. Everything from here on — Analyzer through Deployer — assumes that work is already done and runs unattended, via GitHub Actions, starting from an issue number. The Analyzer's job is to *confirm* the issue is complete, not to *make* it complete; if it isn't, the pipeline stops and asks, it doesn't try to brainstorm on its own.

## Where this builds on [Superpowers](https://github.com/obra/superpowers) instead of reinventing it

[obra/superpowers](https://github.com/obra/superpowers) is a cross-platform, installable Claude Code skills plugin implementing a similar-in-spirit chain — brainstorming → git worktrees → planning → subagent-per-task development with two-stage review → TDD → code review → branch finishing. Two independent designs landing on the same shape is a good sign the shape is right, and there's no reason to hand-roll what it already does well:

- **Planning** should use Superpowers' `writing-plans` skill for the actual task-breakdown mechanics (bite-sized tasks, exact file paths, verification steps), rather than us maintaining a competing format. Our own addition on top — the coverage checklist mapping every plan item back to the source issue's acceptance criteria — stays ours, because it's specific to this pipeline being issue-driven, which a general planning skill has no way to know about. One override: the skill's own default save location (`docs/superpowers/plans/YYYY-MM-DD-<name>.md`) is ignored — this pipeline's plan always lands at `.agents/plan.md`, since every other stage and the Deployer's pre-squash cleanup depend on that exact path.
- **TDD execution** should invoke Superpowers' `test-driven-development` skill directly for RED-GREEN-REFACTOR, rather than `implementer.md` re-explaining the same philosophy in different words.
- **Review** should invoke Superpowers' `requesting-code-review` / `receiving-code-review` skills for the two-stage per-task review, rather than us defining a competing severity rubric.
- **Implementation moves from one Implementer-per-feature to a fresh subagent per task**, matching the *pattern* Superpowers' `subagent-driven-development` skill validates — fresh subagent per task, two-stage review — with a two-stage review (spec compliance, then code quality) after each task before the next one starts — see "The Implementer," below. This is a real improvement over the single-pass Implementer this doc originally described, not just a naming change. **We do not use that skill's own dispatch mechanism** (it's a bash-script-driven controller pattern — task briefs and review packages as files, invoked via shell commands — built for a human or script shelling out locally). Our dispatch is the Orchestrator's own use of the `Agent` tool, one call per task, with git commits as the handoff (see "Git as the inter-stage handoff mechanism," below) — mechanically different, same shape, and the one that actually fits running unattended inside a GitHub Actions job.
- **Branch finishing gets a real choice**, not an assumed default: merge (not available yet — see the auto-merge non-goal), open a PR, keep the branch without a PR, or discard — see "Deployer," below.

**What stays ours, deliberately, because it's either specific to this project or Superpowers' README doesn't cover it at all:** the risk-scaled *conditional* invocation of stages (Superpowers' gates read as uniform, always-on; ours skip stages entirely for low-stakes work), model and cost tuning per stage (no mention of this in Superpowers), the single-live-external-API-hit-per-run constraint (specific to this project's actual Amazon-throttling history), the GitHub-Actions-native unattended trigger/resume mechanics below (Superpowers reads as built for a human answering questions in real time, not a red/green Actions run resumed via issue comments hours later), and the PR Risk Analyzer's shadow-mode auto-merge track record.

**No separate whole-diff code-review stage was added, on purpose.** It might look like a gap next to Superpowers' dedicated code-review step, but the two-stage per-task review (below) already covers code quality at the point where it's cheapest to fix, Plan Validator already covers plan-level soundness before any code exists, and PR Risk Analyzer already does a final holistic pass for merge-risk purposes. A fourth review layer on top of those three would be redundant, not additive.

### Installing Superpowers (verified against the real repo, not assumed)

`obra/superpowers` is itself a self-contained Claude Code plugin — its repo root carries `.claude-plugin/plugin.json` directly (currently pinned at tag `v6.1.1`), not just a skills folder needing a wrapper. That means two different install paths make sense for the two different ways this repo runs Claude Code, and neither is a guess:

- **Interactive/human sessions** (someone with this repo open locally, or an Orchestrator session with no special CLI flags): this repo's `.claude/settings.json` declares Superpowers' marketplace under `extraKnownMarketplaces` (the documented "team marketplaces" mechanism — see Claude Code's plugin docs). Opening this repo in a trusted Claude Code session prompts to install it from there; a human confirms once.
- **The CI pipeline** (`agent-pipeline.yml`, issue #3): marketplace-based install depends on an interactive trust prompt that doesn't exist in an unattended job. The Claude Code Action turns out to have first-class inputs for exactly this, so `agent-pipeline.yml` uses those directly rather than a CLI flag threaded through `claude_args`: `plugin_marketplaces: https://github.com/obra/superpowers-marketplace.git` and `plugins: superpowers@superpowers-marketplace` on every `anthropics/claude-code-action@v1` step in that workflow. No marketplace registration step, no trust prompt — the action adds the marketplace and installs the plugin before running Claude, every time, deterministically.

## Risk classification (the thing everything else branches on)

Before any other stage runs, the Analyzer classifies the task as one of:

- **Pure-logic** — touches only application state/config/logic with no DOM parsing or SMTP changes (e.g. the dedup/pruning feature in issue #1).
- **Scraping-touching** — touches `scrapeWishlist()`, its selectors, the scroll/merge/retry logic, or anything in `sendEmail()`'s connection handling.

This classification gates: whether the Plan Validator runs at all, whether the Tester is authorized to spend its one live Amazon check, and whether the PR Risk Analyzer's rubric can even consider the change low-risk (scraping-touching changes are never low-risk, regardless of test coverage — see the rubric below).

## How this actually runs

**One workflow file, `.github/workflows/agent-pipeline.yml`, triggered exclusively via the Actions tab's "Run workflow" button — `workflow_dispatch` with a single input, `issue_number`.** No label triggers, no `issue_comment` triggers, no second workflow watching for anything. Both starting a fresh pipeline run and resuming one that stopped go through the exact same form, with the exact same one field.

- `run-name: "Pipeline: issue #${{ inputs.issue_number }}"` so parallel runs for different issues are distinguishable at a glance in the Actions list, rather than a generic name you have to click into to identify.
- `concurrency: { group: pipeline-${{ inputs.issue_number }} }` so accidentally clicking Run twice on the same issue queues the second attempt instead of two runs racing on the same branch.

**One job runs one Claude Code invocation, which acts as the Orchestrator** — it is not itself a subagent file, it's the top-level session for that run, and it uses the `Agent` tool in-process to invoke each stage subagent (`.claude/agents/*.md`) in sequence. This is the piece that replaced two earlier, more complex designs (a single multi-job DAG file with per-job permission scoping, then seven independently-triggerable workflow files) — both gave up real usability (parallel-run visibility, a single obvious "restart" action) for boundary guarantees this project's actual risk profile doesn't need. The one place a hard, GitHub-enforced boundary still matters — the live Amazon check — gets one, described below, without paying that cost everywhere else.

### Fresh start vs. resume — decided by the Orchestrator, not by you

Every run starts identically: you fill in `issue_number` and click Run. What happens next depends on repo state, not on anything you chose in the form:

1. Resolve the branch name from the issue number (`issue-<N>-...`).
2. **Branch doesn't exist** → fresh start. Create it from `main`, begin at the Analyzer stage.
3. **Branch exists** → resume. Check out the branch and read two things:
   - Which `.agents/*.md` files are already committed, which tells the Orchestrator which stages already finished.
   - The issue's comment thread: find the most recent comment *it* posted (always carrying a recognizable marker so it can find its own last checkpoint), then read anything posted after that as this run's guidance.
4. If there's no new comment since its last checkpoint, there's nothing to fold in — it just retries whatever stage stopped, plain, no correction. If you did reply, that reply is the correction for this run.

**This is the entire input mechanism.** There's no separate "guidance" field on the dispatch form — guidance lives in the issue thread. The Actions button is the "go" signal; the comment thread is the "how" signal. When something stops the pipeline (a stage needs clarification, a downstream stage rejects an upstream one, the live-check approval is pending), the Orchestrator posts a comment on the issue (or the PR, once Deployer has opened one) explaining what happened and what it needs — then the job ends. You reply on that thread, go back to the Actions tab, run the same workflow with the same issue number. Repeat until it completes.

**Whether the job is green or red is the signal for whether it needs you.** Full completion (PR opened, or an update pushed to an existing one) is success. Stopping early for *any* reason — needs clarification, a stage rejected another stage's work, waiting on the live-check approval below — is a failed run. Red in the Actions tab always means "go read the issue," never "something is silently fine."

### The one hard boundary: live Amazon requires human approval, enforced by GitHub

Everything above runs in one job, which means the usual "give this stage a narrower token" trick isn't available — GitHub Actions job/step permission scoping needs a job boundary, and there mostly isn't one here. For most of the pipeline that's an acceptable trade (see "A caveat worth being honest about," below). For live Amazon specifically it isn't, so it gets its own real mechanism instead of a prompt-level rule: a second job.

- The main job runs the Orchestrator through the Tester stage. If the Tester decides — per the risk classification and the fixture corpus being insufficient — that a live check is genuinely warranted, it says so (a job output) and stops, without touching live Amazon itself.
- A second job, gated with `environment: live-amazon-check` (a GitHub Environment configured with required reviewers), only runs `if:` that output says a live check is needed. GitHub itself pauses this job and shows a "Review deployments" approval prompt — a real, GitHub-enforced checkpoint, not a convention — before anything in it executes.
- Once approved, that job triggers `check-wishlist.yml` via `workflow_dispatch`, waits for it, and pulls the resulting `wishlist-debug.html` into `test/fixtures/` as a new fixture regardless of pass/fail — then continues the remaining stages (PR Risk Analyzer, Deployer) itself. It can do this cleanly because it checks out the same branch, which already has everything the earlier stages committed — the same git-based resumability that lets a human resume from the Actions tab is what lets this second job pick up mid-pipeline automatically once approved.
- This still respects "at most once per pipeline run": the Tester only sets that output once, and only when it's actually warranted, not as a default.

### A caveat worth being honest about

Tool-list restriction on the subagents reduces the *surface* for a stage to reach live Amazon or attempt a merge, but a Bash-equipped agent can technically still run arbitrary commands within its own job — tool omission is not a hard sandbox. The two genuinely hard guarantees in this design are the environment-gated approval above (for live Amazon) and GitHub branch protection requiring human review before merge (for Deployer, below). Everything else here is a strong convention plus PR-level review, not a technical impossibility. Don't oversell this to yourself when extending the harness — say so explicitly if a future addition is a convention rather than an enforced boundary.

## Pipeline stages

| Stage | Subagent file | Default model | Live Amazon? |
|---|---|---|---|
| Orchestrator | not a subagent file — the top-level session `agent-pipeline.yml` invokes directly | Sonnet 5 | No — routes and dispatches only |
| Analyzer | `.claude/agents/analyzer.md` | Haiku 4.5 (Orchestrator overrides to Sonnet 5 for anything that might be scraping-touching) | No |
| Planner | `.claude/agents/planner.md` | Sonnet 5 | No |
| Plan Validator | `.claude/agents/plan-validator.md` | Sonnet 5 | No — only invoked when the Analyzer classified the task scraping-touching |
| Implementer | `.claude/agents/implementer.md` | Sonnet 5 | No — dispatched fresh, once per task in the plan, not once for the whole feature |
| Tester | `.claude/agents/tester.md` | Sonnet 5 | Decides *whether* a live check is warranted; does not perform it itself — see the approval-gated job above |
| PR Risk Analyzer | `.claude/agents/pr-risk-analyzer.md` | Haiku 4.5 | No |
| Deployer | `.claude/agents/deployer.md` | Sonnet 5 | No — opens/updates the PR, does not merge |

Haiku is deliberately used only for the two stages we designed to be *mechanical* rather than open-ended judgment (confirming a well-specified issue is complete; applying a fixed rubric) — the model choice is a consequence of that design decision, not a separate cost optimization layered on top. Planner, Implementer, and Tester never downgrade below Sonnet 5: a cheap model on the Planner in particular tends to cost more overall, since a bad plan poisons every stage that reads it.

**Model overrides happen at the call site, not in the subagent file.** The `Agent` tool's `model` parameter overrides a subagent's frontmatter default for one call — so the Orchestrator, having just seen the Analyzer's risk classification, decides per-invocation whether a stage needs to run hotter than its default.

## Failure handling

Different failure modes get different responses — treating them all the same either under-reacts (silently plowing through a real problem) or over-reacts (building retry infrastructure for things that already have a retry mechanism underneath them).

1. **Infra-level crash** (API error, runner blip, timeout) — no custom logic. The Anthropic SDK already retries transient errors automatically, and above that, re-running the same workflow with the same issue number (see "Fresh start vs. resume" above) picks up exactly where it left off via git. No separate retry system needed.
2. **A stage can self-correct within its own scope** (the Tester finding and fixing an obvious bug is one example; a per-task Implementer subagent addressing its own two-stage review findings is another) — bounded to **one attempt**, then stop. Scoping this to a single task rather than the whole feature is one of the benefits of the fresh-subagent-per-task model — a stage that keeps trying increasingly speculative fixes across many iterations is a real cost and correctness risk inside a single run, and a smaller unit of work makes "did the one fix actually hold" a much easier question to answer cleanly. If the fix doesn't hold, that's a signal to surface, not to keep guessing at.
3. **A downstream stage rejects an upstream stage's work in a way it can't fix itself** (Plan Validator rejects the plan outright; Tester finds something fundamentally broken, not a one-line fix) — **does not auto-loop back to re-run the earlier stage.** This is deliberate: a downstream stage disagreeing with an upstream one is itself a risk signal, and this harness is built around escalating risk signals to a human rather than having agents resolve disagreements among themselves. The job stops with a comment explaining the disagreement; a human decides how to proceed (re-run with guidance, fix the branch by hand, or restart from an earlier stage).
4. **The live-check job itself fails** (the triggered `check-wishlist.yml` run errors out, or comes back with a result that doesn't resolve the question the Tester needed answered) — this is a terminal result to report, not a reason to trigger the live check again. "At most once" means once even when that one attempt comes back bad.
5. **A stage needs human clarification** (the Analyzer's core job) — stops rather than guessing, with the specific gap in both its `.agents/analysis.md` commit and the issue comment.

## Snapshot/fixture testing (how iteration avoids hitting live Amazon)

The workflow's `SAVE_DEBUG_ARTIFACTS=true` step already produces exactly what's needed here: a full DOM dump (`wishlist-debug.html`) of a real Amazon wishlist page. Puppeteer's `page.setContent(html)` loads a static HTML string into a page with zero network activity, and the same extraction code (`extractCurrentItems`, the selectors, etc.) runs against it identically to how it runs against a live page.

- **Fixture corpus** lives at `test/fixtures/*.html` (does not exist yet — created as part of the infrastructure work in issue #2). Each fixture is a real `wishlist-debug.html` captured from an actual run, committed with a name describing the scenario it covers (e.g. `partial-price-failure.html` for the "10 items missing price" scenario that motivated the reload-retry logic).
- **What fixtures can and can't test.** A static snapshot validates parsing/selector logic against a frozen DOM state. It cannot reproduce Amazon's *live* virtualization behavior (a dynamic client-side race, not a DOM state) — that logic is validated by the fact that it exists for a documented, live-diagnosed reason (see `CLAUDE.md`), not by a fixture pretending to simulate it.
- **Capture-once-replay-forever.** Any time the approval-gated live check produces a new `wishlist-debug.html`, it's saved as a new fixture regardless of whether the run passed or failed. The corpus should only ever grow; future pipelines need live Amazon less often as a result.
- **Pure-logic changes need zero fixtures and zero live calls.** The dedup/pruning feature in issue #1 is a good example — it's pure JSON + date-math operating on an already-scraped array, fully unit-testable with `node:test` and no browser at all.

## Git as the inter-stage handoff mechanism

Every stage-agent commits its own work to the shared feature branch, with a substantive commit message — not just code changes, but a record of *why*. Concretely:

- Analyzer commits `.agents/analysis.md` (scope confirmation, risk classification, any caveats found).
- Planner commits `.agents/plan.md` (the seams it's introducing, the test table, an explicit checklist mapping each issue acceptance criterion to a test case — see "The Planner" below).
- Plan Validator (when invoked) commits `.agents/plan-validation.md`.
- Each per-task Implementer subagent commits its own code + tests as separate red/green/refactor commits — the commit history *is* the TDD record, which is the reason to do this in git rather than a scratch file. Across a multi-task plan, the branch ends up with one red/green/refactor cluster per task, in order, which is itself a readable trace of how the feature was actually built.
- Tester commits any fixes it had to make.
- PR Risk Analyzer doesn't commit to the branch — see its own section below for where its output goes.

**Why git and not a shared context or a state file:** this is the same "no database, commit files" idiom the project already uses for `notified.json` (see issue #1), applied one level up to pipeline coordination instead of app runtime state. It gives a fresh session — one with zero memory of this conversation, picking up hours or days later, resuming after a crash, or resuming automatically inside the approval-gated live-check job — a durable, inspectable record: `git log --stat` on the branch shows exactly which stages have completed and what each one found, with no separate state file that could drift out of sync with reality.

**Squash-merge only, no other technique.** A GitHub squash merge captures the branch's *final* tree state as one diff against `main` — it discards all intermediate history in the process. So:

- The Deployer's last action before requesting merge is `git rm -r .agents/` and a commit — this must happen *before* the squash, since squash only cares about the tree state at merge time. Get the ordering wrong and `.agents/` permanently lands in `main`.
- No history rewriting on the branch, ever (no `git commit --amend`, no interactive rebase) — matches this environment's existing git-safety norms. If a later stage finds an earlier stage's work wrong, that's a new commit, not an edit to history.
- The full stage-by-stage trail survives on the branch for as long as the branch exists (visible in the PR's Commits tab), but that's best-effort, not permanent — once the branch is deleted post-merge, those commits are no longer reachable from any ref and could eventually be garbage collected. The one thing guaranteed to survive forever is the **squash commit's message on `main`**, which is why the Deployer's actual job is composing a good PR description (see below) rather than relying on branch history sticking around.

## The Planner (TDD, specifically)

The Planner's job is not "write tests then implement" — that's too vague for a downstream agent with no back-and-forth to execute deterministically. It uses Superpowers' plan-writing skill for the actual task breakdown — bite-sized tasks (a few minutes of work each), exact file paths, verification steps — rather than us maintaining a competing format for something a general-purpose skill already does well. On top of that mechanic, its deliverable `.agents/plan.md` has two things that are specific to this pipeline being issue-driven, which a general skill has no way to know to include:

1. **Seams.** Which pure functions get extracted, with signatures, before any test is written — named explicitly enough that each task in the breakdown can be handed to a fresh subagent with no further context from the Planner.
2. **Coverage checklist.** Every acceptance criterion in the source issue mapped to at least one task/test in the breakdown above, plus an explicit list of what the plan does *not* touch, checked against the issue's stated non-goals. This is the Planner's own self-check, required on every plan regardless of risk level (see Plan Validator below for when a second, independent check also happens).

## Plan Validator

Only invoked when the Analyzer classified the task as scraping-touching. The case for a *separate* agent here rather than folding this into the Planner's own self-check is objectivity: the same reasoning that produced a flawed plan is often blind to that exact flaw on a re-read, which is why code review is a different person rather than the same author reading their own diff again. Running this on every trivial change would be flat overhead with little payoff, since most of what it checks (does every acceptance criterion map to a task, does the plan stay inside the issue's non-goals) is a mechanical cross-reference — so it's gated to the one class of task where this project's actual bug history says the stakes are highest.

## The Implementer (fresh subagent per task)

The Orchestrator dispatches a **new Implementer subagent for each task** in the Planner's breakdown — not one subagent working through the whole plan. Each one:

1. Gets just its one task, plus the plan and analysis files for context.
2. Implements it using Superpowers' TDD skill: failing test, minimal code, passing test, commit — as separate commits, per the git-handoff section above.
3. Is reviewed **two ways before the next task's subagent is dispatched**: spec compliance (does this task actually do what the plan said) and code quality (using Superpowers' code-review skill, or this environment's `/code-review` skill). A critical finding from either blocks moving to the next task.
4. Gets **one bounded self-fix attempt** against review findings, per the failure-handling rule above — not an open-ended back-and-forth with the reviewer.

This is a meaningfully more thorough process than a single Implementer working through an entire multi-task plan in one pass — each increment is verified before the next one is built on top of it, and a review finding is caught (and cheap to fix) at the size of one task rather than surfacing later as a tangle across the whole diff. It costs more invocations than the single-pass model this doc originally described, which is a reasonable trade for scraping-touching work specifically; for small pure-logic plans with only one or two tasks, the practical difference from a single-pass Implementer is minor.

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
2. An append to **`.github/pr-risk-log.jsonl`** (one line per PR: `{pr, sha, risk, reasons, checks_passed, timestamp}`) — same "commit a small file back to the repo" idiom as `notified.json`. This is the evidence base for eventually deciding auto-merge is trustworthy. The file exists (currently empty, ready to append to) as of issue #2.

## Deployer

Composes the PR description — synthesized from `.agents/*.md` and the individual stage commit messages, not a dump of their raw content — then does the pre-squash `.agents/` cleanup described above. Rather than always defaulting to "open a PR," it picks from the same real choice Superpowers' branch-finishing step offers:

**The PR description includes a `Closes #N` line for the issue this run was dispatched for**, so merging the PR auto-closes the issue — no separate manual close step, no issue silently sitting open after its PR lands. This only applies when the run's diff actually closes out the issue's full scope; a partial pass (see issue #2's own history, split across two PRs by design) uses plain issue-referencing text instead of the auto-close keyword, since auto-closing an issue that still has real remaining scope would be actively misleading.

- **Open (or update) a PR** — the default outcome for anything the PR Risk Analyzer didn't flag as needing a human look first.
- **Keep the branch, no PR yet** — for a run where the pipeline completed but isn't confident enough to ask for review (e.g. the PR Risk Analyzer's determination was HIGH RISK and the Deployer judges a raw PR description isn't enough context for a good review) — the branch and its full `.agents/*.md` trail (pre-cleanup, in this case — no PR means no squash yet, so there's nothing to lose by leaving them) sit there for a human to look at directly.
- **Discard** — if something upstream made clear the whole task should be abandoned, rather than leaving a stale branch around indefinitely.
- **Merge is not an available choice right now** — see the non-goals below. This is a "for now," not a permanent stance: the project's author is generally open to real auto-merge once the PR Risk Analyzer's track record (from `.github/pr-risk-log.jsonl`) earns that trust.

**Opens/updates/keeps/discards, and stops.** A human clicks merge. Until real auto-merge is trusted, the actual enforcement mechanism should be **GitHub branch protection requiring human review before merge** — not merely "the Deployer wasn't given a merge tool." Tool-list omission is a convention easily defeated by a Bash-equipped agent finding another way to call the GitHub API; branch protection is enforced by GitHub itself regardless of what any step tries. Wiring up that branch protection is tracked in issue #2, alongside the CI workflow it depends on.

## Cost levers beyond model choice

- **`effort` parameter** — same model, tunable reasoning depth. Cheap stages can also run at `effort: low` even on Sonnet, compounding with model choice.
- **Prompt caching** — every stage re-reads the same issue text and this doc. Structuring that as a cached prefix (stable content first, volatile content — the specific task — last) cuts repeat-read cost to roughly a tenth of full price across a single pipeline run's six-plus stages.

## Explicit non-goals

- No price-drop override or other scope creep on the dedup feature (see issue #1's own non-goals — this harness doesn't relitigate them).
- No database, no external service, no GitHub Actions cache/artifacts for pipeline state — git commits only, per "Git as the inter-stage handoff mechanism" above.
- No auto-merge until the PR Risk Analyzer has an actual track record to point to.
- No recursive delegation — subagents in this pipeline don't spawn further subagents; only the Orchestrator (the top-level session) calls `Agent`.
- No trigger mechanism beyond the Actions-tab `workflow_dispatch` form — no issue labels, no `issue_comment` webhook workflow. One button, one field, every time.

## Open questions (tracked in follow-up issues, not resolved here)

- Exact CI wiring for the required `npm test` status check, plus branch protection requiring it — blocked on issue #1 landing first, since there's no test suite or `npm test` script in this repo yet (issue #2).
- `.github/workflows/agent-pipeline.yml` (issue #3) and the Superpowers install wiring inside it (issue #4) are both written, grounded in the real, verified `anthropics/claude-code-action@v1` inputs and the real Superpowers plugin structure — but neither has been exercised by an actual run yet. Issue #3's own testing guidance calls for a mechanics-only dry run (a fresh/resume cycle through at least the Analyzer and Planner stages) before trusting it against a real issue, specifically without spending the one live-Amazon-check budget on that dry run. The `live-amazon-check` job also depends on a GitHub Environment named `live-amazon-check` with required reviewers actually being configured in repo Settings — that's a manual step this repo work can't do on its own; flag it rather than assume it's done.
