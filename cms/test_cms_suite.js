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
    assert(sitemapXml.includes('<loc>https://cfo-ai.site/en</loc>'), 'Sitemap contains English homepage');
    assert(sitemapXml.includes('<loc>https://cfo-ai.site/id</loc>'), 'Sitemap contains Indonesian homepage');
    assert(sitemapXml.includes('<loc>https://cfo-ai.site/ru</loc>'), 'Sitemap contains Russian homepage');
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

    // 7. TRANSLATION ENGINE & 16 LOCALES
    console.log('\n[Suite 7: 16 Locales Engine & Status Matrix]');
    const matrixRes = await fetch(`${baseUrl}/api/cms/translations/matrix`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` }
    });
    const matrix = await matrixRes.json();
    assert(matrix.length === 16, 'Translation matrix tracks all 16 requested locales');
    const publishedCodes = matrix.filter(m => m.status === 'published').map(m => m.code);
    assert(publishedCodes.includes('en') && publishedCodes.includes('id') && publishedCodes.includes('ru'), 'EN, ID, RU marked published');

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
