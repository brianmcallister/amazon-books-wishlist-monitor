const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const fs = require('fs');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const {
  loadNotifiedState,
  saveNotifiedState,
  partitionMatches,
  buildUpdatedState,
  pruneState,
  formatSuppressionSummary,
  isDryRun,
  formatDryRunMessage,
} = require('./notification-state');

const DEFAULT_WISHLIST_URL =
  'https://www.amazon.com/hz/wishlist/ls/9NVXER5P409J?type=wishlist&filter=unpurchased&sort=price-asc&viewType=list';

const WISHLIST_URL = process.env.WISHLIST_URL || DEFAULT_WISHLIST_URL;
const PRICE_THRESHOLD = Number(process.env.PRICE_THRESHOLD || 5);
const NOTIFIED_STATE_PATH = 'notified.json';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parsePrice(text) {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/\$?(\d+(?:\.\d{1,2})?)/);
  return match ? parseFloat(match[1]) : null;
}

function resolveUrl(href) {
  if (!href) return null;
  return href.startsWith('http') ? href : new URL(href, 'https://www.amazon.com').toString();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function scrapeWishlist(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900 });

    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log(`HTTP status: ${response.status()}`);
    console.log(`Final URL: ${page.url()}`);
    console.log(`Page title: ${await page.title()}`);

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
    if (/robot|captcha|automated access|unusual traffic|api-services-support/i.test(bodyText)) {
      console.log('WARNING: page body looks like a bot-check/CAPTCHA page, not the wishlist.');
      console.log(`Body text preview: ${bodyText.replace(/\s+/g, ' ').trim()}`);
    }

    // Amazon virtualizes the wishlist: items scrolled out of view can have their price
    // element unmounted before a single end-of-scroll read would catch it. So instead of
    // reading once at the bottom, we read at every scroll step and merge by item id,
    // keeping whichever pass actually saw a price.
    const extractCurrentItems = () =>
      page.evaluate(() => {
        const results = [];
        document.querySelectorAll('[id^="item_"]').forEach((el) => {
          const titleEl = el.querySelector('[id^="itemName_"]') || el.querySelector('a[href*="/dp/"]');
          const priceEl =
            el.querySelector('[id^="itemPrice_"]') ||
            el.querySelector('.a-price .a-offscreen') ||
            el.querySelector('[class*="price"]');
          if (!titleEl) return;
          results.push({
            id: el.id,
            title: titleEl.textContent.trim(),
            priceText: priceEl ? priceEl.textContent.trim() : null,
            href: titleEl.tagName === 'A' ? titleEl.getAttribute('href') : titleEl.closest('a')?.getAttribute('href'),
          });
        });
        return results;
      });

    const itemMap = new Map();
    const mergeItems = (found) => {
      for (const item of found) {
        const existing = itemMap.get(item.id);
        if (!existing || (existing.priceText === null && item.priceText !== null)) {
          itemMap.set(item.id, item);
        }
      }
    };

    const scrollAndCollect = async () => {
      mergeItems(await extractCurrentItems());

      let scrolled = 0;
      const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
      while (scrolled <= scrollHeight) {
        await page.evaluate((y) => window.scrollBy(0, y), 800);
        scrolled += 800;
        await new Promise((resolve) => setTimeout(resolve, 250));
        mergeItems(await extractCurrentItems());
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      mergeItems(await extractCurrentItems());

      // Scroll back to the top so items that got virtualized away during the descent
      // (in particular the cheapest ones, which sort first) get a final chance to
      // re-render with their price populated.
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      mergeItems(await extractCurrentItems());
    };

    await scrollAndCollect();
    console.log(`Unique items merged after first pass: ${itemMap.size}`);

    // Amazon's wishlist fetches live prices via a client-side API call that sometimes
    // fails outright for a subset of items (their own UI has a hidden "An error
    // occurred, please try again in a moment" alert for exactly this case). A reload
    // re-issues that call, so retry once for any item still missing a price.
    const missingAfterFirstPass = Array.from(itemMap.values()).filter((i) => i.priceText === null).length;
    if (missingAfterFirstPass > 0) {
      console.log(`${missingAfterFirstPass} item(s) still missing a price after first pass. Reloading and retrying once...`);
      await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await scrollAndCollect();
      const missingAfterRetry = Array.from(itemMap.values()).filter((i) => i.priceText === null).length;
      console.log(`${missingAfterRetry} item(s) still missing a price after retry.`);
    }

    if (process.env.SAVE_DEBUG_ARTIFACTS === 'true') {
      await page.screenshot({ path: 'wishlist-debug.png', fullPage: true });
      fs.writeFileSync('wishlist-debug.html', await page.content());
      console.log('Saved wishlist-debug.png and wishlist-debug.html');
    }

    return Array.from(itemMap.values()).map((item) => ({
      title: item.title,
      price: parsePrice(item.priceText),
      priceText: item.priceText,
      url: resolveUrl(item.href),
    }));
  } finally {
    await browser.close();
  }
}

