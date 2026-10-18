'use strict';
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:55470/signup?plan=control', { waitUntil: 'networkidle' });
  console.log('Title:', await page.title());
  console.log('URL:', page.url());
  const bodyText = await page.textContent('body');
  console.log('Contains Control:', bodyText.includes('Control') || bodyText.includes('control'));
  console.log('Contains 149:', bodyText.includes('149'));
  console.log('LocalStorage cfo_selected_plan:', await page.evaluate(() => localStorage.getItem('cfo_selected_plan')));
  await browser.close();
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
