/**
 * Automated Screenshot Capture for Staging Preview
 * Captures desktop and mobile viewports across public pages and CMS studio.
 */

const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = 'C:\\Users\\HUAWEI\\.gemini\\antigravity\\brain\\396847ea-25f9-4094-a805-2ea7638707db';
const SHOTS_DIR = path.join(ARTIFACT_DIR, 'screenshots');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!fs.existsSync(SHOTS_DIR)) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

async function capture() {
  console.log('Launching headless Chrome...');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });

  const pagesToCapture = [
    { url: 'http://localhost:3002/en', name: 'homepage-desktop', width: 1440, height: 900, fullPage: false },
    { url: 'http://localhost:3002/en', name: 'homepage-mobile', width: 375, height: 812, fullPage: false },
    { url: 'http://localhost:3002/en/pricing', name: 'pricing-desktop', width: 1440, height: 900, fullPage: false },
    { url: 'http://localhost:3002/en/pricing', name: 'pricing-mobile', width: 375, height: 812, fullPage: false },
    { url: 'http://localhost:3002/en/platform', name: 'platform-desktop', width: 1440, height: 900, fullPage: false },
    { url: 'http://localhost:3002/en/document-intelligence', name: 'document-intelligence-desktop', width: 1440, height: 900, fullPage: false },
    { url: 'http://localhost:3002/en/compliance', name: 'compliance-desktop', width: 1440, height: 900, fullPage: false },
    { url: 'http://localhost:3002/en/blog', name: 'hub-directory-desktop', width: 1440, height: 900, fullPage: false },
    { url: 'http://localhost:3002/en/blog/pt-pma-tax-compliance-guide-2026', name: 'hub-article-desktop', width: 1440, height: 900, fullPage: false },
    { url: 'http://localhost:3002/en/about', name: 'about-desktop', width: 1440, height: 900, fullPage: false },
    { url: 'http://localhost:3003/admin/', name: 'cms-studio-desktop', width: 1440, height: 900, fullPage: false, auth: { user: 'cfo-owner', pass: 'cfo-preview-2026' } }
  ];

  for (const item of pagesToCapture) {
    console.log(`Capturing ${item.name} (${item.width}x${item.height})...`);
    const context = await browser.newContext({
      viewport: { width: item.width, height: item.height },
      httpCredentials: item.auth ? { username: item.auth.user, password: item.auth.pass } : undefined
    });
    const page = await context.newPage();
    try {
      await page.goto(item.url, { waitUntil: 'networkidle', timeout: 15000 });
      // Small pause for fonts and CSS rendering
      await page.waitForTimeout(800);
      const outPath = path.join(SHOTS_DIR, `${item.name}.png`);
      await page.screenshot({ path: outPath, fullPage: item.fullPage });
      console.log(`✓ Saved ${outPath}`);
    } catch (err) {
      console.error(`Failed to capture ${item.name}:`, err.message);
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.log('Finished capturing all preview screenshots!');
}

capture().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
