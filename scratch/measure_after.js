const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrast(rgb1, rgb2) {
  const parseRGB = str => {
    const match = str.match(/\d+/g);
    return match ? match.map(Number).slice(0, 3) : [0, 0, 0];
  };
  const [r1, g1, b1] = parseRGB(rgb1);
  const [r2, g2, b2] = parseRGB(rgb2);
  const lum1 = getLuminance(r1, g1, b1);
  const lum2 = getLuminance(r2, g2, b2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return ((brightest + 0.05) / (darkest + 0.05)).toFixed(2);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('=== CFO AI MEASUREMENT & VERIFICATION (AFTER RC2) ===\n');

  // 1. Measure Footer at 1440px
  await page.goto('http://localhost:3002/en', { waitUntil: 'networkidle' });
  const footer = await page.$('footer');
  const footerBox = await footer.boundingBox();
  console.log(`AFTER Footer Height (1440px desktop): ${footerBox.height}px`);
  const beforeHeight = 415;
  const reduction = ((beforeHeight - footerBox.height) / beforeHeight * 100).toFixed(1);
  console.log(`Height reduction: ${reduction}% (${beforeHeight}px -> ${footerBox.height}px)`);

  await footer.scrollIntoViewIfNeeded();
  await footer.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'footer-after-rc2.png') });
  console.log('Saved screenshots/footer-after-rc2.png');

  // Also check mobile footer height at 390px
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFooter = await page.$('footer');
  const mobileFooterBox = await mobileFooter.boundingBox();
  console.log(`AFTER Footer Height (390px mobile): ${mobileFooterBox.height}px`);

  // Reset to 1440px for cards
  await page.setViewportSize({ width: 1440, height: 900 });

  // 2. Measure Pricing Enterprise Card
  await page.goto('http://localhost:3002/en/pricing', { waitUntil: 'networkidle' });
  const enterpriseCard = await page.$('.bento-card:has(a[href*="enterprise@cfo-ai.site"])');
  if (enterpriseCard) {
    await enterpriseCard.scrollIntoViewIfNeeded();
    await enterpriseCard.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'enterprise-card-after-rc2.png') });
    console.log('\nSaved screenshots/enterprise-card-after-rc2.png');

    const styles = await enterpriseCard.evaluate(el => {
      const heading = el.querySelector('h3');
      const p = el.querySelector('p');
      const btn = el.querySelector('a');
      const cardBg = window.getComputedStyle(el).backgroundColor;
      return {
        cardBg,
        headingColor: window.getComputedStyle(heading).color,
        textColor: window.getComputedStyle(p).color,
        btnBg: window.getComputedStyle(btn).backgroundColor,
        btnColor: window.getComputedStyle(btn).color
      };
    });

    console.log('Enterprise Card computed styles AFTER:', styles);
    console.log('Heading Contrast Ratio:', getContrast(styles.headingColor, styles.cardBg) + ':1');
    console.log('Body Text Contrast Ratio:', getContrast(styles.textColor, styles.cardBg) + ':1');
    console.log('Button Text Contrast Ratio:', getContrast(styles.btnColor, styles.btnBg) + ':1');
  }

  // 3. Measure About Disclaimer Card
  await page.goto('http://localhost:3002/en/about', { waitUntil: 'networkidle' });
  const aboutDisclaimer = await page.$('.bento-card:has(h2:has-text("Statutory Accounting Disclosure"))');
  if (aboutDisclaimer) {
    await aboutDisclaimer.scrollIntoViewIfNeeded();
    await aboutDisclaimer.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'about-disclaimer-after-rc2.png') });
    console.log('\nSaved screenshots/about-disclaimer-after-rc2.png');

    const styles = await aboutDisclaimer.evaluate(el => {
      const heading = el.querySelector('h2');
      const p = el.querySelector('p');
      const btn = el.querySelector('a');
      const cardBg = window.getComputedStyle(el).backgroundColor;
      return {
        cardBg,
        headingColor: window.getComputedStyle(heading).color,
        textColor: window.getComputedStyle(p).color,
        btnBg: window.getComputedStyle(btn).backgroundColor,
        btnColor: window.getComputedStyle(btn).color
      };
    });

    console.log('About Disclaimer computed styles AFTER:', styles);
    console.log('Heading Contrast Ratio:', getContrast(styles.headingColor, styles.cardBg) + ':1');
    console.log('Body Text Contrast Ratio:', getContrast(styles.textColor, styles.cardBg) + ':1');
    console.log('Button Text Contrast Ratio:', getContrast(styles.btnColor, styles.btnBg) + ':1');
  }

  await browser.close();
  console.log('\n=== MEASUREMENT COMPLETE ===');
})();
