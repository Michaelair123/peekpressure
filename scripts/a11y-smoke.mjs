import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const baseURL = process.env.A11Y_BASE_URL || 'https://peekpressure.com/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  locale: 'en-US',
  extraHTTPHeaders: {
    'Accept-Language': 'en-US,en;q=0.9'
  }
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', error => consoleErrors.push(error.message));

try {
  const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response || !response.ok()) throw new Error(`Homepage returned ${response?.status() ?? 'no response'}`);
  await page.waitForTimeout(1000);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const keyboard = await page.evaluate(() => {
    const focusables = [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),textarea,select,[tabindex]:not([tabindex="-1"])')];
    const missingNames = focusables.filter(el => {
      const name = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent || el.getAttribute('placeholder') || '').trim();
      return !name;
    });
    return {
      focusableCount: focusables.length,
      missingAccessibleNames: missingNames.slice(0, 20).map(el => ({ tag: el.tagName, id: el.id, cls: el.className }))
    };
  });

  const report = {
    url: page.url(),
    axeViolations: results.violations,
    axePasses: results.passes.length,
    incomplete: results.incomplete.length,
    keyboard,
    consoleErrors
  };

  console.log(JSON.stringify(report, null, 2));

  if (results.violations.length || keyboard.missingAccessibleNames.length || consoleErrors.length) {
    process.exitCode = 1;
  }
} finally {
  await context.close();
  await browser.close();
}
