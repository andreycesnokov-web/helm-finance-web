const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const shotsDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });

  console.log('=== CFO AI FLOATING CTA & FOOTER COMPREHENSIVE VERIFICATION ===\n');

  const viewports = [
    { width: 1440, height: 900, name: '1440px' },
    { width: 1280, height: 800, name: '1280px' },
    { width: 768, height: 1024, name: '768px' },
    { width: 390, height: 844, name: '390px' }
  ];

  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto('http://localhost:3002/en', { waitUntil: 'networkidle' });

    // 1. Floating Banner Card element
    const floatingBanner = await page.$('.bg-navy-brand.rounded-\\[20px\\]');
    const bannerBox = await floatingBanner ? await floatingBanner.boundingBox() : null;

    // 2. Outer Section element
    const ctaSection = await page.$('section:has(.rounded-\\[20px\\])');
    const sectionBox = await ctaSection ? await ctaSection.boundingBox() : null;

    // 3. Footer element
    const footer = await page.$('footer');
    const footerBox = await footer ? await footer.boundingBox() : null;

    // 4. Measure gap between banner card bottom and footer top
    let gapBannerToFooter = null;
    if (bannerBox && footerBox) {
      gapBannerToFooter = footerBox.y - (bannerBox.y + bannerBox.height);
    }

    // 5. Inspect computed styles on banner card
    const bannerStyles = await floatingBanner ? await floatingBanner.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        borderRadius: cs.borderRadius,
        maxWidth: cs.maxWidth,
        background: cs.background,
        boxShadow: cs.boxShadow
      };
    }) : {};

    console.log(`--- Viewport: ${vp.name} ---`);
    console.log(`  Floating Banner Width: ${bannerBox ? bannerBox.width.toFixed(1) : 'N/A'}px`);
    console.log(`  Floating Banner Height: ${bannerBox ? bannerBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Banner Border Radius: ${bannerStyles.borderRadius}`);
    console.log(`  Outer Section Height: ${sectionBox ? sectionBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Footer Height: ${footerBox ? footerBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Gap (Ice Blue) between Banner & Footer: ${gapBannerToFooter !== null ? gapBannerToFooter.toFixed(1) : 'N/A'}px`);

    // Capture close-up screenshot of CTA + Footer together
    if (ctaSection && footer) {
      await ctaSection.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(shotsDir, `floating-cta-footer-closeup-${vp.name}.png`)
      });
      console.log(`  Saved: screenshots/floating-cta-footer-closeup-${vp.name}.png`);
    }

    // Capture full-page for 1440px and 390px
    if (vp.name === '1440px') {
      await page.screenshot({
        path: path.join(shotsDir, 'floating-cta-home-full-1440px.png'),
        fullPage: true
      });
      console.log(`  Saved: screenshots/floating-cta-home-full-1440px.png`);
    }

    if (vp.name === '390px') {
      await page.screenshot({
        path: path.join(shotsDir, 'floating-cta-mobile-390px.png'),
        fullPage: false
      });
      console.log(`  Saved: screenshots/floating-cta-mobile-390px.png`);
    }

    await page.close();
  }

  // 6. Test Footer on Platform and Pricing pages
  const testPages = [
    { url: 'http://localhost:3002/en/platform', shotName: 'footer-platform-1440px.png', name: 'Platform' },
    { url: 'http://localhost:3002/en/pricing', shotName: 'footer-pricing-1440px.png', name: 'Pricing' }
  ];

  for (const tp of testPages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(tp.url, { waitUntil: 'networkidle' });
    const footer = await page.$('footer');
    if (footer) {
      await footer.scrollIntoViewIfNeeded();
      await footer.screenshot({ path: path.join(shotsDir, tp.shotName) });
      console.log(`\nSaved: screenshots/${tp.shotName} (${tp.name} Footer)`);
    }
    await page.close();
  }

  // 7. Verify removed lines across EN, ID, RU
  console.log('\n--- Multi-Locale Footer Audit for Removed Lines ---');
  const locales = ['en', 'id', 'ru'];
  for (const loc of locales) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://localhost:3002/${loc}`, { waitUntil: 'networkidle' });

    const footerText = await page.$eval('footer', el => el.innerText);

    const hasAppLink = footerText.includes('SaaS Application') || footerText.includes('app.cfo-ai.site');
    const hasFootprint = footerText.includes('Jakarta') || footerText.includes('Denpasar') || footerText.includes('Operating across') || footerText.includes('Melayani seluruh') || footerText.includes('Работаем по всей');

    console.log(`Locale: /${loc}`);
    console.log(`  'SaaS Application: app.cfo-ai.site' present in footer? ${hasAppLink}`);
    console.log(`  Location footprint present in footer? ${hasFootprint}`);

    // Verify company description is untruncated
    const descP = await page.$('footer div.space-y-2 p');
    const descText = descP ? await descP.innerText() : '';
    const isTruncated = descP ? await descP.evaluate(el => el.scrollHeight > el.clientHeight) : false;
    console.log(`  Footer Description: "${descText}"`);
    console.log(`  Description Truncated? ${isTruncated}`);
    console.log('');

    await page.close();
  }

  await browser.close();
  console.log('=== VERIFICATION SCRIPT COMPLETED ===');
})();
