const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

const DEFAULT_WISHLIST_URL =
  'https://www.amazon.com/hz/wishlist/ls/9NVXER5P409J?type=wishlist&filter=unpurchased&sort=price-asc&viewType=list';

const WISHLIST_URL = process.env.WISHLIST_URL || DEFAULT_WISHLIST_URL;
const PRICE_THRESHOLD = Number(process.env.PRICE_THRESHOLD || 5);
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

    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 800);
          total += 800;
          if (total > document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('[data-itemid]').forEach((el) => {
        const titleEl = el.querySelector('[id^="itemName_"]') || el.querySelector('a[href*="/dp/"]');
        const priceEl =
          el.querySelector('[id^="itemPrice_"]') ||
          el.querySelector('.a-price .a-offscreen') ||
          el.querySelector('[class*="price"]');
        if (!titleEl) return;
        results.push({
          title: titleEl.textContent.trim(),
          priceText: priceEl ? priceEl.textContent.trim() : null,
          href: titleEl.tagName === 'A' ? titleEl.getAttribute('href') : titleEl.closest('a')?.getAttribute('href'),
        });
      });
      return results;
    });

    return items.map((item) => ({
      title: item.title,
      price: parsePrice(item.priceText),
      url: resolveUrl(item.href),
    }));
  } finally {
    await browser.close();
  }
}

async function sendEmail({ matches, totalScanned }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
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

  const priced = items.filter((i) => i.price !== null).sort((a, b) => a.price - b.price);
  const skipped = items.length - priced.length;
  if (skipped > 0) {
    console.log(`${skipped} item(s) had no parseable price and were excluded.`);
  }

  const matches = priced.filter((i) => i.price < PRICE_THRESHOLD);
  console.log(`${matches.length} item(s) under $${PRICE_THRESHOLD}.`);

  if (matches.length === 0) {
    console.log('No email sent.');
    return;
  }

  await sendEmail({ matches, totalScanned: items.length });
  console.log('Email sent.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
