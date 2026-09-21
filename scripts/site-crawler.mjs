import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { URL } from 'node:url';

const START = process.env.CRAWL_URL || 'https://peekpressure.com/';
const MAX_PAGES = Number(process.env.MAX_PAGES || 25);
const TIMEOUT = Number(process.env.TIMEOUT_MS || 20000);
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1440, height: 1000 };

const sameOrigin = (a, b) => new URL(a).origin === new URL(b).origin;
const normalize = href => {
  try {
    const u = new URL(href, START);
    u.hash = '';
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.href.replace(/\/$/, '') || u.origin;
  } catch { return null; }
};

const results = {
  startedAt: new Date().toISOString(),
  start: START,
  pages: [],
  links: [],
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  summary: {}
};

const browser = await chromium.launch({ headless: true });
const queue = [START.replace(/\/$/, '')];
const seen = new Set();

try {
  while (queue.length && seen.size < MAX_PAGES) {
    const target = queue.shift();
    if (seen.has(target)) continue;
    seen.add(target);

    const page = await browser.newPage({ viewport: DESKTOP });
    const errors = [];
    const pageErrors = [];
    const requestFailures = [];

    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => pageErrors.push(String(err)));
    page.on('requestfailed', req => requestFailures.push({
      url: req.url(),
      error: req.failure()?.errorText || 'unknown'
    }));

    const started = Date.now();
    let response;
    try {
      response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(700);
    } catch (error) {
      results.pages.push({ url: target, ok: false, error: String(error), ms: Date.now() - started });
      await page.close();
      continue;
    }

    const data = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href]')].map(a => ({
        href: a.href,
        text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)
      }));
      const forms = [...document.forms].map(form => ({
        action: form.action,
        method: form.method,
        id: form.id || null,
        inputs: [...form.elements].filter(e => e.name || e.id).map(e => ({
          tag: e.tagName.toLowerCase(), name: e.name || null, id: e.id || null,
          type: e.type || null, autocomplete: e.autocomplete || null
        }))
      }));
      return {
        title: document.title,
        h1: [...document.querySelectorAll('h1')].map(x => x.textContent.trim()),
        links,
        forms,
        images: [...document.images].map(img => ({
          src: img.currentSrc || img.src,
          alt: img.alt,
          complete: img.complete,
          naturalWidth: img.naturalWidth
        })),
        hasViewport: !!document.querySelector('meta[name="viewport"]'),
        lang: document.documentElement.lang || null
      };
    });

    const pageResult = {
      url: target,
      status: response?.status() ?? null,
      ok: !!response?.ok(),
      title: data.title,
      h1Count: data.h1.length,
      h1: data.h1,
      hasViewport: data.hasViewport,
      lang: data.lang,
      brokenImages: data.images.filter(x => !x.complete || x.naturalWidth === 0),
      forms: data.forms,
      consoleErrors: errors,
      pageErrors,
      requestFailures,
      ms: Date.now() - started
    };
    results.pages.push(pageResult);
    results.consoleErrors.push(...errors.map(error => ({ url: target, error })));
    results.pageErrors.push(...pageErrors.map(error => ({ url: target, error })));
    results.requestFailures.push(...requestFailures.map(x => ({ page: target, ...x })));

    for (const link of data.links) {
      const href = normalize(link.href);
      if (!href) continue;
      results.links.push({ from: target, to: href, text: link.text });
      if (sameOrigin(href, START) && !seen.has(href) && queue.length < MAX_PAGES * 2) queue.push(href);
    }

    await page.close();
  }

  // Dedicated mobile smoke test for the homepage.
  const mobile = await browser.newPage({ viewport: MOBILE });
  const mobileErrors = [];
  mobile.on('console', msg => { if (msg.type() === 'error') mobileErrors.push(msg.text()); });
  mobile.on('pageerror', err => mobileErrors.push(String(err)));
  try {
    await mobile.goto(START, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await mobile.waitForTimeout(700);
    const mobileCheck = await mobile.evaluate(() => {
      const launcher = document.querySelector('#peekChatLauncher');
      const chat = document.querySelector('#peekChat');
      const zip = document.querySelector('#serviceZipForm');
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        lucyLauncher: !!launcher,
        lucyChat: !!chat,
        zipChecker: !!zip,
        quoteForm: !!document.querySelector('#quoteForm')
      };
    });
    results.mobile = { ...mobileCheck, consoleErrors: mobileErrors };
  } catch (error) {
    results.mobile = { error: String(error) };
  }
  await mobile.close();
} finally {
  await browser.close();
}

const unique = arr => [...new Set(arr)];
results.summary = {
  pagesCrawled: results.pages.length,
  failedPages: results.pages.filter(x => !x.ok).length,
  badHttpPages: results.pages.filter(x => x.status !== null && x.status >= 400).length,
  consoleErrors: results.consoleErrors.length,
  pageErrors: results.pageErrors.length,
  requestFailures: results.requestFailures.length,
  brokenImages: results.pages.reduce((n, p) => n + (p.brokenImages?.length || 0), 0),
  horizontalOverflowMobile: results.mobile?.horizontalOverflow === true,
  mobileSmokePassed: !!results.mobile && !results.mobile.error && results.mobile.horizontalOverflow === false &&
    results.mobile.lucyLauncher && results.mobile.lucyChat && results.mobile.zipChecker && results.mobile.quoteForm
};

await fs.writeFile('site-crawl-report.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.summary, null, 2));

if (
  results.summary.failedPages ||
  results.summary.badHttpPages ||
  results.summary.consoleErrors ||
  results.summary.pageErrors ||
  results.summary.requestFailures ||
  results.summary.brokenImages ||
  results.summary.horizontalOverflowMobile ||
  !results.summary.mobileSmokePassed
) process.exitCode = 1;
