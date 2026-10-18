const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const routes = [
    { url: 'http://localhost:3002/en', name: 'rc2-home-desktop' },
    { url: 'http://localhost:3002/en/pricing', name: 'rc2-pricing-desktop' },
    { url: 'http://localhost:3002/en/platform', name: 'rc2-platform-desktop' },
    { url: 'http://localhost:3002/en/about', name: 'rc2-about-desktop' },
    { url: 'http://localhost:3002/ru', name: 'rc2-home-ru-desktop' }
  ];

  for (const r of routes) {
    await page.goto(r.url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', `${r.name}.png`), fullPage: false });
    console.log(`Captured ${r.name}`);
  }

  // Mobile checks
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileRoutes = [
    { url: 'http://localhost:3002/en', name: 'rc2-home-mobile' },
    { url: 'http://localhost:3002/en/pricing', name: 'rc2-pricing-mobile' },
    { url: 'http://localhost:3002/en/about', name: 'rc2-about-mobile' }
  ];

  for (const r of mobileRoutes) {
    await page.goto(r.url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', `${r.name}.png`), fullPage: false });
    console.log(`Captured ${r.name}`);
  }

  await browser.close();
  console.log('All QA screenshots captured successfully.');
})();
