const fs = require('fs');

const SUPPRESSION_WINDOW_DAYS = 14;
const SUPPRESSION_WINDOW_MS = SUPPRESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function extractAsin(url) {
  const match = url.match(/\/dp\/([A-Z0-9]{10})/);
  return match ? match[1] : url;
}

function loadNotifiedState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function saveNotifiedState(filePath, state) {
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function isSuppressed(notifiedAtIso, now) {
  const notifiedAt = new Date(notifiedAtIso).getTime();
  if (Number.isNaN(notifiedAt)) return false;
  return now.getTime() - notifiedAt < SUPPRESSION_WINDOW_MS;
}

function isDryRun(env) {
  return env.DRY_RUN === 'true';
}

function partitionMatches(matches, state, now) {
  const freshMatches = [];
  const suppressedMatches = [];
  for (const match of matches) {
    const asin = extractAsin(match.url);
    const notifiedAt = state[asin];
    if (notifiedAt && isSuppressed(notifiedAt, now)) {
      suppressedMatches.push(match);
    } else {
      freshMatches.push(match);
    }
  }
  return { freshMatches, suppressedMatches };
}

function buildUpdatedState(state, freshMatches, now) {
  const updated = { ...state };
  const nowIso = now.toISOString();
  for (const match of freshMatches) {
    updated[extractAsin(match.url)] = nowIso;
  }
  return updated;
}

function pruneState(state, now) {
  const pruned = {};
  for (const [asin, notifiedAtIso] of Object.entries(state)) {
    if (isSuppressed(notifiedAtIso, now)) {
      pruned[asin] = notifiedAtIso;
    }
  }
  return pruned;
}

function formatSuppressionSummary({ totalMatches, suppressedCount, freshCount, threshold }) {
  return `${totalMatches} item(s) under $${threshold}. ${suppressedCount} already notified within 14 days, suppressed. ${freshCount} fresh match(es).`;
}

module.exports = {
  SUPPRESSION_WINDOW_DAYS,
  SUPPRESSION_WINDOW_MS,
  extractAsin,
  loadNotifiedState,
  saveNotifiedState,
  isSuppressed,
  partitionMatches,
  buildUpdatedState,
  pruneState,
  formatSuppressionSummary,
  isDryRun,
};
