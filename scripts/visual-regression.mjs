import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const START = process.env.CRAWL_URL || 'https://peekpressure.com/';
const TIMEOUT = Number(process.env.TIMEOUT_MS || 20000);
const viewports = [
  { name: 'desktop', width: 1440, height: 1000, isMobile: false, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
];

const browser = await chromium.launch({ headless: true });
const failures = [];

try {
  for (const viewport of viewports) {
    const userAgent = viewport.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    const page = await browser.newPage({ viewport, userAgent, locale: 'en-US', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } });
    await page.route('**/api/chat**', route => route.abort('blockedbyclient'));
    await page.route('**/api/lead**', route => route.abort('blockedbyclient'));

    const consoleErrors = [];
    const failedRequests = [];
    page.on('response', response => {
      if (response.status() >= 400) failedRequests.push({ status: response.status(), url: response.url() });
    });
    const pageErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => pageErrors.push(String(err)));

    const response = await page.goto(START, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    if (!response || !response.ok()) {
      throw new Error(`Homepage returned ${response?.status() ?? 'no response'} for ${START}`);
    }
    await page.waitForTimeout(1200);

    const state = await page.evaluate(() => {
      const rect = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom };
      };
      const map = document.querySelector('#peekServiceMap');
      const pins = [...document.querySelectorAll('#peekServiceMap .peek-map-pin')];
      const mapRect = rect(map);
      const pinRects = pins.map((pin, index) => ({
        index,
        rect: rect(pin),
        label: pin.getAttribute('aria-label') || pin.querySelector('[aria-label]')?.getAttribute('aria-label') || null
      }));
      const overflowingPins = mapRect
        ? pinRects.filter(({ rect: p }) => p && (
            p.x < mapRect.x - 2 || p.y < mapRect.y - 2 ||
            p.right > mapRect.right + 2 || p.bottom > mapRect.bottom + 2
          ))
        : [];
      const pinOverflow = overflowingPins.length > 0;

      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
        launcher: !!document.querySelector('#peekChatLauncher'),
        chat: !!document.querySelector('#peekChat'),
        map: !!map,
        mapSize: mapRect ? { width: mapRect.width, height: mapRect.height } : null,
        pinCount: pinRects.length,
        pinOverflow,
        overflowingPins,
        calendlyFrame: !!document.querySelector('iframe[src*="calendly.com"]'),
        quoteForm: !!document.querySelector('#quoteForm')
      };
    });

    if (!state.launcher || !state.map || !state.quoteForm) {
      failures.push({ viewport: viewport.name, check: 'diagnostic: expected page shell missing', state, consoleErrors, pageErrors, failedRequests, bodyText: await page.locator('body').innerText().catch(() => '') });
      await page.close();
      continue;
    }

    const screenshot = `visual-${viewport.name}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });

    const checks = [
      ['no horizontal overflow', !state.horizontalOverflow],
      ['Lucy launcher exists', state.launcher],
      ['Lucy panel exists', state.chat],
      ['service map exists', state.map],
      ['service map has usable size', !!state.mapSize && state.mapSize.width > 250 && state.mapSize.height > 250],
      ['map pins stay inside map', !state.pinOverflow],
      ['quote form exists', state.quoteForm],
      ['no console errors', consoleErrors.length === 0],
      ['no page errors', pageErrors.length === 0],
    ];

    for (const [name, ok] of checks) {
      if (!ok) failures.push({ viewport: viewport.name, check: name, state, consoleErrors, pageErrors, failedRequests });
    }

    await page.close();
  }
} catch (error) {
  failures.push({ viewport: 'global', check: 'visual smoke execution', error: String(error) });
} finally {
  await browser.close();
}

const report = {
  url: START,
  generatedAt: new Date().toISOString(),
  failures,
  passed: failures.length === 0
};

await fs.writeFile('visual-regression-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (failures.length) process.exitCode = 1;
