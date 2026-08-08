#!/usr/bin/env node
// Records one stage's real cost to a durable, git-committed log. Only
// needed for the Implementer matrix job (see agent-pipeline.yml):
// every other stage runs as a single job, so its cost is available
// directly as a job output (steps.extract-cost.outputs.cost_usd) with no
// need to round-trip through git. A matrix job's per-instance outputs
// aren't cleanly aggregable across instances in GitHub Actions (only the
// last instance's outputs survive to needs.<job>.outputs), so each
// Implementer task instance commits its own line here instead -- the
// same "commit a small file back to the repo" idiom this project already
// uses for notified.json and .github/pr-risk-log.jsonl.
//
// Deliberately NOT under .agents/ -- Deployer's pre-squash cleanup
// (git rm -r .agents/) must not delete this before the final cost
// report reads it.
//
// Usage: node scripts/log-stage-cost.js <issue-number> <stage-label> <execution-json-path>
// e.g.:  node scripts/log-stage-cost.js 17 "Implementer (2/3)" "$RUNNER_TEMP/claude-execution-output.json"

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

// claude-code-action mints its own scoped GitHub App installation token for
// the Claude session's own git operations, then revokes it (a `curl -X
// DELETE .../installation/token` visible in the job log) as an inline part
// of its own composite-action cleanup -- which runs immediately after the
// session ends, before control returns to this workflow step. That
// revocation leaves whatever git credential was in place broken for any
// *later* step that pushes, even though actions/checkout's own
// GITHUB_TOKEN-based credential worked fine earlier in the same job
// (confirmed: this job's "Sync resumed branch" step, which runs before
// claude-code-action, and Claude's own in-session commits both push
// cleanly -- only this post-session push fails). Re-pointing origin at an
// explicit GH_TOKEN-authed URL sidesteps whatever claude-code-action left
// behind rather than depending on it.
function reauthOrigin() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return; // best effort -- let the push surface any real problem
  const serverUrl = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace('https://', '');
  sh('git', ['remote', 'set-url', 'origin', `https://x-access-token:${token}@${serverUrl}/${repo}.git`]);
}

// claude-code-action's execution-output file is sometimes the single final
// "result" object, sometimes a full array of stream events (observed with
// show_full_output: true, set throughout this repo's workflows) with
// "result" as one entry -- handle both rather than assuming one, an
// assumption that silently broke every jq-based cost extraction in this
// workflow until issue #17's dogfooding run surfaced it.
function extractResult(parsed) {
  if (!Array.isArray(parsed)) return parsed;
  return parsed.find((e) => e && e.type === 'result') || parsed[parsed.length - 1];
}

function main() {
  const [issueNumber, stageLabel, execPath] = process.argv.slice(2);
  if (!issueNumber || !stageLabel || !execPath) {
    console.error('Usage: node scripts/log-stage-cost.js <issue-number> <stage-label> <execution-json-path>');
    process.exit(1);
  }

  if (!fs.existsSync(execPath)) {
    console.error(`No execution output file at ${execPath} -- nothing to log. Known fragility -- see docs/AGENT_HARNESS.md's Observability section.`);
    process.exit(0); // don't fail the job over missing cost telemetry
  }

  const data = extractResult(JSON.parse(fs.readFileSync(execPath, 'utf8')));
  const logLine = JSON.stringify({
    issue: parseInt(issueNumber, 10),
    stage: stageLabel,
    cost_usd: data.total_cost_usd,
    num_turns: data.num_turns,
    duration_ms: data.duration_ms,
    timestamp: new Date().toISOString(),
  });

  fs.appendFileSync('.github/pipeline-run-log.jsonl', logLine + '\n');

  sh('git', ['config', 'user.name', 'github-actions[bot]']);
  sh('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  reauthOrigin();
  sh('git', ['add', '.github/pipeline-run-log.jsonl']);
  sh('git', [
    'commit',
    '-m',
    `${stageLabel} (#${issueNumber}): Log run cost ($${data.total_cost_usd.toFixed(4)}, ${data.num_turns} turns).`,
  ]);
  sh('git', ['push']);

  console.log(`Logged ${stageLabel}: $${data.total_cost_usd.toFixed(4)}, ${data.num_turns} turns.`);
}

main();
