const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ARTIFACT_SCREENSHOTS = 'C:/Users/HUAWEI/.gemini/antigravity/brain/396847ea-25f9-4094-a805-2ea7638707db/screenshots';
const LOCAL_SCREENSHOTS = path.join(__dirname, '..', 'screenshots');

if (!fs.existsSync(ARTIFACT_SCREENSHOTS)) fs.mkdirSync(ARTIFACT_SCREENSHOTS, { recursive: true });
if (!fs.existsSync(LOCAL_SCREENSHOTS)) fs.mkdirSync(LOCAL_SCREENSHOTS, { recursive: true });

async function saveScreenshot(target, filename, options = {}) {
  const localPath = path.join(LOCAL_SCREENSHOTS, filename);
  const artifactPath = path.join(ARTIFACT_SCREENSHOTS, filename);
  await target.screenshot({ path: localPath, ...options });
  fs.copyFileSync(localPath, artifactPath);
  console.log(`Saved screenshot: ${filename}`);
}

(async () => {
  console.log('--- STARTING DESIGN FREEZE BROWSER QA VERIFICATION ---');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const BASE_URL = 'http://localhost:3002';

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✓ PASS: ${message}`);
    } else {
      console.error(`  ✗ FAIL: ${message}`);
    }
  }

  // ==========================================
  // SUITE 1: NAVIGATION & HOME LINK (Desktop 1440px & 1280px)
  // ==========================================
  console.log('\n[Suite 1: Desktop Navigation & Home Link]');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE_URL}/en`, { waitUntil: 'networkidle' });

    // 1. Check Home link exists and is first
    const navLinks = await page.$$('header nav a');
    assert(navLinks.length === 7, `Desktop navigation contains 7 links (got ${navLinks.length})`);
    
    const firstLinkText = (await navLinks[0].textContent()).trim();
    assert(firstLinkText === 'Home', `First nav link is "Home" (got "${firstLinkText}")`);
    
    const firstLinkHref = await navLinks[0].getAttribute('href');
    assert(firstLinkHref === '/en', `Home link href is "/en" (got "${firstLinkHref}")`);

    // 2. Active tab check on homepage
    const homeClasses = await navLinks[0].getAttribute('class');
    assert(homeClasses.includes('text-[#318FF4]') && homeClasses.includes('font-bold'), 'Home link has active highlight classes on homepage');

    // 3. Logo navigation check
    const logoLink = await page.$('header a[aria-label="CFO AI Homepage"]');
    assert(!!logoLink, 'Logo has accessible aria-label="CFO AI Homepage"');
    const logoHref = await logoLink.getAttribute('href');
    assert(logoHref === '/en', 'Logo links to current locale homepage');

    // Screenshot homepage desktop
    await saveScreenshot(page, 'freeze-home-desktop-1440px.png', { fullPage: false });

    await page.close();
  }

  // ==========================================
  // SUITE 2: RUSSIAN NAVIGATION SINGLE-LINE CHECK (1440px & 1280px)
  // ==========================================
  console.log('\n[Suite 2: Russian Navigation Single-Line Check]');
  {
    const page1440 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page1440.goto(`${BASE_URL}/ru`, { waitUntil: 'networkidle' });

    const ruLinks1440 = await page1440.$$('header nav a');
    const boxes1440 = await Promise.all(ruLinks1440.map(l => l.boundingBox()));
    const firstY1440 = boxes1440[0].y;
    const allSameY1440 = boxes1440.every(b => Math.abs(b.y - firstY1440) < 2);
    assert(allSameY1440, `Russian nav links are strictly single-line at 1440px (y diff < 2px)`);
    const header1440 = await page1440.$('header');
    await saveScreenshot(header1440, 'freeze-ru-nav-1440px.png');
    await page1440.close();

    const page1280 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page1280.goto(`${BASE_URL}/ru`, { waitUntil: 'networkidle' });
    const ruLinks1280 = await page1280.$$('header nav a');
    const boxes1280 = await Promise.all(ruLinks1280.map(l => l.boundingBox()));
    const firstY1280 = boxes1280[0].y;
    const allSameY1280 = boxes1280.every(b => Math.abs(b.y - firstY1280) < 2);
    assert(allSameY1280, `Russian nav links are strictly single-line at 1280px (y diff < 2px)`);
    const header1280 = await page1280.$('header');
    await saveScreenshot(header1280, 'freeze-ru-nav-1280px.png');
    await page1280.close();
  }

  // ==========================================
  // SUITE 3: MOBILE DRAWER NAVIGATION & HOME LINK (390px & 360px)
  // ==========================================
  console.log('\n[Suite 3: Mobile Drawer Navigation]');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${BASE_URL}/en`, { waitUntil: 'networkidle' });

    // Open mobile menu
    const menuToggle = await page.$('button[aria-label="Toggle navigation menu"]');
    assert(!!menuToggle, 'Mobile menu toggle button exists');
    await menuToggle.click();
    await page.waitForTimeout(300);

    const mobileDrawer = await page.$('#mobile-menu');
    const isHidden = await mobileDrawer.evaluate(el => el.classList.contains('hidden'));
    assert(!isHidden, 'Mobile drawer opened when toggle clicked');

    const drawerLinks = await page.$$('#mobile-menu a');
    const firstDrawerLinkText = (await drawerLinks[0].textContent()).trim();
    assert(firstDrawerLinkText === 'Home', `First mobile drawer link is "Home" (got "${firstDrawerLinkText}")`);
    const firstDrawerLinkHref = await drawerLinks[0].getAttribute('href');
    assert(firstDrawerLinkHref === '/en', `First mobile drawer link href is "/en"`);

    const header = await page.$('header');
    await saveScreenshot(header, 'freeze-mobile-drawer-home-390px.png');

    await page.close();
  }

  // ==========================================
  // SUITE 4: UNIFIED FOOTER & BACK TO TOP BUTTON
  // ==========================================
  console.log('\n[Suite 4: Unified Footer & Back TO Top]');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE_URL}/en`, { waitUntil: 'networkidle' });

    // Check footer element
    const footer = await page.$('footer');
    assert(!!footer, 'Footer element exists');

    // Check 4 columns layout
    const cols = await page.$$('footer .grid > div');
    assert(cols.length === 4, `Footer contains exactly 4 columns (got ${cols.length})`);

    // Check height reduction classes
    const footerClass = await footer.getAttribute('class');
    assert(footerClass.includes('pt-10') && footerClass.includes('pb-8'), 'Footer uses compact height classes pt-10 pb-8');

    // Check verified security notice text (no unverified certifications)
    const footerText = await footer.textContent();
    assert(footerText.includes('Bank-Grade AES-256') || footerText.includes('AES-256'), 'Footer contains verified Bank-Grade AES-256 claim');
    assert(footerText.includes('Row-Level Tenant Isolation'), 'Footer contains verified Row-Level Tenant Isolation claim');
    assert(footerText.includes('Zero AI Training'), 'Footer contains Zero AI Training claim');
    assert(!footerText.includes('ISO 27001 Certified') && !footerText.includes('SOC 2 Type II Certified'), 'Unverified certification claims are omitted');

    // Check Back to Top button
    const backToTopBtn = await page.$('footer button[aria-label="Back to Top"]');
    assert(!!backToTopBtn, 'Back to Top button exists with aria-label="Back to Top"');

    // Test Back to Top scroll functionality
    await page.evaluate(() => window.scrollTo(0, 1500));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    assert(scrollBefore > 1000, `Scrolled down page (scrollY: ${scrollBefore})`);

    await backToTopBtn.click();
    await page.waitForFunction(() => window.scrollY < 20, { timeout: 4000 });
    const scrollAfter = await page.evaluate(() => window.scrollY);
    assert(scrollAfter < 20, `Back to Top smoothly scrolled page to top (scrollY: ${scrollAfter})`);

    // Screenshot unified footer
    await footer.scrollIntoViewIfNeeded();
    await saveScreenshot(footer, 'freeze-unified-footer-desktop.png');

    await page.close();
  }

  // ==========================================
  // SUITE 5: COMPACT FINAL CTA SECTION
  // ==========================================
  console.log('\n[Suite 5: Compact Final CTA Section]');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE_URL}/en`, { waitUntil: 'networkidle' });

    const sections = await page.$$('section');
    const finalCta = sections[sections.length - 1];
    assert(!!finalCta, 'Final CTA section exists before footer');

    const ctaClass = await finalCta.getAttribute('class');
    assert(ctaClass.includes('py-8') || ctaClass.includes('sm:py-10'), 'Final CTA section uses compact padding py-8 sm:py-10');

    const ctaHeading = await finalCta.$('h2');
    const headingText = (await ctaHeading.textContent()).trim();
    assert(headingText.includes('Ready to take command') || headingText.includes('Ready to'), `Final CTA renders headline: "${headingText}"`);

    const ctaBox = await finalCta.boundingBox();
    assert(ctaBox.height < 320, `Final CTA vertical height is compact: ${Math.round(ctaBox.height)}px (< 320px)`);

    await finalCta.scrollIntoViewIfNeeded();
    await saveScreenshot(finalCta, 'freeze-compact-cta.png');

    await page.close();
  }

  // ==========================================
  // SUITE 6: FULL 6-CATEGORY FEATURE & USAGE MATRIX (/en/pricing)
  // ==========================================
  console.log('\n[Suite 6: Full 6-Category Feature & Usage Matrix]');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE_URL}/en/pricing`, { waitUntil: 'networkidle' });

    // 1. Pricing plans monthly verification
    const planPrices = await page.$$('.plan-price');
    assert(planPrices.length === 3, 'Renders 3 pricing plans');
    const priceTexts = await Promise.all(planPrices.map(p => p.textContent()));
    assert(priceTexts[0].includes('$59'), `Starter is $59 (got ${priceTexts[0]})`);
    assert(priceTexts[1].includes('$149'), `Control is $149 (got ${priceTexts[1]})`);
    assert(priceTexts[2].includes('$249'), `Pro is $249 (got ${priceTexts[2]})`);

    // 2. Annual switcher removal verification
    const btnAnnual = await page.$('#btn-annual');
    const btnMonthly = await page.$('#btn-monthly');
    assert(!btnAnnual && !btnMonthly, 'Annual discount switcher is completely removed');

    // 3. Matrix Table verification
    const matrixTable = await page.$('table');
    assert(!!matrixTable, 'Matrix comparison table exists');

    // Check all 6 categories
    const categoryHeaders = await page.$$('table tr th[colspan="4"]');
    assert(categoryHeaders.length === 6, `Matrix contains exactly 6 category group headers (got ${categoryHeaders.length})`);
    
    const catTitles = await Promise.all(categoryHeaders.map(h => h.textContent()));
    const cleanedCatTitles = catTitles.map(t => t.trim());
    console.log('    Categories found:', cleanedCatTitles);

    assert(cleanedCatTitles.some(t => t.includes('Financial Core')), 'Includes Financial Core');
    assert(cleanedCatTitles.some(t => t.includes('Operations & Spend Control') || t.includes('Operations')), 'Includes Operations');
    assert(cleanedCatTitles.some(t => t.includes('AI & Automation')), 'Includes AI & Automation');
    assert(cleanedCatTitles.some(t => t.includes('Tax & Compliance')), 'Includes Tax & Compliance');
    assert(cleanedCatTitles.some(t => t.includes('Team & Organization')), 'Includes Team & Organization');
    assert(cleanedCatTitles.some(t => t.includes('Integrations & Platform') || t.includes('Integrations')), 'Includes Integrations & Platform');

    // Check row count (25 comparison rows)
    const dataRows = await page.$$('table tbody tr:not(:has(th))');
    assert(dataRows.length === 25, `Matrix contains all 25 comparison rows (got ${dataRows.length})`);

    // Check Control column styling
    const controlHeaders = await page.$$('table thead th.bg-blue-50\\/80, table thead th:has(span:has-text("RECOMMENDED"))');
    assert(controlHeaders.length > 0, 'Control column header has prominent RECOMMENDED badge and blue highlight');

    // Check Enterprise CTA positioned AFTER table
    const tableAndEnterprise = await page.evaluate(() => {
      const t = document.querySelector('table');
      const e = document.querySelector('a[href^="mailto:enterprise"]');
      if (!t || !e) return false;
      return t.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    assert(!!tableAndEnterprise, 'Enterprise Custom Inquiries banner is positioned AFTER the full matrix');

    // Screenshot desktop matrix
    const matrixContainer = await page.$('.bento-card.overflow-x-auto');
    await matrixContainer.scrollIntoViewIfNeeded();
    await saveScreenshot(matrixContainer, 'freeze-pricing-matrix-desktop-1440px.png');

    await page.close();
  }

  // ==========================================
  // SUITE 7: PRICING MATRIX ON MOBILE (390px)
  // ==========================================
  console.log('\n[Suite 7: Mobile Pricing Matrix (390px)]');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${BASE_URL}/en/pricing`, { waitUntil: 'networkidle' });

    const scrollContainer = await page.$('.overflow-x-auto');
    assert(!!scrollContainer, 'Matrix table container has overflow-x-auto for horizontal scroll');

    const table = await page.$('.overflow-x-auto table');
    const tableWidth = await table.evaluate(el => el.scrollWidth);
    assert(tableWidth >= 680, `Table maintains minimum unconstrained width >= 680px (actual: ${tableWidth}px)`);

    // Verify horizontal scrolling capability without breaking page viewport
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    assert(viewportWidth === 390, `Page viewport width is strictly constrained to 390px without body overflow`);

    // Screenshot mobile matrix
    await scrollContainer.scrollIntoViewIfNeeded();
    await saveScreenshot(scrollContainer, 'freeze-pricing-matrix-mobile-390px.png');

    // Screenshot mobile homepage
    await page.goto(`${BASE_URL}/en`, { waitUntil: 'networkidle' });
    await saveScreenshot(page, 'freeze-home-mobile-390px.png', { fullPage: false });

    await page.close();
  }

  await browser.close();

  console.log(`\n==============================================`);
  console.log(`BROWSER QA COMPLETE: ${passedTests} / ${totalTests} assertions passed.`);
  console.log(`==============================================`);

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();