async function sendEmail({ matches, totalScanned }) {
  const smtpHost = process.env.SMTP_HOST;

  // nodemailer resolves both A and AAAA records for the SMTP host and picks a RANDOM
  // address from the combined list to connect to -- it does not use Node's
  // dns.setDefaultResultOrder, so half the time it dials an IPv6 address, which
  // GitHub Actions runners often can't route (ENETUNREACH). Pre-resolve to a
  // specific IPv4 address ourselves and connect to that literal IP instead; nodemailer
  // skips its own DNS resolution entirely when given an IP. servername is set
  // explicitly so TLS/SNI still validates against the real hostname.
  let connectHost = smtpHost;
  let tlsOptions;
  try {
    const { address } = await dns.promises.lookup(smtpHost, { family: 4 });
    connectHost = address;
    tlsOptions = { servername: smtpHost };
    console.log(`Resolved ${smtpHost} to IPv4 ${address} for the SMTP connection.`);
  } catch (err) {
    console.log(`Could not resolve an IPv4 address for ${smtpHost} (${err.message}); connecting by hostname.`);
  }

  const transporter = nodemailer.createTransport({
    host: connectHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: tlsOptions,
  });

  const to = process.env.EMAIL_TO || 'brian@brianmcallister.com';
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  const textLines = matches.map((m) => `- ${m.title} -- $${m.price.toFixed(2)}\n  ${m.url}`).join('\n\n');
  const text = `${matches.length} book(s) on your wishlist are under $${PRICE_THRESHOLD}:\n\n${textLines}\n\nScanned ${totalScanned} items from ${WISHLIST_URL}`;

  const htmlItems = matches
    .map((m) => `<li><a href="${m.url}">${escapeHtml(m.title)}</a> &mdash; $${m.price.toFixed(2)}</li>`)
    .join('');
  const html = `<p>${matches.length} book(s) on your wishlist are under $${PRICE_THRESHOLD}:</p><ul>${htmlItems}</ul><p style="color:#888;font-size:12px">Scanned ${totalScanned} items from <a href="${WISHLIST_URL}">your wishlist</a>.</p>`;

  await transporter.sendMail({
    from,
    to,
    subject: `${matches.length} wishlist book${matches.length === 1 ? '' : 's'} under $${PRICE_THRESHOLD}`,
    text,
    html,
  });
}

(async () => {
  const items = await scrapeWishlist(WISHLIST_URL);
  console.log(`Scanned ${items.length} items.`);

  items.forEach((i) => {
    console.log(`  - "${i.title.slice(0, 70)}" raw="${i.priceText}" parsed=${i.price}`);
  });

  const priced = items.filter((i) => i.price !== null).sort((a, b) => a.price - b.price);
  const skipped = items.length - priced.length;
  if (skipped > 0) {
    console.log(`${skipped} item(s) had no parseable price and were excluded.`);
  }

  const matches = priced.filter((i) => i.price < PRICE_THRESHOLD);

  const notifiedState = loadNotifiedState(NOTIFIED_STATE_PATH);
  const now = new Date();
  const { freshMatches, suppressedMatches } = partitionMatches(matches, notifiedState, now);

  console.log(
    formatSuppressionSummary({
      totalMatches: matches.length,
      suppressedCount: suppressedMatches.length,
      freshCount: freshMatches.length,
      threshold: PRICE_THRESHOLD,
    })
  );

  if (isDryRun(process.env) && freshMatches.length > 0) {
    console.log(formatDryRunMessage(freshMatches.length));
    return;
  }

  if (freshMatches.length === 0) {
    console.log('No email sent (all matches already notified recently).');
    return;
  }

  await sendEmail({ matches: freshMatches, totalScanned: items.length });
  console.log('Email sent.');

  const updatedState = buildUpdatedState(notifiedState, freshMatches, now);
  const prunedState = pruneState(updatedState, now);
  saveNotifiedState(NOTIFIED_STATE_PATH, prunedState);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
