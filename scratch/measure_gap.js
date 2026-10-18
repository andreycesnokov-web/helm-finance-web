const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const w of [1440, 1280, 768, 390]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.goto('http://localhost:3002/en', { waitUntil: 'networkidle' });
    const cards = await page.$$('.bento-card:has(a[href*="/blog/"])');
    const lastCard = cards[cards.length - 1];
    const cardBox = await lastCard.boundingBox();
    const cta = await page.$('section:has(h2:has-text("Ready to take command"))');
    const ctaBox = await cta.boundingBox();
    const dist = ctaBox.y - (cardBox.y + cardBox.height);
    console.log(`${w}px: Distance from bottom of article cards to CTA section = ${dist.toFixed(1)}px`);
    await page.close();
  }
  await browser.close();
})();
