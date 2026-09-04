#!/usr/bin/env node
// Enforces the committed-artifact templates defined in docs/PIPELINE_IO.md.
// Every pipeline stage that commits a `.agents/*.md` file (Analyzer, Planner,
// Plan Validator) -- plus Deployer's PR description -- must carry a fixed set
// of `##` headings, exact text. This script checks that and FAILS THE JOB if
// any are missing.
//
// Why this fails rather than warns: the one place this repo already depended
// on an exact heading (`## Trace`, which scripts/compose-run-cost.js looks for
// to place the run-cost section) degraded *silently* when it was absent --
// falling back to appending at the end of the body, producing a worse result
// with nothing surfaced. A pipeline built around "red means a human is
// needed" (see docs/AGENT_HARNESS.md) shouldn't quietly accept a malformed
// artifact; a template violation is a real defect in a stage's output and a
// human should see it as one.
//
// Usage: node scripts/validate-agent-output.js <file> <required-heading>...
// e.g.:  node scripts/validate-agent-output.js .agents/analysis.md \
//          "## Scope confirmation" "## Risk classification" "## Caveats"
//
// Deployer's PR description isn't a file on disk, so the workflow writes it
// out first (`gh pr view N --json body --jq .body > /tmp/pr-body.md`) and
// validates that -- one code path, rather than a second stdin mode.
//
// Only `##` section headings are enforced, not the `#` title line: the title
// carries per-run text (issue number, a one-line summary) that can't be
// matched exactly, while the section headings are fixed by the template.

'use strict';

const fs = require('fs');

function main() {
  const [filePath, ...requiredHeadings] = process.argv.slice(2);

  if (!filePath || requiredHeadings.length === 0) {
    console.error('Usage: node scripts/validate-agent-output.js <file> <required-heading>...');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`::error::${filePath} does not exist -- the stage that should have committed it did not.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').map((l) => l.trim());

  // Report every missing heading at once rather than stopping at the first --
  // a human fixing this should see the whole list in one pass, not rediscover
  // it one failed run at a time.
  const missing = requiredHeadings.filter((heading) => !lines.includes(heading.trim()));

  if (missing.length > 0) {
    console.error(
      `::error::${filePath} is missing ${missing.length} required heading(s): ${missing.join(', ')}`
    );
    console.error('');
    console.error(`Required headings (exact text, see docs/PIPELINE_IO.md):`);
    for (const heading of requiredHeadings) {
      console.error(`  ${missing.includes(heading) ? 'MISSING' : 'ok     '}  ${heading}`);
    }
    console.error('');
    console.error('Headings actually found:');
    const found = lines.filter((l) => /^#{1,6}\s/.test(l));
    if (found.length === 0) {
      console.error('  (none)');
    } else {
      for (const h of found) console.error(`  ${h}`);
    }
    process.exit(1);
  }

  console.log(`${filePath}: all ${requiredHeadings.length} required heading(s) present.`);
}

main();
