# Pipeline stage I/O contracts

What every stage in `.github/workflows/agent-pipeline.yml` receives, and what it must produce. `docs/AGENT_HARNESS.md` covers *why* the pipeline is shaped this way; this document is the mechanical contract — the thing to check when a stage's output isn't landing where a downstream stage expects it.

## How to read this

Each stage has up to three parts:

- **Inputs** — the exact context injected into that job's prompt. "Source" says where the value comes from: a `workflow_dispatch` input, an upstream job's output, GitHub's own context, or a file already committed on the branch.
- **Structured output** — the JSON the stage must return, enforced by a `--json-schema` flag on its `claude-code-action` step. The schemas below are transcribed **verbatim** from `agent-pipeline.yml`; if they ever disagree, the workflow is right and this file is stale.
- **Committed artifact** — the file the stage commits, with a literal template. **These templates are enforced**, not advisory: `scripts/validate-agent-output.js` runs as a workflow step and fails the job if a required heading is missing or reworded.

Every stage additionally receives `ISSUE NUMBER`, `REPO`, and `BRANCH`; only stage-specific extras are called out per section.

## Why the templates are enforced rather than merely documented

This repo already had exactly one artifact with an informally-required exact heading: Deployer's `## Trace`, which `scripts/compose-run-cost.js` looks for to place the run-cost section. When that heading was absent, the script fell back to appending at the end of the body — **silently**, producing a worse result with nothing surfaced to anyone.

That's the failure mode enforcement exists to prevent. A pipeline whose whole operating premise is "red means a human is needed" (see `AGENT_HARNESS.md`) shouldn't quietly accept a malformed artifact: a stage that didn't follow its own template produced a defective output, and a human should see it as one. So the validator fails the job rather than warning.

Two deliberate limits on what's enforced:

- **Only `##` section headings**, not the `#` title line. Titles carry per-run text (issue number, a one-line summary) that can't be matched exactly; section headings are fixed by the template.
- **Extra sections are fine.** The check is "these headings are present," not "only these headings are present" — a stage with more to say should say it.

Validation steps run **last** in their job, after cost extraction and after any issue comment the stage posts. A template violation should fail the run, but it shouldn't cost you the cost record or the explanatory comment that would help you understand *why* the run stopped.

---

## Analyzer

### Inputs

| Field | Source | Example |
|---|---|---|
| `ISSUE NUMBER` | `workflow_dispatch` input | `31` |
| `REPO` | `github.repository` | `brianmcallister/amazon-books-wishlist-monitor` |
| `BRANCH` | `scripts/resolve-pipeline-state.js` | `issue-31-document-enforce-input-output-templates` |
| `THIS RUN IS A` | `resolve-pipeline-state.js` (`is_resume`) | `FRESH START (create it from main)` |
| `.agents/*.md FILES ALREADY ON THAT BRANCH` | `resolve-pipeline-state.js` | `analysis.md,plan.md` |
| `A PRIOR CHECKPOINT COMMENT WAS FOUND` | `resolve-pipeline-state.js` | `true` |
| `NEW ISSUE COMMENTS SINCE THAT CHECKPOINT` | `resolve-pipeline-state.js` | *(comment bodies, or empty)* |

Analyzer is the only stage that receives resume state, because it's the only stage that acts on it — see `AGENT_HARNESS.md`'s "Fresh start vs. resume."

### Structured output

```json
{"type":"object","properties":{"classification":{"type":"string","enum":["pure-logic","scraping-touching"]},"fully_specified":{"type":"boolean"},"summary":{"type":"string"}},"required":["classification","fully_specified","summary"]}
```

`classification` gates whether Plan Validator runs at all. `fully_specified: false` stops the pipeline and posts an issue comment.

### Committed artifact: `.agents/analysis.md`

Required headings: `## Scope confirmation`, `## Risk classification`, `## Caveats`

```markdown
# Analyzer (#<issue-number>): <one-line title>

## Scope confirmation
<Either "Fully specified." with what you verified it against, or the specific gaps found.>

## Risk classification
<Exactly `pure-logic` or `scraping-touching`, then a short paragraph of reasoning.>

## Caveats
<Anything a downstream stage should know, or "None.">
```

