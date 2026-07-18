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

module.exports = {
  SUPPRESSION_WINDOW_DAYS,
  SUPPRESSION_WINDOW_MS,
  extractAsin,
  loadNotifiedState,
  saveNotifiedState,
};
