#!/usr/bin/env node
// Deterministic replacement for the PR Risk Analyzer pipeline stage.
// See docs/AGENT_HARNESS.md's "PR Risk Analyzer" section for the rubric this
// implements, and "Why this is a script, not a subagent" for why this stage
// specifically doesn't use a model call at all.
//
// Usage: node scripts/pr-risk-check.js <issue-number> <pr-number>
//
// Computes the risk determination from `git diff main...HEAD`, posts a PR
// comment via `gh`, appends a line to .github/pr-risk-log.jsonl, and commits
// + pushes that file. Run from a checkout of the pipeline branch, after the
// PR has been opened (so there's a real PR number to comment on and log).

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

// The load-bearing region in check-wishlist.js -- scrapeWishlist() and
// sendEmail() -- per CLAUDE.md's load-bearing list. Lines outside this range
// (top-of-file requires/constants/small pure helpers, and the tail IIFE
// where feature wiring like issue #1's dedup logic lands) are not
// load-bearing. Update these line numbers if the file's structure changes;
// this is a real fragility of a line-range heuristic, not a hidden one --
// see the doc section referenced above.
const LOAD_BEARING_FILE = 'check-wishlist.js';
const LOAD_BEARING_START_LINE = 31; // `async function scrapeWishlist(url) {`
const LOAD_BEARING_END_LINE = 190; // closing brace of sendEmail()

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

// Only matters when this script runs as its own post-session workflow step
// (agent-pipeline-v2.yml's Deployer job) rather than being invoked mid-session
// by an Orchestrator's own Bash tool call (agent-pipeline.yml) -- see
// scripts/log-stage-cost.js's reauthOrigin() for why: claude-code-action
// mints its own scoped GitHub App installation token for the Claude
// session's own git operations, then revokes it as part of its own
// composite-action cleanup immediately after the session ends, breaking
// the credential for any later step's own git push.
function reauthOrigin() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return; // best effort -- let the push surface any real problem
  const serverUrl = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace('https://', '');
  sh('git', ['remote', 'set-url', 'origin', `https://x-access-token:${token}@${serverUrl}/${repo}.git`]);
}

function main() {
  const [issueNumber, prNumber] = process.argv.slice(2);
  if (!issueNumber || !prNumber) {
    console.error('Usage: node scripts/pr-risk-check.js <issue-number> <pr-number>');
    process.exit(1);
  }

  const changedFiles = shOrEmpty('git', ['diff', 'main...HEAD', '--name-only'])
    .split('\n')
    .filter(Boolean);

  const shortstat = shOrEmpty('git', ['diff', 'main...HEAD', '--shortstat']);
  const filesMatch = shortstat.match(/(\d+) files? changed/);
  const insMatch = shortstat.match(/(\d+) insertions?\(\+\)/);
  const delMatch = shortstat.match(/(\d+) deletions?\(-\)/);
  const filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : changedFiles.length;
  const insertions = insMatch ? parseInt(insMatch[1], 10) : 0;
  const deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
  const totalLines = insertions + deletions;

  const reasons = [];

  // 1. Load-bearing code touch
  let touchesLoadBearing = false;
  if (changedFiles.includes(LOAD_BEARING_FILE)) {
    const diff = shOrEmpty('git', ['diff', '--unified=0', 'main...HEAD', '--', LOAD_BEARING_FILE]);
    const hunkHeaders = diff.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm) || [];
    for (const header of hunkHeaders) {
      const m = header.match(/\+(\d+)/);
      if (!m) continue;
      const line = parseInt(m[1], 10);
      if (line >= LOAD_BEARING_START_LINE && line <= LOAD_BEARING_END_LINE) {
        touchesLoadBearing = true;
      }
    }
  }
  if (touchesLoadBearing) {
    reasons.push(
      `Diff touches ${LOAD_BEARING_FILE} lines ${LOAD_BEARING_START_LINE}-${LOAD_BEARING_END_LINE} -- the load-bearing scrapeWishlist()/sendEmail() region per CLAUDE.md.`
    );
  }

  // 2. Workflow YAML permissions/secrets/state-commit step
  const touchedWorkflows = changedFiles.filter((f) => f.startsWith('.github/workflows/'));
  if (touchedWorkflows.length > 0) {
    reasons.push(`Diff touches workflow YAML: ${touchedWorkflows.join(', ')}.`);
  }

  // 3. Dependency changes
  if (changedFiles.includes('package.json')) {
    reasons.push('Diff touches package.json (adds/changes a dependency).');
  }

  // 4. Diff size
  const isLarge = totalLines > 100 || filesChanged > 3;
  if (isLarge) {
    reasons.push(
      `Diff is large (${totalLines} lines, ${filesChanged} file(s) -- exceeds >100 lines or >3 files threshold).`
    );
  }

  // 5. Test coverage
  const touchesTests = changedFiles.some((f) => f.startsWith('test/'));
  if (!touchesTests) {
    reasons.push('Diff has no changes under test/ -- no test coverage detected.');
  }

  const risk = reasons.length > 0 ? 'high' : 'low';

  // No required CI check exists yet (see issue #2, blocked on issue #1's
  // tests) -- nothing to fail, so this is always true until that lands.
  const checksPassed = true;

  const sha = sh('git', ['rev-parse', 'HEAD']);
  const timestamp = new Date().toISOString();

  const logLine = JSON.stringify({
    pr: parseInt(prNumber, 10),
    sha,
    risk,
    reasons,
    checks_passed: checksPassed,
    timestamp,
  });

  fs.appendFileSync('.github/pr-risk-log.jsonl', logLine + '\n');

  const commentLines = [
    `## PR Risk Analysis: Issue #${issueNumber}`,
    '',
    `**Risk Level: ${risk.toUpperCase()}**`,
    '',
    '_Computed deterministically from the fixed rubric in `docs/AGENT_HARNESS.md` -- no model call, reproducible from this diff. See `scripts/pr-risk-check.js`._',
    '',
  ];
  if (reasons.length > 0) {
    commentLines.push('### Rubric items that fired', '');
    for (const r of reasons) commentLines.push(`- ${r}`);
  } else {
    commentLines.push('### No rubric items fired -- all conditions for LOW RISK were met.');
  }
  commentLines.push('', `Diff stats: ${filesChanged} file(s), +${insertions}/-${deletions} lines.`);
  const commentBody = commentLines.join('\n');

  sh('gh', ['pr', 'comment', String(prNumber), '--body', commentBody]);

  sh('git', ['config', 'user.name', 'github-actions[bot]']);
  sh('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  reauthOrigin();
  sh('git', ['add', '.github/pr-risk-log.jsonl']);
  sh('git', [
    'commit',
    '-m',
    `PR Risk Analyzer (#${issueNumber}): Risk determination for PR #${prNumber} (${risk.toUpperCase()}).`,
  ]);
  sh('git', ['push']);

  console.log(`Risk: ${risk}`);
  console.log(`Reasons: ${JSON.stringify(reasons, null, 2)}`);
  console.log('Posted PR comment and pushed .github/pr-risk-log.jsonl.');
}

main();
