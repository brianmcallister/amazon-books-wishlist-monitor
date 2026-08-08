#!/usr/bin/env node
// Records one stage's real cost and its structured output to a durable,
// git-committed log (`.github/pipeline-run-log.jsonl`) -- see
// docs/PIPELINE_IO.md for the per-stage contract this implements.
//
// Used by the Implementer matrix job and by both Deployer jobs. Implementer
// *needs* this rather than a plain GitHub Actions job output, because a
// matrix job's per-instance outputs aren't cleanly aggregable across
// instances (only the last instance's outputs survive to
// needs.<job>.outputs). Deployer could use a normal job output, but logs
// here anyway so there's one unified audit trail rather than two mechanisms
// depending on job type -- the same "commit a small file back to the repo"
// idiom this project already uses for notified.json and
// .github/pr-risk-log.jsonl.
//
// Deliberately NOT under .agents/ -- Deployer's pre-squash cleanup
// (git rm -r .agents/) must not delete this before the final cost
// report reads it.
//
// Usage: node scripts/log-stage-cost.js <issue-number> <stage-label> <execution-json-path>
// e.g.:  node scripts/log-stage-cost.js 17 "Implementer (2/3)" "$RUNNER_TEMP/claude-execution-output.json"
//
// Optional environment variables, all independent -- each adds fields to the
// logged line when set, and is simply omitted when not:
//   STAGE_SUMMARY     one-line summary from the stage's own structured output
//   DIFF_BASE_SHA     HEAD sha captured *before* the Claude session ran; when
//                     set, this script computes files_changed/insertions/
//                     deletions/commits itself rather than trusting a model
//                     to self-report numbers `git diff` already knows exactly
//                     (same reasoning as scripts/pr-risk-check.js -- see
//                     docs/AGENT_HARNESS.md's "Why this is a script")
//   STAGE_OUTCOME     Deployer only: opened | updated | kept | discarded
//   STAGE_PR_NUMBER   Deployer only: the PR it opened/updated, if any

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

const LOG_PATH = '.github/pipeline-run-log.jsonl';

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function shOrEmpty(cmd, args) {
  try {
    return sh(cmd, args);
  } catch (err) {
    return '';
  }
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

// MUST be called before this script makes its own commit below -- otherwise
// the log commit counts itself in the numbers it's reporting.
function computeChangeStats(baseSha) {
  const shortstat = shOrEmpty('git', ['diff', '--shortstat', baseSha, 'HEAD']);
  const filesMatch = shortstat.match(/(\d+) files? changed/);
  const insMatch = shortstat.match(/(\d+) insertions?\(\+\)/);
  const delMatch = shortstat.match(/(\d+) deletions?\(-\)/);
  const commits = shOrEmpty('git', ['rev-list', '--count', `${baseSha}..HEAD`]);

  // All-zero is a real, meaningful result (a task that turned out to be
  // already done -- which this pipeline hits routinely on re-runs, see
  // docs/AGENT_HARNESS.md), not a failure to measure. Log it as zeros.
  return {
    files_changed: filesMatch ? parseInt(filesMatch[1], 10) : 0,
    insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
    commits: commits ? parseInt(commits, 10) : 0,
  };
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

  const data = extractResult(JSON.parse(fs.readFileSync(execPath, 'utf8'))) || {};

  // Guard rather than assume: this file's shape has already surprised this
  // repo twice (missing path, array-vs-object). Cost telemetry is not worth
  // failing a job whose real work succeeded.
  const costUsd = typeof data.total_cost_usd === 'number' ? data.total_cost_usd : 0;
  const numTurns = typeof data.num_turns === 'number' ? data.num_turns : 0;

  const entry = {
    issue: parseInt(issueNumber, 10),
    stage: stageLabel,
    cost_usd: costUsd,
    num_turns: numTurns,
    duration_ms: data.duration_ms,
    timestamp: new Date().toISOString(),
  };

  if (process.env.STAGE_SUMMARY) entry.summary = process.env.STAGE_SUMMARY;
  if (process.env.STAGE_OUTCOME) entry.outcome = process.env.STAGE_OUTCOME;
  if (process.env.STAGE_PR_NUMBER) entry.pr_number = parseInt(process.env.STAGE_PR_NUMBER, 10);
  if (process.env.DIFF_BASE_SHA) Object.assign(entry, computeChangeStats(process.env.DIFF_BASE_SHA));

  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');

  sh('git', ['config', 'user.name', 'github-actions[bot]']);
  sh('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  reauthOrigin();
  sh('git', ['add', LOG_PATH]);
  sh('git', ['commit', '-m', `${stageLabel} (#${issueNumber}): Log run cost ($${costUsd.toFixed(4)}, ${numTurns} turns).`]);
  sh('git', ['push']);

  console.log(`Logged ${stageLabel}: $${costUsd.toFixed(4)}, ${numTurns} turns.`);
  console.log(JSON.stringify(entry, null, 2));
}

main();
