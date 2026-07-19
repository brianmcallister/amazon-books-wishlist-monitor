#!/usr/bin/env node
// Appends a "Run Cost" section to a PR's description after the pipeline
// session that produced it has fully ended. See docs/AGENT_HARNESS.md's
// "Observability" section for why this is a separate deterministic step
// rather than something Deployer (or any stage) self-reports: a stage
// dispatched mid-session cannot know the run's true final cost, since
// later stages (including its own remaining turns) still cost money that
// hasn't been spent yet at the point it would report.
//
// The total-cost figure comes from claude-code-action's own execution
// output file, written to disk once the whole session ends -- not from
// any stage's self-report. This path is an internal implementation detail
// of claude-code-action, not a documented/stable contract, so this script
// degrades gracefully (posts a note instead of failing the job) if the
// file isn't where expected.
//
// Usage: node scripts/append-run-cost.js <pr-number> <execution-json-path>
// Reads STAGE_USAGE_MARKDOWN from the environment (the Orchestrator's own
// per-stage token/tool-use/duration table, captured live during the run
// from each Agent-tool dispatch's return value -- see agent-pipeline.yml).

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function formatModelUsage(modelUsage) {
  return Object.entries(modelUsage || {})
    .map(
      ([model, u]) =>
        `- **${model}**: $${u.costUSD.toFixed(4)} (${u.inputTokens} in / ${u.outputTokens} out / ${u.cacheReadInputTokens} cache-read / ${u.cacheCreationInputTokens} cache-write)`
    )
    .join('\n');
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
  const [prNumber, execPath] = process.argv.slice(2);
  if (!prNumber || !execPath) {
    console.error('Usage: node scripts/append-run-cost.js <pr-number> <execution-json-path>');
    process.exit(1);
  }

  const stageUsage = process.env.STAGE_USAGE_MARKDOWN || '_(not reported this run)_';

  let costSection;
  if (fs.existsSync(execPath)) {
    const data = JSON.parse(fs.readFileSync(execPath, 'utf8'));
    const total = data.total_cost_usd;
    costSection = [
      '## Run Cost',
      '',
      `**Total: $${total.toFixed(4)}** (${data.num_turns} orchestrator turns, ${(data.duration_ms / 1000 / 60).toFixed(1)} min wall clock)`,
      '',
      formatModelUsage(data.modelUsage),
      '',
      '### Per-stage resource usage',
      '',
      stageUsage,
      '',
      '_Total cost is read from the session\'s own final accounting once the run ends, not self-reported by any stage -- a stage dispatched mid-session can\'t know the run\'s eventual total. Per-stage figures above are token/tool-use/duration counts, not a dollar split: a single shared Orchestrator session makes a precise per-stage dollar figure unreliable to compute (see docs/AGENT_HARNESS.md\'s Observability section)._',
    ].join('\n');
  } else {
    costSection = [
      '## Run Cost',
      '',
      `_Cost data unavailable this run -- expected execution output file not found at \`${execPath}\`. This is a known fragility (that path is an internal claude-code-action implementation detail, not a documented contract) -- see scripts/append-run-cost.js._`,
    ].join('\n');
  }

  const currentBody = sh('gh', ['pr', 'view', String(prNumber), '--json', 'body', '--jq', '.body']);
  const newBody = insertAfterTrace(currentBody, costSection);

  const tmpFile = path.join(os.tmpdir(), `pr-${prNumber}-body-with-cost.md`);
  fs.writeFileSync(tmpFile, newBody);
  sh('gh', ['pr', 'edit', String(prNumber), '--body-file', tmpFile]);

  console.log(`Appended run cost section to PR #${prNumber}.`);
}

main();
