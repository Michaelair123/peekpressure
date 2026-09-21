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
    const page = await browser.newPage({ viewport });
    await page.route('**/api/chat**', route => route.abort('blockedbyclient'));
    await page.route('**/api/lead**', route => route.abort('blockedbyclient'));

    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => pageErrors.push(String(err)));

    await page.goto(START, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
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
      const pinRects = pins.map(rect).filter(Boolean);
      const pinOverflow = mapRect ? pinRects.some(p =>
        p.x < mapRect.x - 2 || p.y < mapRect.y - 2 ||
        p.right > mapRect.right + 2 || p.bottom > mapRect.bottom + 2
      ) : false;

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
        calendlyFrame: !!document.querySelector('iframe[src*="calendly.com"]'),
        quoteForm: !!document.querySelector('#quoteForm')
      };
    });

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
      if (!ok) failures.push({ viewport: viewport.name, check: name, state, consoleErrors, pageErrors });
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
