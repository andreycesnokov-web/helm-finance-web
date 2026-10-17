/**
 * Headless Chrome Screenshot Capture Script for CFO AI Website & CMS
 */

const { createApp } = require('./server/index');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function runScreenshotCapture() {
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const { app } = createApp();
  const server = http.createServer(app);
  const PORT = 3005;

  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`[Capture Server] Serving on http://localhost:${PORT}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const viewports = [
    { name: 'homepage-desktop', url: `http://localhost:${PORT}/en`, width: 1440, height: 1200 },
    { name: 'homepage-mobile', url: `http://localhost:${PORT}/en`, width: 390, height: 844 },
    { name: 'pricing-desktop', url: `http://localhost:${PORT}/en/pricing`, width: 1440, height: 1200 },
    { name: 'pricing-mobile', url: `http://localhost:${PORT}/en/pricing`, width: 390, height: 844 },
    { name: 'hub-desktop', url: `http://localhost:${PORT}/en/blog`, width: 1440, height: 1200 },
    { name: 'hub-mobile', url: `http://localhost:${PORT}/en/blog`, width: 390, height: 844 },
    { name: 'article-desktop', url: `http://localhost:${PORT}/en/blog/pt-pma-tax-compliance-guide-2026`, width: 1440, height: 1200 },
    { name: 'article-mobile', url: `http://localhost:${PORT}/en/blog/pt-pma-tax-compliance-guide-2026`, width: 390, height: 844 },
    { name: 'cms-dashboard-desktop', url: `http://localhost:${PORT}/admin/`, width: 1440, height: 1000 }
  ];

  for (const vp of viewports) {
    const outFile = path.join(screenshotsDir, `${vp.name}.png`);
    console.log(`Capturing ${vp.name} (${vp.width}x${vp.height})...`);

    await new Promise((resolve, reject) => {
      const proc = spawn(chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--window-size=${vp.width},${vp.height}`,
        `--screenshot=${outFile}`,
        vp.url
      ]);

      proc.on('close', code => {
        if (code === 0 && fs.existsSync(outFile)) {
          const stats = fs.statSync(outFile);
          console.log(`  ✓ Saved ${vp.name}.png (${stats.size} bytes)`);
          resolve();
        } else {
          reject(new Error(`Failed to capture ${vp.name}, exit code ${code}`));
        }
      });
    });
  }

  server.close();
  console.log('\nAll QA screenshots successfully captured!');
}

runScreenshotCapture().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
