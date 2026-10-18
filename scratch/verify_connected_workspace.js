const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

async function run() {
  console.log('--- STARTING CONNECTED FINANCIAL WORKSPACE VISUAL QA ---');

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

  // 1. Desktop 1440px — Initial Load (Default: CFO AI Web App)
  console.log('1. Verifying /en/platform at 1440px (Desktop Full & Connected Workspace Close-up)...');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });

  const cwSection = page.locator('#connected-workspace');
  await cwSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // Assert essential elements
  const heading = await page.locator('#connected-workspace h2').innerText();
  console.log(`  Section Heading: "${heading}"`);
  if (!heading.includes('Your Financial Data. One Intelligent System.')) {
    throw new Error(`Heading mismatch: ${heading}`);
  }

  // Capture close-up of connected workspace default state
  await cwSection.screenshot({ path: path.join(artifactDir, 'connected-workspace-1440px-default.png') });
  await cwSection.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-1440px-default.png') });

  // 2. Interactive Testing — Click Telegram Channel
  console.log('2. Testing Interactive Channel Selection: Telegram...');
  const telegramCard = page.locator('#cw-channel-telegram');
  await telegramCard.click();
  await page.waitForTimeout(400);

  const inspTitleTelegram = await page.locator('#cw-insp-title').innerText();
  const inspBadgeTelegram = (await page.locator('#cw-insp-badge').innerText()).trim().toUpperCase();
  console.log(`  Inspector Title: ${inspTitleTelegram}, Badge: ${inspBadgeTelegram}`);
  if (inspTitleTelegram !== 'Telegram' || inspBadgeTelegram !== 'AVAILABLE') {
    throw new Error(`Telegram inspector mismatch: ${inspTitleTelegram} / ${inspBadgeTelegram}`);
  }

  await cwSection.screenshot({ path: path.join(artifactDir, 'connected-workspace-telegram-active.png') });
  await cwSection.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-telegram-active.png') });

  // 3. Interactive Testing — Click Claude Channel
  console.log('3. Testing Interactive Channel Selection: Claude...');
  const claudeCard = page.locator('#cw-channel-claude');
  await claudeCard.click();
  await page.waitForTimeout(400);

  const inspTitleClaude = await page.locator('#cw-insp-title').innerText();
  const inspBadgeClaude = (await page.locator('#cw-insp-badge').innerText()).trim().toUpperCase();
  console.log(`  Inspector Title: ${inspTitleClaude}, Badge: ${inspBadgeClaude}`);
  if (inspTitleClaude !== 'Claude' || inspBadgeClaude !== 'IN DEVELOPMENT') {
    throw new Error(`Claude inspector mismatch: ${inspTitleClaude} / ${inspBadgeClaude}`);
  }

  await cwSection.screenshot({ path: path.join(artifactDir, 'connected-workspace-claude-active.png') });
  await cwSection.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-claude-active.png') });

  // 4. Interactive Testing — Click ChatGPT Channel
  console.log('4. Testing Interactive Channel Selection: ChatGPT...');
  const chatgptCard = page.locator('#cw-channel-chatgpt');
  await chatgptCard.click();
  await page.waitForTimeout(400);

  const inspTitleChatGPT = await page.locator('#cw-insp-title').innerText();
  const inspBadgeChatGPT = (await page.locator('#cw-insp-badge').innerText()).trim().toUpperCase();
  console.log(`  Inspector Title: ${inspTitleChatGPT}, Badge: ${inspBadgeChatGPT}`);
  if (inspTitleChatGPT !== 'ChatGPT' || inspBadgeChatGPT !== 'IN DEVELOPMENT') {
    throw new Error(`ChatGPT inspector mismatch: ${inspTitleChatGPT} / ${inspBadgeChatGPT}`);
  }

  // 5. Interactive Testing — Click WhatsApp Channel
  console.log('5. Testing Interactive Channel Selection: WhatsApp...');
  const whatsappCard = page.locator('#cw-channel-whatsapp');
  await whatsappCard.click();
  await page.waitForTimeout(400);

  const inspTitleWhatsApp = await page.locator('#cw-insp-title').innerText();
  const inspBadgeWhatsApp = (await page.locator('#cw-insp-badge').innerText()).trim().toUpperCase();
  console.log(`  Inspector Title: ${inspTitleWhatsApp}, Badge: ${inspBadgeWhatsApp}`);
  if (inspTitleWhatsApp !== 'WhatsApp' || inspBadgeWhatsApp !== 'PLANNED') {
    throw new Error(`WhatsApp inspector mismatch: ${inspTitleWhatsApp} / ${inspBadgeWhatsApp}`);
  }

  await cwSection.screenshot({ path: path.join(artifactDir, 'connected-workspace-whatsapp-active.png') });
  await cwSection.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-whatsapp-active.png') });

  // Reset to Web App for standard responsive captures
  const webappCard = page.locator('#cw-channel-webapp');
  await webappCard.click();
  await page.waitForTimeout(300);

  // 6. Laptop 1280px
  console.log('6. Verifying /en/platform at 1280px (Laptop)...');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });
  const cwSection1280 = page.locator('#connected-workspace');
  await cwSection1280.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await cwSection1280.screenshot({ path: path.join(artifactDir, 'connected-workspace-1280px.png') });
  await cwSection1280.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-1280px.png') });

  // 7. Tablet 768px
  console.log('7. Verifying /en/platform at 768px (Tablet)...');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });
  const cwSection768 = page.locator('#connected-workspace');
  await cwSection768.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await cwSection768.screenshot({ path: path.join(artifactDir, 'connected-workspace-768px.png') });
  await cwSection768.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-768px.png') });

  // 8. Mobile 390px
  console.log('8. Verifying /en/platform at 390px (Mobile)...');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });
  const cwSection390 = page.locator('#connected-workspace');
  await cwSection390.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await cwSection390.screenshot({ path: path.join(artifactDir, 'connected-workspace-390px.png') });
  await cwSection390.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-390px.png') });

  // 9. Indonesian Locale /id/platform
  console.log('9. Verifying /id/platform (Indonesian)...');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/id/platform`, { waitUntil: 'networkidle' });
  const cwSectionId = page.locator('#connected-workspace');
  await cwSectionId.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const headingId = await page.locator('#connected-workspace h2').innerText();
  console.log(`  ID Heading: "${headingId}"`);
  if (!headingId.includes('Data Keuangan Anda. Satu Sistem Cerdas.')) {
    throw new Error(`Indonesian heading mismatch: ${headingId}`);
  }
  await cwSectionId.screenshot({ path: path.join(artifactDir, 'connected-workspace-id-1440px.png') });
  await cwSectionId.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-id-1440px.png') });

  // 10. Russian Locale /ru/platform
  console.log('10. Verifying /ru/platform (Russian)...');
  await page.goto(`${BASE_URL}/ru/platform`, { waitUntil: 'networkidle' });
  const cwSectionRu = page.locator('#connected-workspace');
  await cwSectionRu.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const headingRu = await page.locator('#connected-workspace h2').innerText();
  console.log(`  RU Heading: "${headingRu}"`);
  if (!headingRu.includes('Ваши финансовые данные. Единый интеллект.')) {
    throw new Error(`Russian heading mismatch: ${headingRu}`);
  }
  await cwSectionRu.screenshot({ path: path.join(artifactDir, 'connected-workspace-ru-1440px.png') });
  await cwSectionRu.screenshot({ path: path.join(localScreenshotsDir, 'connected-workspace-ru-1440px.png') });

  // 11. Full page overview at 1440px (with new section in context)
  console.log('11. Capturing full page overview with connected workspace...');
  await page.goto(`${BASE_URL}/en/platform`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(artifactDir, 'platform-v4-full-1440px.png'), fullPage: true });
  await page.screenshot({ path: path.join(localScreenshotsDir, 'platform-v4-full-1440px.png'), fullPage: true });

  await browser.close();
  console.log('--- ALL CONNECTED WORKSPACE CHECKS PASSED SUCCESSFULLY! ---');
}

run().catch(err => {
  console.error('QA Test Failed:', err);
  process.exit(1);
});
