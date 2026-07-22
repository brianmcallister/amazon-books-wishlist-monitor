#!/usr/bin/env node
// Deterministic pre-computation for the Analyzer job's "fresh start vs.
// resume" decision. See docs/AGENT_HARNESS.md's "Fresh start vs. resume"
// section for the design this implements.
//
// Resolves the branch name for an issue, whether this run is a fresh start
// or a resume, which .agents/*.md stage files already exist on that branch,
// and any issue comments posted since the pipeline's own last checkpoint
// comment. These are all mechanical git/API facts -- branch-name slugging,
// "does this branch exist", "which .agents files are on it", "which issue
// comments postdate the marker" -- that would otherwise have to be
// re-derived via tool calls on every run for no reason. This script
// computes the facts; the Analyzer's own Claude session still decides what
// to do with them (how to fold in new guidance, whether to trust them over
// something odd it finds in git log, etc.) -- see the caveat baked into
// agent-pipeline.yml's prompt about not treating a stale checkpoint as
// ground truth.
//
// Usage: node scripts/resolve-pipeline-state.js <issue-number>
// Writes facts to $GITHUB_OUTPUT. Requires `gh` to be authenticated (same
// token this pipeline already runs under) and to be run from a checkout of
// the repo (so `gh api repos/{owner}/{repo}/...` can infer owner/repo).

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

const CHECKPOINT_MARKER = '🤖 **Pipeline checkpoint';
const BOT_LOGIN = 'claude[bot]';

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

// Small stopword list so a title like "Suppress repeat notifications for
// the same book within 14 days" slugs down to "suppress-repeat-
// notifications-book-within-14-days" rather than front-loading with
// low-content filler words before the 6-word cap below even reaches the
// meaningful ones.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'of', 'and', 'in', 'is', 'on', 'with',
  'at', 'by', 'from', 'that', 'this', 'as', 'be', 'or', 'so', 'it',
]);

function slugify(title) {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .slice(0, 6); // first 6 significant words keeps branch names readable
  return words.join('-');
}

function writeOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (value.includes('\n')) {
    const delim = `EOF_${name}_${Date.now()}`;
    fs.appendFileSync(out, `${name}<<${delim}\n${value}\n${delim}\n`);
  } else {
    fs.appendFileSync(out, `${name}=${value}\n`);
  }
}

function main() {
  const issueNumber = process.argv[2];
  if (!issueNumber) {
    console.error('Usage: node scripts/resolve-pipeline-state.js <issue-number>');
    process.exit(1);
  }

  const issue = ghJson(['api', `repos/{owner}/{repo}/issues/${issueNumber}`]);
  const candidateBranch = `issue-${issueNumber}-${slugify(issue.title)}`;

  // Match by prefix, not exact candidate name -- an earlier run's slug may
  // differ slightly from what slugify() computes here (title edited since,
  // algorithm changed), and the branch that actually has commits on it is
  // the one that matters, not the one this run would have picked from
  // scratch.
  const branches = ghJson(['api', `repos/{owner}/{repo}/branches`]).filter(
    (b) => b.name === candidateBranch || b.name.startsWith(`issue-${issueNumber}-`)
  );

  const isResume = branches.length > 0;
  const branch = isResume ? branches[0].name : candidateBranch;

  if (branches.length > 1) {
    console.error(
      `WARNING: multiple existing branches match issue-${issueNumber}-*: ${branches
        .map((b) => b.name)
        .join(', ')}. Picked ${branch} -- this is worth the Orchestrator flagging as ambiguous rather than silently trusting.`
    );
  }

  // Read .agents/*.md directly from the branch's real tree via the API --
  // deliberately not from a prior checkpoint comment's claims about what
  // finished. This repo has already hit the failure mode where a checkpoint
  // comment described completed stages that were never actually pushed
  // (see docs/AGENT_HARNESS.md's "Git as the inter-stage handoff
  // mechanism") -- reading the real tree instead of trusting prose is the
  // whole fix.
  let agentsFiles = [];
  if (isResume) {
    try {
      const contents = ghJson(['api', `repos/{owner}/{repo}/contents/.agents?ref=${branch}`]);
      agentsFiles = contents.map((f) => f.name).sort();
    } catch (err) {
      agentsFiles = []; // .agents/ doesn't exist on this branch yet -- fine
    }
  }

  let newGuidance = '';
  let lastCheckpointFound = false;
  if (isResume) {
    const comments = ghJson(['api', `repos/{owner}/{repo}/issues/${issueNumber}/comments`]);
    const checkpoints = comments.filter(
      (c) => c.user.login === BOT_LOGIN && c.body.startsWith(CHECKPOINT_MARKER)
    );
    if (checkpoints.length > 0) {
      lastCheckpointFound = true;
      const last = checkpoints[checkpoints.length - 1];
      const lastTime = new Date(last.created_at).getTime();
      const after = comments.filter(
        (c) => c.id !== last.id && new Date(c.created_at).getTime() > lastTime
      );
      newGuidance = after
        .map((c) => `--- comment by ${c.user.login} at ${c.created_at} ---\n${c.body}`)
        .join('\n\n');
    }
  }

  writeOutput('branch', branch);
  writeOutput('is_resume', String(isResume));
  writeOutput('agents_files_present', agentsFiles.join(','));
  writeOutput('last_checkpoint_found', String(lastCheckpointFound));
  writeOutput('new_guidance', newGuidance);

  console.log(`Branch: ${branch} (${isResume ? 'resume' : 'fresh start'})`);
  console.log(`.agents files present: ${agentsFiles.join(', ') || '(none)'}`);
  console.log(`Prior checkpoint comment found: ${lastCheckpointFound}`);
  console.log(`New guidance since last checkpoint: ${newGuidance ? 'yes' : 'no'}`);
}

main();