---

## Planner

### Inputs

Standard three only. Reads `.agents/analysis.md` from the branch.

### Structured output

```json
{"type":"object","properties":{"tasks":{"type":"array","items":{"type":"object","properties":{"index":{"type":"integer"},"total":{"type":"integer"},"description":{"type":"string"}},"required":["index","total","description"]}},"summary":{"type":"string"}},"required":["tasks","summary"]}
```

**`tasks` is read mechanically, not by a human** — it populates the Implementer job's `strategy.matrix`, so its count and order must match `## Task breakdown` in the committed plan. An empty array (`[]`) is a valid, meaningful answer: it means every task is already done, and the workflow handles it explicitly (Implementer skips entirely, Tester proceeds anyway — see `AGENT_HARNESS.md`'s debugging history for why this case needed its own handling).

### Committed artifact: `.agents/plan.md`

Required headings: `## Approach`, `## Seams`, `## Task breakdown`, `## Coverage checklist`

```markdown
# Planner (#<issue-number>): <one-line title>

## Approach
<Short prose: what's being built and why this shape.>

## Seams
<Pure functions being introduced — name, signature, one-line responsibility.>

## Task breakdown
<The `writing-plans` skill's output. Count and order must match the `tasks` array above.>

## Coverage checklist
<Every acceptance criterion → the task covering it. Then what this plan does NOT touch, checked against the issue's non-goals.>
```

---

## Plan Validator

Runs only when Analyzer classified the task `scraping-touching`.

### Inputs

Standard three only. Reads the issue, `.agents/analysis.md`, and `.agents/plan.md`.

### Structured output

```json
{"type":"object","properties":{"approved":{"type":"boolean"},"summary":{"type":"string"}},"required":["approved","summary"]}
```

`approved: false` stops the pipeline and posts an issue comment. It does **not** auto-loop back to the Planner — see `AGENT_HARNESS.md`'s failure-handling rule 3.

### Committed artifact: `.agents/plan-validation.md`

Required headings: `## Verdict`, `## Checks`, `## Findings`

```markdown
# Plan Validator (#<issue-number>): <one-line title>

## Verdict
<`approved` or `rejected`, then one sentence. Must agree with the `approved` boolean.>

## Checks
<The four checks from plan-validator.md, each named, each with what was actually found.>

## Findings
<Specific gaps needing to go back to the Planner, or "None.">
```

---

## Implementer

One job per task, via `strategy.matrix` over Planner's `tasks`.

### Inputs

| Field | Source | Example |
|---|---|---|
| standard three | — | — |
| `YOUR TASK (n/total)` | `matrix.task.index` / `.total` / `.description` | `2/3: Add formatDryRunMessage seam` |

Full task detail lives in `.agents/plan.md`; the injected description is a short label.

### Structured output

```json
{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}
```

**Deliberately just a summary.** The "what changed" numbers are *not* self-reported — `scripts/log-stage-cost.js` computes them from git, diffing the HEAD sha captured before the session started (a `Record pre-session HEAD` step) against HEAD afterward. Same reasoning as PR Risk Analyzer being a script rather than a model call (`AGENT_HARNESS.md`, "Why this is a script, not a subagent"): anything `git diff` already knows exactly shouldn't be re-derived probabilistically.

The sha must be captured *before* the session, and the stats computed *before* this script makes its own log commit — otherwise the log commit counts itself in the numbers it reports.

### Logged to `.github/pipeline-run-log.jsonl`

Implementer can't use normal job outputs: a matrix job's per-instance outputs don't aggregate (only the last instance survives to `needs.<job>.outputs`). So each instance appends one line:

```json
{"issue":31,"stage":"Implementer (2/3)","cost_usd":0.2495,"num_turns":7,"duration_ms":35399,"timestamp":"2026-07-19T12:37:51.000Z","summary":"Added formatDryRunMessage seam with unit tests.","files_changed":2,"insertions":41,"deletions":3,"commits":2}
```

All-zero change stats are a real result, not a measurement failure — a task that turned out to be already done (which this pipeline hits routinely on re-runs) legitimately produces zeros.

