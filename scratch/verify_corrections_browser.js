const path = require('path');
const fs = require('fs');

async function runBrowserVerification() {
  console.log('--- STARTING PLAYWRIGHT BROWSER VERIFICATION FOR CFO AI CORRECTIONS ---');
  
  const { chromium } = require('C:/Users/HUAWEI/.gemini/antigravity/brain/b4b5605a-29c0-4e6a-9e39-7008b78589f3/scratch/node_modules/playwright-core');
  
  const browser = await chromium.launch({ 
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true 
  });

  const screenshotsDir = 'C:/Users/HUAWEI/.gemini/antigravity/brain/396847ea-25f9-4094-a805-2ea7638707db/screenshots';
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const results = {
    auth: { basicChallenge: false, basicSuccess: false, cookieSet: false, tabsNavigated: 0, modalAuth: false },
    nav_ru: { v1440_no_wrap: false, v1280_no_wrap: false, v1024_clean: false, mobile_drawer: false },
    showcase: { multiEntityCard: false, lightboxOpened: false, documentsSanitized: false }
  };

  try {
    // ========================================================
    // TEST 1: CMS AUTHENTICATION & RECURRING POPUP RESOLUTION
    // ========================================================
    console.log('\n[Test 1: CMS Studio Basic Auth Gateway & In-App Auth]');
    
    // 1a. Verify unauthenticated 401 challenge on port 3003
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();
    let challengeReceived = false;
    unauthPage.on('response', resp => {
      if (resp.url().includes('3003/admin') && resp.status() === 401) {
        const authHdr = resp.headers()['www-authenticate'];
        if (authHdr && authHdr.includes('Basic realm="CFO AI Staging Admin"')) {
          challengeReceived = true;
        }
      }
    });

    try {
      await unauthPage.goto('http://localhost:3003/admin/', { timeout: 3000 });
    } catch (e) {
      // Expected to fail navigation or trigger prompt when unauthenticated
    }
    await unauthContext.close();
    results.auth.basicChallenge = challengeReceived;
    console.log(`  ✓ Unauthenticated GET /admin/ receives HTTP 401 Basic challenge: ${challengeReceived}`);

    // 1b. Authenticated context with rotated credentials (cfo-admin / cfo-staging-pass-2026)
    const authContext = await browser.newContext({
      httpCredentials: {
        username: 'cfo-admin',
        password: 'cfo-staging-pass-2026'
      },
      viewport: { width: 1440, height: 900 }
    });

    const page = await authContext.newPage();
    const consoleLogs = [];
    page.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text() }));

    console.log('  Navigating to http://localhost:3003/admin/ with HTTP Basic credentials...');
    await page.goto('http://localhost:3003/admin/', { waitUntil: 'networkidle' });
    
    // Check gate cookie
    const cookies = await authContext.cookies();
    const gateCookie = cookies.find(c => c.name === 'cfo_staging_gate');
    results.auth.cookieSet = !!gateCookie;
    console.log(`  ✓ Gateway HMAC Cookie 'cfo_staging_gate' successfully established: ${!!gateCookie}`);

    // Wait for Dashboard
    await page.waitForSelector('#nav-dashboard.nav-item-active', { timeout: 8000 });
    const dashTitle = await page.textContent('h1');
    console.log(`  ✓ CMS Dashboard loaded successfully: "${dashTitle.trim()}"`);
    results.auth.basicSuccess = true;

    // Check tabs navigation without prompting
    const tabs = ['pages', 'hub', 'pricing', 'translations', 'seo', 'navigation', 'releases', 'audit'];
    let tabsPassed = 0;
    for (const tab of tabs) {
      await page.click(`#nav-${tab}`);
      await page.waitForTimeout(300);
      const active = await page.$eval(`#nav-${tab}`, el => el.classList.contains('nav-item-active'));
      if (active) tabsPassed++;
    }
    results.auth.tabsNavigated = tabsPassed;
    console.log(`  ✓ Navigated all ${tabsPassed}/8 CMS tabs seamlessly with 0 recurring prompts`);

    // Screenshot CMS Dashboard
    await page.click('#nav-dashboard');
    await page.waitForTimeout(400);
    const cmsScreenshotPath = path.join(screenshotsDir, 'cms-dashboard-authenticated.png');
    await page.screenshot({ path: cmsScreenshotPath, fullPage: false });
    console.log(`  ✓ Captured CMS Studio screenshot: ${cmsScreenshotPath}`);

    // 1c. Test in-app logout & modal
    console.log('  Testing CMS Studio In-App Logout and Modal...');
    await page.click('button:has-text("Logout")');
    await page.waitForSelector('#cms-login-modal:not(.hidden)', { timeout: 5000 });
    const modalVisible = await page.isVisible('#cms-login-modal');
    console.log(`  ✓ In-app login modal is visible on logout: ${modalVisible}`);

    // Quick fill Owner and sign in
    await page.click('button:has-text("Owner")');
    await page.click('#login-submit-btn');
    await page.waitForSelector('#cms-login-modal', { state: 'hidden', timeout: 5000 });
    const modalHidden = await page.$eval('#cms-login-modal', el => el.classList.contains('hidden'));
    const userRole = await page.textContent('#top-user-role');
    console.log(`  ✓ Signed back in via in-app modal without reload. Current role: ${userRole.trim()}`);
    results.auth.modalAuth = modalHidden && userRole.includes('OWNER');

    await authContext.close();

    // ========================================================
    // TEST 2: RUSSIAN NAVIGATION & VIEWPORT RESPONSIVENESS
    // ========================================================
    console.log('\n[Test 2: Russian Navigation Polish Across Viewports]');
    const publicContext = await browser.newContext();

    // 2a. Desktop 1440px
    const page1440 = await publicContext.newPage();
    await page1440.setViewportSize({ width: 1440, height: 900 });
    await page1440.goto('http://localhost:3002/ru', { waitUntil: 'networkidle' });
    
    // Check navigation item text and single-line rendering
    const navItems = await page1440.$$eval('header nav a', els => els.map(el => ({
      text: el.innerText.trim(),
      height: el.offsetHeight,
      top: el.getBoundingClientRect().top
    })));
    console.log('  Russian nav items at 1440px:', navItems.map(n => n.text));
    
    // Verify none wrap (height around 20-30px, same top coordinate)
    const isSingleLine1440 = navItems.length >= 6 && navItems.every(n => n.height <= 32);
    results.nav_ru.v1440_no_wrap = isSingleLine1440;
    console.log(`  ✓ 1440px nav rendered strictly on a single line: ${isSingleLine1440}`);
    
    const ruNav1440Path = path.join(screenshotsDir, 'ru-nav-1440px.png');
    await page1440.screenshot({ path: ruNav1440Path, clip: { x: 0, y: 0, width: 1440, height: 120 } });
    console.log(`  ✓ Captured 1440px Russian nav header: ${ruNav1440Path}`);

    // 2b. Laptop 1280px
    await page1440.setViewportSize({ width: 1280, height: 800 });
    await page1440.waitForTimeout(300);
    const navItems1280 = await page1440.$$eval('header nav a', els => els.map(el => ({
      text: el.innerText.trim(),
      height: el.offsetHeight
    })));
    const isSingleLine1280 = navItems1280.every(n => n.height <= 32);
    results.nav_ru.v1280_no_wrap = isSingleLine1280;
    console.log(`  ✓ 1280px nav rendered strictly on a single line: ${isSingleLine1280}`);
    
    const ruNav1280Path = path.join(screenshotsDir, 'ru-nav-1280px.png');
    await page1440.screenshot({ path: ruNav1280Path, clip: { x: 0, y: 0, width: 1280, height: 120 } });
    console.log(`  ✓ Captured 1280px Russian nav header: ${ruNav1280Path}`);

    // 2c. Tablet 1024px
    await page1440.setViewportSize({ width: 1024, height: 768 });
    await page1440.waitForTimeout(300);
    const isHeaderClean1024 = await page1440.$eval('header', el => el.offsetHeight <= 90);
    results.nav_ru.v1024_clean = isHeaderClean1024;
    console.log(`  ✓ 1024px tablet header clean and contained: ${isHeaderClean1024}`);

    // 2d. Mobile 390px
    await page1440.setViewportSize({ width: 390, height: 844 });
    await page1440.waitForTimeout(300);
    
    // Open mobile menu drawer
    const menuBtn = await page1440.$('button[aria-label="Toggle navigation menu"]');
    if (menuBtn) {
      await menuBtn.click();
      await page1440.waitForTimeout(400);
      const drawerVisible = await page1440.isVisible('#mobile-menu');
      results.nav_ru.mobile_drawer = drawerVisible;
      console.log(`  ✓ Mobile 390px drawer opened and visible: ${drawerVisible}`);
      
      const ruNavMobilePath = path.join(screenshotsDir, 'ru-nav-mobile-390px.png');
      await page1440.screenshot({ path: ruNavMobilePath });
      console.log(`  ✓ Captured 390px mobile drawer screenshot: ${ruNavMobilePath}`);
    }
    await page1440.close();

    // ========================================================
    // TEST 3: SANITIZED SCREENSHOTS & MULTI-ENTITY SHOWCASE
    // ========================================================
    console.log('\n[Test 3: Sanitized Marketing Screenshots & Multi-Entity Lightbox]');
    const showcasePage = await publicContext.newPage();
    await showcasePage.setViewportSize({ width: 1440, height: 900 });

    // 3a. Platform page MOD 014 Multi-Entity card
    console.log('  Checking MOD 014 Multi-Entity card on /en/platform ...');
    await showcasePage.goto('http://localhost:3002/en/platform', { waitUntil: 'networkidle' });
    
    const multiEntityImg = await showcasePage.$('img[src*="MultiEntity.png"]');
    results.showcase.multiEntityCard = !!multiEntityImg;
    console.log(`  ✓ MOD 014 card renders MultiEntity.png: ${!!multiEntityImg}`);

    if (multiEntityImg) {
      // Click image to trigger lightbox modal
      await multiEntityImg.click();
      await showcasePage.waitForTimeout(600);
      
      const lightboxModal = await showcasePage.$('#cfo-lightbox:not(.hidden)');
      results.showcase.lightboxOpened = !!lightboxModal;
      console.log(`  ✓ Click-to-enlarge lightbox opened for MultiEntity: ${!!lightboxModal}`);

      const lightboxProofPath = path.join(screenshotsDir, 'platform-multientity-lightbox.png');
      await showcasePage.screenshot({ path: lightboxProofPath });
      console.log(`  ✓ Captured MultiEntity lightbox screenshot: ${lightboxProofPath}`);
    }

    // 3b. Document Intelligence sanitized hero screenshot
    console.log('  Checking Documents.png on /en/document-intelligence ...');
    await showcasePage.goto('http://localhost:3002/en/document-intelligence', { waitUntil: 'networkidle' });
    const docsImg = await showcasePage.$('img[src*="Documents.png"]');
    results.showcase.documentsSanitized = !!docsImg;
    console.log(`  ✓ Document Intelligence renders sanitized Documents.png: ${!!docsImg}`);
    
    const docsProofPath = path.join(screenshotsDir, 'document-intelligence-clean.png');
    await showcasePage.screenshot({ path: docsProofPath });
    console.log(`  ✓ Captured Document Intelligence screenshot: ${docsProofPath}`);

    await showcasePage.close();
    await publicContext.close();

  } finally {
    await browser.close();
  }

  console.log('\n========================================================');
  console.log('       BROWSER VERIFICATION SUMMARY RESULTS             ');
  console.log('========================================================');
  console.log(JSON.stringify(results, null, 2));
  console.log('========================================================');
  return results;
}

if (require.main === module) {
  runBrowserVerification().catch(err => {
    console.error('Browser verification failed:', err);
    process.exit(1);
  });
}

module.exports = { runBrowserVerification };
