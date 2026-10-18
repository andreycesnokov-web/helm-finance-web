const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const artifactDir = path.resolve('C:/Users/HUAWEI/.gemini/antigravity/brain/396847ea-25f9-4094-a805-2ea7638707db/screenshots');
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  const localScreenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(localScreenshotsDir)) {
    fs.mkdirSync(localScreenshotsDir, { recursive: true });
  }

  const BASE_URL = 'http://localhost:3002';

  console.log('1. Verifying /en/platform at 1440px (Desktop Full & Workflow Close-up)...');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });

  // Full page
  await page.screenshot({ path: path.join(artifactDir, 'platform-v3-full-1440px.png'), fullPage: true });
  await page.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-full-1440px.png'), fullPage: true });

  // Close-up of How CFO AI Works
  const howItWorksSection = page.locator('section:has-text("One Financial System. From Action to Decision.")');
  await howItWorksSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await howItWorksSection.screenshot({ path: path.join(artifactDir, 'platform-v3-workflows-1440px.png') });
  await howItWorksSection.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-workflows-1440px.png') });

  // Floating CTA and footer close-up
  const ctaSection = page.locator('section:has-text("Ready to take command of your business finances?")');
  await ctaSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifactDir, 'platform-v3-cta-footer-1440px.png') });
  await page.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-cta-footer-1440px.png') });

  console.log('2. Verifying /en/platform at 1280px (Laptop)...');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });
  await howItWorksSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await howItWorksSection.screenshot({ path: path.join(artifactDir, 'platform-v3-workflows-1280px.png') });
  await howItWorksSection.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-workflows-1280px.png') });

  console.log('3. Verifying /en/platform at 768px (Tablet)...');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });
  await howItWorksSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await howItWorksSection.screenshot({ path: path.join(artifactDir, 'platform-v3-workflows-768px.png') });
  await howItWorksSection.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-workflows-768px.png') });

  console.log('4. Verifying /en/platform at 390px (Mobile)...');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });
  await howItWorksSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await howItWorksSection.screenshot({ path: path.join(artifactDir, 'platform-v3-workflows-390px.png') });
  await howItWorksSection.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-workflows-390px.png') });

  // Floating CTA on mobile
  await ctaSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(artifactDir, 'platform-v3-cta-footer-390px.png') });
  await page.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-cta-footer-390px.png') });

  console.log('5. Verifying /id/platform (Indonesian)...');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/id/platform`, { waitUntil: 'networkidle' });
  const howItWorksId = page.locator('section:has-text("Satu Sistem Keuangan. Dari Tindakan hingga Keputusan.")');
  await howItWorksId.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await howItWorksId.screenshot({ path: path.join(artifactDir, 'platform-v3-workflows-id-1440px.png') });
  await howItWorksId.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-workflows-id-1440px.png') });

  console.log('6. Verifying /ru/platform (Russian)...');
  await page.goto(`${BASE_URL}/ru/platform`, { waitUntil: 'networkidle' });
  const howItWorksRu = page.locator('section:has-text("Единая финансовая система. От действия к решению.")');
  await howItWorksRu.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await howItWorksRu.screenshot({ path: path.join(artifactDir, 'platform-v3-workflows-ru-1440px.png') });
  await howItWorksRu.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-workflows-ru-1440px.png') });

  console.log('7. Verifying Lightbox functionality on Multi-Entity module...');
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });
  const multiEntityCard = page.locator('#multi-company');
  await multiEntityCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const enlargeBtn = multiEntityCard.locator('button:has-text("Click to enlarge")');
  await enlargeBtn.click();
  await page.waitForTimeout(500);

  const lightboxModal = page.locator('#cfo-lightbox');
  const isVisible = await lightboxModal.isVisible();
  console.log(`Lightbox visible: ${isVisible}`);

  await page.screenshot({ path: path.join(artifactDir, 'platform-v3-lightbox-multientity.png') });
  await page.screenshot({ path: path.join(localScreenshotsDir, 'platform-v3-lightbox-multientity.png') });

  // Close lightbox
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await browser.close();
  console.log('Visual QA completed successfully!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
