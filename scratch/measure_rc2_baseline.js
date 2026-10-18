const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const viewports = [
    { width: 1440, height: 900, name: '1440px' },
    { width: 1280, height: 800, name: '1280px' },
    { width: 768, height: 1024, name: '768px' },
    { width: 390, height: 844, name: '390px' }
  ];

  console.log('=== CFO AI HOMEPAGE BASELINE MEASUREMENTS (RC2) ===\n');

  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto('http://localhost:3002/en', { waitUntil: 'networkidle' });

    // Measure Knowledge Hub articles section
    const articlesSection = await page.$('section:has(h2:has-text("Authoritative Indonesian Tax"))');
    const articlesBox = await articlesSection ? await articlesSection.boundingBox() : null;

    // Measure final CTA section
    const ctaSection = await page.$('section:has(h2:has-text("Ready to take command"))');
    const ctaBox = await ctaSection ? await ctaSection.boundingBox() : null;

    // Measure footer
    const footer = await page.$('footer');
    const footerBox = await footer ? await footer.boundingBox() : null;

    // Gap between articles section and CTA
    let gapArticlesToCta = null;
    if (articlesBox && ctaBox) {
      gapArticlesToCta = ctaBox.y - (articlesBox.y + articlesBox.height);
    }

    // Inspect footer company description text and check for truncation
    const footerDesc = await page.$('footer p');
    const descText = footerDesc ? await footerDesc.innerText() : '';
    const isTruncated = await footerDesc ? await footerDesc.evaluate(el => {
      return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
    }) : false;

    console.log(`--- Viewport: ${vp.name} ---`);
    console.log(`  CTA Section Height: ${ctaBox ? ctaBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Footer Height: ${footerBox ? footerBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Articles Section Height: ${articlesBox ? articlesBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Gap between Articles & CTA: ${gapArticlesToCta !== null ? gapArticlesToCta.toFixed(1) : 'N/A'}px`);
    console.log(`  Footer Desc Text: "${descText.substring(0, 80)}..."`);
    console.log(`  Footer Desc Truncated (scrollHeight > clientHeight): ${isTruncated}`);
    console.log('');

    // Capture baseline screenshots
    const shotsDir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });

    // Screenshot of CTA + Footer area
    if (ctaSection && footer) {
      await ctaSection.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(shotsDir, `homepage-cta-footer-before-${vp.name}.png`)
      });
      console.log(`  Saved screenshot: screenshots/homepage-cta-footer-before-${vp.name}.png`);

      if (vp.name === '1440px' && footerDesc) {
        await footerDesc.screenshot({
          path: path.join(shotsDir, 'footer-desc-before-truncated.png')
        });
        console.log(`  Saved screenshot: screenshots/footer-desc-before-truncated.png`);
      }
    }

    await page.close();
  }

  await browser.close();
  console.log('\n=== BASELINE MEASUREMENT FINISHED ===');
})();
