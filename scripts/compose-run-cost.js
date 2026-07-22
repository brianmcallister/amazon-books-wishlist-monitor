#!/usr/bin/env node
// Appends a "Run Cost" section to a PR's description, run from the
// Deployer job in agent-pipeline.yml's split architecture -- see
// docs/AGENT_HARNESS.md's "How this actually runs" section for the
// full design.
//
// Each stage is its own job/runner, so each
// one's real total_cost_usd is directly knowable (no more "a stage can't
// know its own cost mid-session" problem -- a job's own cost IS knowable
// once ITS ONE claude-code-action step ends, which is the whole job).
// Single-instance stages (Analyzer, Planner, Plan Validator, Tester,
// Deployer) pass their cost through as plain GitHub Actions job outputs,
// composed into STAGE_COSTS_JSON by the workflow. The Implementer matrix
// job is the one exception -- GitHub Actions doesn't cleanly aggregate a
// matrix job's per-instance outputs, so each Implementer task instance
// commits its own line to .github/pipeline-run-log.jsonl instead (see
// scripts/log-stage-cost.js); this script reads that file directly for
// the Implementer rows.
//
// Usage: node scripts/compose-run-cost.js <issue-number> <pr-number>
// Reads one COST_<STAGE> env var per single-instance stage that actually
// ran, each a "cost_usd,num_turns" pair (e.g. COST_ANALYZER="0.1207,18")
// -- plain env vars instead of a pre-built JSON blob so the workflow YAML
// doesn't need inline JSON composition with its escaping pitfalls. A
// stage whose env var is unset or empty is treated as "didn't run" and
// omitted from the table entirely (Plan Validator, most runs).

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function readImplementerCosts(issueNumber) {
  const logPath = '.github/pipeline-run-log.jsonl';
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        return null;
      }
    })
    .filter((entry) => entry && entry.issue === parseInt(issueNumber, 10) && entry.stage.startsWith('Implementer'));
}

// Deployer's PR descriptions carry a fixed `## Trace` heading (see
// deployer.md) specifically so this section can be inserted right after
// the trace narrative -- appended at the very end of the body (after
// "Closes #N") reads like an afterthought disconnected from the rest of
// the description. Falls back to appending at the end if that heading
// isn't found (an older or hand-written PR description, say), rather than
// failing outright.
function insertAfterTrace(body, section) {
  const lines = body.split('\n');
  const traceIdx = lines.findIndex((l) => l.trim() === '## Trace');
  if (traceIdx === -1) {
    return `${body}\n\n${section}\n`;
  }
  let insertAt = lines.length;
  for (let i = traceIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      insertAt = i;
      break;
    }
  }
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  return [...before, '', section, '', ...after].join('\n');
}

function main() {
  const [issueNumber, prNumber] = process.argv.slice(2);
  if (!issueNumber || !prNumber) {
    console.error('Usage: node scripts/compose-run-cost.js <issue-number> <pr-number>');
    process.exit(1);
  }

  const STAGE_ENV_VARS = {
    Analyzer: 'COST_ANALYZER',
    Planner: 'COST_PLANNER',
    'Plan Validator': 'COST_PLAN_VALIDATOR',
    Tester: 'COST_TESTER',
    Deployer: 'COST_DEPLOYER',
  };

  const stageCosts = {};
  for (const [stage, envVar] of Object.entries(STAGE_ENV_VARS)) {
    const raw = process.env[envVar];
    if (!raw) continue; // stage didn't run this pipeline pass (e.g. Plan Validator)
    const [costUsd, numTurns] = raw.split(',');
    stageCosts[stage] = { cost_usd: Number(costUsd), num_turns: Number(numTurns) };
  }

  const implementerCosts = readImplementerCosts(issueNumber);
  for (const entry of implementerCosts) {
    stageCosts[entry.stage] = { cost_usd: entry.cost_usd, num_turns: entry.num_turns };
  }

  const rows = Object.entries(stageCosts);
  let total = 0;
  const tableLines = ['| Stage | Cost | Turns |', '|---|---|---|'];
  for (const [stage, u] of rows) {
    const cost = Number(u.cost_usd) || 0;
    total += cost;
    tableLines.push(`| ${stage} | $${cost.toFixed(4)} | ${u.num_turns ?? '?'} |`);
  }

  const costSection = [
    '## Run Cost',
    '',
    `**Total: $${total.toFixed(4)}** across ${rows.length} job${rows.length === 1 ? '' : 's'}`,
    '',
    ...tableLines,
    '',
    "_Each row is that stage's own real cost -- every stage ran as a separate GitHub Actions job/session, so unlike this project's earlier single-session pipeline, no estimation or reconstruction is needed to attribute cost per stage. See docs/AGENT_HARNESS.md's \"Splitting stages into separate invocations\" section._",
  ].join('\n');

  const currentBody = sh('gh', ['pr', 'view', String(prNumber), '--json', 'body', '--jq', '.body']);
  const newBody = insertAfterTrace(currentBody, costSection);

  const tmpFile = path.join(os.tmpdir(), `pr-${prNumber}-body-with-cost.md`);
  fs.writeFileSync(tmpFile, newBody);
  sh('gh', ['pr', 'edit', String(prNumber), '--body-file', tmpFile]);

  console.log(`Appended run cost section to PR #${prNumber} (total $${total.toFixed(4)} across ${rows.length} jobs).`);
}

main();
