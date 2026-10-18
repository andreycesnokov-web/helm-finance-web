const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3002/en', { waitUntil: 'networkidle' });

  const footer = await page.$('footer');
  const footerBox = await footer.boundingBox();
  console.log(`BEFORE Footer Height (1440px desktop): ${footerBox.height}px`);

  // Save Before Footer Screenshot
  await footer.scrollIntoViewIfNeeded();
  await footer.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'footer-before-rc1.png') });
  console.log('Saved screenshots/footer-before-rc1.png');

  // Go to Pricing page and inspect Enterprise Card
  await page.goto('http://localhost:3002/en/pricing', { waitUntil: 'networkidle' });
  const enterpriseCard = await page.$('.bento-card:has(a[href*="enterprise@cfo-ai.site"])');
  if (enterpriseCard) {
    await enterpriseCard.scrollIntoViewIfNeeded();
    await enterpriseCard.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'enterprise-card-before-rc1.png') });
    console.log('Saved screenshots/enterprise-card-before-rc1.png');

    // Get computed styles of the paragraph
    const pColor = await enterpriseCard.evaluate(el => {
      const p = el.querySelector('p');
      const cs = window.getComputedStyle(p);
      const cardBg = window.getComputedStyle(el).backgroundColor;
      return { textColor: cs.color, bgColor: cardBg };
    });
    console.log('Enterprise Card computed styles BEFORE:', pColor);
  }

  // Go to About page and inspect legal disclaimer
  await page.goto('http://localhost:3002/en/about', { waitUntil: 'networkidle' });
  const aboutDisclaimer = await page.$('.bento-card:has(h2:has-text("Statutory Accounting Disclosure"))');
  if (aboutDisclaimer) {
    await aboutDisclaimer.scrollIntoViewIfNeeded();
    await aboutDisclaimer.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'about-disclaimer-before-rc1.png') });
    console.log('Saved screenshots/about-disclaimer-before-rc1.png');

    const pColor = await aboutDisclaimer.evaluate(el => {
      const p = el.querySelector('p');
      const cs = window.getComputedStyle(p);
      const cardBg = window.getComputedStyle(el).backgroundColor;
      return { textColor: cs.color, bgColor: cardBg };
    });
    console.log('About Disclaimer computed styles BEFORE:', pColor);
  }

  await browser.close();
})();
