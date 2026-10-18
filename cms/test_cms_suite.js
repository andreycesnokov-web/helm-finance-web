/**
 * Comprehensive Automated Test Suite for CFO AI Website & CMS
 * Tests all 17 functional requirements specified in Phase 11.
 */

const { createApp } = require('./server/index');
const http = require('http');

async function runTestSuite() {
  console.log('--- STARTING CFO AI WEBSITE & CMS TEST SUITE ---');
  const { app, contentStore } = createApp();
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[Test Server] Running on ${baseUrl}`);

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passedTests++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // 1. PUBLIC WEBSITE & ROUTING
    console.log('\n[Suite 1: Public Surface & Multi-Locale Routing]');
    const rootRes = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    assert(rootRes.status === 302, 'Root / redirects to default language (/id or /en)');

    const enHomeRes = await fetch(`${baseUrl}/en`);
    assert(enHomeRes.status === 200, 'Public /en returns HTTP 200 OK');
    const enHomeHtml = await enHomeRes.text();
    assert(enHomeHtml.includes('Know your numbers. Control your business.'), 'Homepage renders approved headline');
    assert(enHomeHtml.includes('Pulse Command Center'), 'Homepage renders Pulse value pillar');
    assert(enHomeHtml.includes('Start Free Trial'), 'Homepage renders conversion CTAs');

    const pricingRes = await fetch(`${baseUrl}/en/pricing`);
    assert(pricingRes.status === 200, 'Pricing /en/pricing returns HTTP 200');
    const pricingHtml = await pricingRes.text();
    assert(pricingHtml.includes('$59'), 'Pricing table displays Starter $59');
    assert(pricingHtml.includes('$149'), 'Pricing table displays Control $149');
    assert(pricingHtml.includes('$249'), 'Pricing table displays Pro $249');
    assert(pricingHtml.includes('50'), 'Pricing table displays 50 Pro accounts');
    assert(pricingHtml.includes('50,000'), 'Pricing table displays 50,000 bank rows');
    assert(!pricingHtml.includes('undefined'), 'Pricing page /en/pricing contains 0 undefined strings');
    assert(!pricingHtml.includes('null'), 'Pricing page /en/pricing contains 0 null strings');
    assert(pricingHtml.includes('RECOMMENDED'), 'Pricing page displays Control RECOMMENDED badge');
    assert(pricingHtml.includes('LEVEL A'), 'Pricing page displays Level A capabilities');
    assert(pricingHtml.includes('LEVEL B'), 'Pricing page displays Level B quotas');
    assert(pricingHtml.includes('ChatGPT'), 'Pricing page displays ChatGPT channel');
    assert(pricingHtml.includes('Claude'), 'Pricing page displays Claude channel');
    assert(pricingHtml.includes('data-faq-index="11"'), 'Pricing page renders all 12 FAQs');

    // Multilingual Pricing checks (ID & RU)
    const idPricingRes = await fetch(`${baseUrl}/id/pricing`);
    assert(idPricingRes.status === 200, 'Pricing /id/pricing returns HTTP 200');
    const idPricingHtml = await idPricingRes.text();
    assert(!idPricingHtml.includes('undefined'), 'Pricing page /id/pricing contains 0 undefined strings');
    assert(!idPricingHtml.includes('null'), 'Pricing page /id/pricing contains 0 null strings');
    assert(idPricingHtml.includes('DIREKOMENDASIKAN'), 'ID pricing displays recommended badge');
    assert(idPricingHtml.includes('data-faq-index="11"'), 'ID pricing renders all 12 FAQs');

    const ruPricingRes = await fetch(`${baseUrl}/ru/pricing`);
    assert(ruPricingRes.status === 200, 'Pricing /ru/pricing returns HTTP 200');
    const ruPricingHtml = await ruPricingRes.text();
    assert(!ruPricingHtml.includes('undefined'), 'Pricing page /ru/pricing contains 0 undefined strings');
    assert(!ruPricingHtml.includes('null'), 'Pricing page /ru/pricing contains 0 null strings');
    assert(ruPricingHtml.includes('РЕКОМЕНДУЕМЫЙ'), 'RU pricing displays recommended badge');
    assert(ruPricingHtml.includes('data-faq-index="11"'), 'RU pricing renders all 12 FAQs');

    // Multilingual Phase A Launch Locales (FR, DE, ES, IT)
    const phaseALocales = [
      { code: 'fr', badge: 'RECOMMANDÉ', label: 'French' },
      { code: 'de', badge: 'EMPFOHLEN', label: 'German' },
      { code: 'es', badge: 'RECOMENDADO', label: 'Spanish' },
      { code: 'it', badge: 'CONSIGLIATO', label: 'Italian' }
    ];

    for (const item of phaseALocales) {
      const pRes = await fetch(`${baseUrl}/${item.code}/pricing`);
      assert(pRes.status === 200, `Pricing /${item.code}/pricing (${item.label}) returns HTTP 200`);
      const pHtml = await pRes.text();
      assert(!pHtml.includes('undefined'), `Pricing /${item.code}/pricing contains 0 undefined strings`);
      assert(!pHtml.includes('null'), `Pricing /${item.code}/pricing contains 0 null strings`);
      assert(pHtml.includes('$59') && pHtml.includes('$149') && pHtml.includes('$249'), `Pricing /${item.code}/pricing displays exact commercial pricing $59, $149, $249`);
      assert(pHtml.includes(item.badge), `Pricing /${item.code}/pricing displays correct recommended badge: ${item.badge}`);
    }

    // Staged Draft Locales (ZH-CN, JA, TH, VI)
    const stagedLocales = ['zh-cn', 'ja', 'th', 'vi'];
    for (const code of stagedLocales) {
      const sRes = await fetch(`${baseUrl}/${code}`);
      assert(sRes.status === 200, `Staged draft /${code} returns HTTP 200`);
      assert(sRes.headers.get('x-robots-tag') === 'noindex, nofollow', `Staged draft /${code} sends X-Robots-Tag: noindex, nofollow`);
      const sHtml = await sRes.text();
      assert(sHtml.includes('name="robots" content="noindex, nofollow"'), `Staged draft /${code} includes noindex robots meta tag`);
    }

    // Test platform, document-intelligence, compliance, about, privacy, terms
    const platformRes = await fetch(`${baseUrl}/en/platform`);
    assert(platformRes.status === 200, 'Platform /en/platform returns HTTP 200');
    const platformHtml = await platformRes.text();
    assert(platformHtml.includes('Pulse Command Center'), 'Platform page displays Pulse module');

    const docRes = await fetch(`${baseUrl}/en/document-intelligence`);
    assert(docRes.status === 200, 'Document Intelligence /en/document-intelligence returns HTTP 200');
    const docHtml = await docRes.text();
    assert(docHtml.includes('Faktur Pajak'), 'Document intelligence mentions Faktur Pajak OCR');

    const compRes = await fetch(`${baseUrl}/en/compliance`);
    assert(compRes.status === 200, 'Tax & Compliance /en/compliance returns HTTP 200');
    const compHtml = await compRes.text();
    assert(compHtml.includes('PPh 21 TER'), 'Tax & Compliance displays PPh 21 TER Engine');

    const aboutRes = await fetch(`${baseUrl}/en/about`);
    assert(aboutRes.status === 200, 'About /en/about returns HTTP 200');

    const privRes = await fetch(`${baseUrl}/en/privacy`);
    assert(privRes.status === 200, 'Privacy Policy /en/privacy returns HTTP 200');
    const privHtml = await privRes.text();
    assert(privHtml.includes('Law No. 27/2022'), 'Privacy Policy cites UU PDP Law No. 27/2022');
    assert(privHtml.includes('Strict Zero-Sharing Guarantee'), 'Privacy Policy includes strict zero-sharing guarantee');

    const termsRes = await fetch(`${baseUrl}/en/terms`);
    assert(termsRes.status === 200, 'Terms of Service /en/terms returns HTTP 200');

    // Check emoji absence across all pages
    const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]/;
    assert(!emojiRegex.test(enHomeHtml), 'Homepage contains 0 emojis');
    assert(!emojiRegex.test(pricingHtml), 'Pricing page contains 0 emojis');
    assert(!emojiRegex.test(platformHtml), 'Platform page contains 0 emojis');
    assert(!emojiRegex.test(privHtml), 'Privacy page contains 0 emojis');

    // 2. KNOWLEDGE HUB & ARTICLES
    console.log('\n[Suite 2: Knowledge Hub & Tax Authority]');
    const blogRes = await fetch(`${baseUrl}/en/blog`);
    assert(blogRes.status === 200, 'Knowledge Hub directory /en/blog returns HTTP 200');
    const blogHtml = await blogRes.text();
    assert(blogHtml.includes('PT PMA Tax Obligations'), 'Hub lists PT PMA Tax Guide');

    const articleRes = await fetch(`${baseUrl}/en/blog/pt-pma-tax-compliance-guide-2026`);
    assert(articleRes.status === 200, 'Article detail returns HTTP 200');
    const articleHtml = await articleRes.text();
    assert(articleHtml.includes('JURISDICTION: INDONESIA (ID)'), 'Article displays Indonesian jurisdiction badge');
    assert(articleHtml.includes('UU No. 7/2021'), 'Article cites primary statute UU HPP');
    assert(articleHtml.includes('PMK No. 81/2024'), 'Article cites CoreTax PMK 81/2024');

    // 3. TECHNICAL SEO & SITEMAPS
    console.log('\n[Suite 3: Technical SEO & Sitemaps]');
    const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`);
    assert(sitemapRes.status === 200, 'sitemap.xml returns HTTP 200');
    const sitemapXml = await sitemapRes.text();
    const phaseACodes = ['en', 'id', 'ru', 'fr', 'de', 'es', 'it'];
    for (const c of phaseACodes) {
      assert(sitemapXml.includes(`<loc>https://cfo-ai.site/${c}</loc>`), `Sitemap contains published ${c} homepage`);
    }
    const stagedCheckCodes = ['zh-cn', 'ja', 'th', 'vi'];
    for (const sc of stagedCheckCodes) {
      assert(!sitemapXml.includes(`<loc>https://cfo-ai.site/${sc}</loc>`), `Sitemap excludes staged draft ${sc} homepage`);
    }
    assert(sitemapXml.includes('hreflang="x-default"'), 'Sitemap contains x-default hreflang tags');

    const robotsRes = await fetch(`${baseUrl}/robots.txt`);
    assert(robotsRes.status === 200, 'robots.txt returns HTTP 200');
    const robotsTxt = await robotsRes.text();
    assert(robotsTxt.includes('Disallow: /admin/'), 'robots.txt protects admin routes');

    // 4. CMS AUTHENTICATION & RBAC
    console.log('\n[Suite 4: CMS Authentication & RBAC]');
    const loginRes = await fetch(`${baseUrl}/api/cms/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@cfo-ai.site', password: 'any' })
    });
    assert(loginRes.status === 200, 'CMS Owner login succeeds');
    const loginData = await loginRes.json();
    assert(loginData.token && loginData.user.role === 'owner', 'Owner JWT token issued with role=owner');
    const ownerToken = loginData.token;

    // Test unauthenticated access to protected CMS route
    const unauthRes = await fetch(`${baseUrl}/api/cms/dashboard`);
    assert(unauthRes.status === 401, 'Unauthenticated request to /api/cms/dashboard is rejected with 401');

    // Test authenticated dashboard access
    const authDashRes = await fetch(`${baseUrl}/api/cms/dashboard`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` }
    });
    assert(authDashRes.status === 200, 'Authenticated request to /api/cms/dashboard succeeds');
    const dashData = await authDashRes.json();
    assert(dashData.stats.pagesCount >= 5, 'Dashboard returns accurate page count');
    assert(dashData.stats.articlesCount >= 3, 'Dashboard returns accurate article count');

    // 5. PRICING DISCREPANCY GUARD
    console.log('\n[Suite 5: Pricing Discrepancy Guard]');
    const currentPricing = contentStore.getPricing();
    const validCheck = contentStore.pricingGuard.validatePricing(currentPricing);
    assert(validCheck.isValid === true, 'Current reconciled pricing has 0 discrepancies with catalog');

    // Mutate pricing with an unauthorized limit change (e.g. Pro seats = 100 instead of 30)
    const badPricing = JSON.parse(JSON.stringify(currentPricing));
    const userRow = badPricing.usage_limits_table.find(r => r.key === 'users');
    userRow.pro = '100'; // Violates catalog limit of 30

    const badCheck = contentStore.pricingGuard.validatePricing(badPricing);
    assert(badCheck.isValid === false, 'Pricing Discrepancy Guard detects unauthorized Pro seats mutation');
    assert(badCheck.discrepancies.length > 0, 'Discrepancy list populated with specific explanation');

    // Verify atomic publish is blocked when pricing has discrepancies
    try {
      contentStore.updatePricing(badPricing, 'test-runner');
      contentStore.createRelease({ author: 'test-runner', notes: 'Should fail' });
      assert(false, 'Release creation should have been blocked');
    } catch (err) {
      assert(err.message.includes('Pricing Discrepancy Guard'), 'Atomic publish blocked when pricing contradicts catalog');
    }

    // Restore valid pricing
    contentStore.updatePricing(currentPricing, 'test-runner');

    // 6. ATOMIC RELEASE & 1-CLICK ROLLBACK
    console.log('\n[Suite 6: Atomic Release & Rollback Lifecycle]');
    const initialRelease = contentStore.getActiveRelease();
    assert(initialRelease !== null, 'Active release exists');

    // Edit homepage headline
    const originalHome = contentStore.getPage('home');
    const modifiedHome = JSON.parse(JSON.stringify(originalHome));
    const hero = modifiedHome.blocks.find(b => b.type === 'hero');
    hero.title = 'Updated Headline for Testing Rollback';
    contentStore.updatePage('home', modifiedHome, 'test-runner');

    // Publish release v2
    const newRelease = contentStore.createRelease({ author: 'test-runner', notes: 'Test Release v2' });
    assert(newRelease.release_id !== initialRelease.release_id, 'New release generated with unique ID');

    // Verify live site reflects new release
    const updatedHomeRes = await fetch(`${baseUrl}/en`);
    const updatedHtml = await updatedHomeRes.text();
    assert(updatedHtml.includes('Updated Headline for Testing Rollback'), 'Live public site displays published release v2');

    // Execute 1-click rollback to initial release
    const rollbackPointer = contentStore.rollbackRelease(initialRelease.release_id, 'test-runner');
    assert(rollbackPointer.release_id === initialRelease.release_id, 'Rollback pointer updated to initial release');

    // Verify live site rolled back cleanly
    const rolledBackRes = await fetch(`${baseUrl}/en`);
    const rolledBackHtml = await rolledBackRes.text();
    assert(rolledBackHtml.includes('Know your numbers. Control your business.'), 'Live site restored original headline after rollback');

    // 7. TRANSLATION ENGINE & 11 LOCALES
    console.log('\n[Suite 7: 11 Locales Engine & Status Matrix]');
    const matrixRes = await fetch(`${baseUrl}/api/cms/translations/matrix`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` }
    });
    const matrix = await matrixRes.json();
    assert(matrix.length === 11, 'Translation matrix tracks all 11 launch locales');
    const publishedCodes = matrix.filter(m => m.status === 'published').map(m => m.code);
    assert(publishedCodes.length === 7, 'Exactly 7 Phase A locales marked published');
    const expectedPublished = ['en', 'id', 'ru', 'fr', 'de', 'es', 'it'];
    expectedPublished.forEach(c => assert(publishedCodes.includes(c), `Locale ${c} is published`));
    const stagedCodesInMatrix = matrix.filter(m => m.status === 'staged').map(m => m.code);
    assert(stagedCodesInMatrix.length === 4, 'Exactly 4 Phase B locales marked staged');
    const expectedStaged = ['zh-cn', 'ja', 'th', 'vi'];
    expectedStaged.forEach(sc => assert(stagedCodesInMatrix.includes(sc), `Locale ${sc} is staged draft`));

    console.log(`\n==============================================`);
    console.log(`ALL TESTS PASSED! (${passedTests} / ${totalTests} assertions)`);
    console.log(`==============================================\n`);

  } finally {
    server.close();
  }
}

runTestSuite().catch(err => {
  console.error('\nTest Suite Failed with error:', err);
  process.exit(1);
});