---

## Tester

### Inputs

Standard three only.

### Structured output

```json
{"type":"object","properties":{"live_check_warranted":{"type":"boolean"},"summary":{"type":"string"}},"required":["live_check_warranted","summary"]}
```

`live_check_warranted: true` routes the run down the approval-gated `live-amazon-check` path instead of straight to Deployer. This is the one output that can trigger a real-money, rate-limit-sensitive external call, so it's gated by a GitHub Environment with required reviewers on top — see `AGENT_HARNESS.md`'s "The one hard boundary."

Tester commits fixes directly to the branch; it has no `.agents/*.md` artifact and therefore no template.

---

## Deployer

Two jobs run this same contract: `deployer` (no live check needed) and `deployer-after-live-check`.

### Inputs

Standard three. `deployer-after-live-check` additionally reads `.agents/live-check-result.md` and the fixture the live-check job just committed.

### Structured output

```json
{"type":"object","properties":{"outcome":{"type":"string","enum":["opened","updated","kept","discarded"]},"pr_number":{"type":"integer"},"summary":{"type":"string"}},"required":["outcome","summary"]}
```

`pr_number` is intentionally **not** in `required` — the `kept` and `discarded` paths have no PR, and omitting the field is cleaner than a sentinel value.

This output is the durable record of what Deployer believed it did. It does **not** feed the mechanical next step: the workflow re-derives the PR number independently via `gh pr list --head <branch>` to run the risk check and cost report. That redundancy is deliberate — a disagreement between what Deployer reported and what the branch actually has is exactly the kind of thing worth being able to catch after the fact.

### Committed artifact: the PR description

Required headings: `## Why`, `## Trace`

```markdown
## Why
<Short: what this change is for.>

## Trace
<Analysis findings → plan approach → what got built → how it was tested.>

Closes #<issue-number>
```

`scripts/compose-run-cost.js` inserts the run-cost section immediately after `## Trace`. Validation runs **before** that insertion, against Deployer's own composed body.

**No risk-assessment section** — PR Risk Analyzer runs after Deployer (it needs a real PR number), so there's nothing to synthesize at this point. Say plainly that the determination follows as a separate comment.

### Logged to `.github/pipeline-run-log.jsonl`

Deployer is single-instance and *could* use a normal job output, but logs to the same file as Implementer so there's one audit trail rather than two mechanisms depending on job type:

```json
{"issue":31,"stage":"Deployer","cost_usd":0.6266,"num_turns":18,"duration_ms":118000,"timestamp":"2026-07-19T13:41:30.000Z","summary":"Opened PR #33 with the full stage trace.","outcome":"opened","pr_number":33}
```

---

## PR Risk Analyzer

Not a Claude session at all — `scripts/pr-risk-check.js`, a plain workflow step in the Deployer job. No prompt, no schema, no model cost. Same diff always produces the same determination.

### Inputs

`node scripts/pr-risk-check.js <issue-number> <pr-number>`, run from a checkout of the pipeline branch after the PR exists.

### Outputs

1. A **PR comment** stating the risk level and which rubric items fired.
2. A line appended to **`.github/pr-risk-log.jsonl`**, committed and pushed by the script itself:

```json
{"pr":33,"sha":"abc1234","risk":"low","reasons":[],"checks_passed":true,"timestamp":"2026-07-19T13:41:34.000Z"}
```

The rubric itself lives in `AGENT_HARNESS.md`'s "PR Risk Analyzer" section — this file documents the I/O shape, not the risk logic.

---

## Adding or changing a contract

If you change a `--json-schema` in `agent-pipeline.yml`, update this file in the same commit — the schemas here are transcriptions, and a stale transcription is worse than none. Same for the templates: the enforced heading list lives in the workflow's `validate-agent-output.js` invocation, the human-readable template lives here and in the relevant `.claude/agents/*.md` file, and all three need to agree.

That three-way duplication is a real wart. `.claude/agents/*.md` frontmatter owning the schema — so the workflow reads it from the agent file rather than hardcoding it — is tracked separately as the "self-contained agent files" work; when that lands, this file becomes a pointer to frontmatter rather than a second copy of it.
