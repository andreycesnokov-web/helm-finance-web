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

  console.log('=== CFO AI HOMEPAGE POST-FIX MEASUREMENTS ===\n');

  const results = {};

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

    // Measure visual separator
    const separator = await page.$('div[aria-hidden="true"].bg-gradient-to-r');
    const separatorBox = await separator ? await separator.boundingBox() : null;

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

    // Check CSS computed styles on footer p
    const descStyles = await footerDesc ? await footerDesc.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        webkitLineClamp: cs.webkitLineClamp,
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
        maxHeight: cs.maxHeight,
        lineHeight: cs.lineHeight
      };
    }) : {};

    results[vp.name] = {
      ctaHeight: ctaBox ? ctaBox.height : null,
      footerHeight: footerBox ? footerBox.height : null,
      articlesHeight: articlesBox ? articlesBox.height : null,
      gapArticlesToCta,
      descText,
      isTruncated,
      descStyles
    };

    console.log(`--- Viewport: ${vp.name} ---`);
    console.log(`  CTA Section Height: ${ctaBox ? ctaBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Footer Height: ${footerBox ? footerBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Articles Section Height: ${articlesBox ? articlesBox.height.toFixed(1) : 'N/A'}px`);
    console.log(`  Gap between Articles & CTA: ${gapArticlesToCta !== null ? gapArticlesToCta.toFixed(1) : 'N/A'}px`);
    console.log(`  Footer Desc Text: "${descText}"`);
    console.log(`  Footer Desc Truncated (scrollHeight > clientHeight): ${isTruncated}`);
    console.log(`  Footer Desc webkitLineClamp: ${descStyles.webkitLineClamp || 'none'}`);
    console.log('');

    // Capture after screenshots
    const shotsDir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });

    if (ctaSection && footer) {
      await ctaSection.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(shotsDir, `homepage-cta-footer-after-${vp.name}.png`)
      });
      console.log(`  Saved screenshot: screenshots/homepage-cta-footer-after-${vp.name}.png`);

      if (vp.name === '1440px' && footerDesc) {
        await footerDesc.screenshot({
          path: path.join(shotsDir, 'footer-desc-after-untruncated.png')
        });
        console.log(`  Saved screenshot: screenshots/footer-desc-after-untruncated.png`);
      }
    }

    await page.close();
  }

  await browser.close();
  console.log('\n=== POST-FIX MEASUREMENT FINISHED ===');
})();
