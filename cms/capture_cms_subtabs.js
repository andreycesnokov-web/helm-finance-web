const { createApp } = require('./server/index');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function captureSubtabs() {
  const screenshotsDir = path.join(__dirname, 'screenshots');
  const { app } = createApp();
  const server = http.createServer(app);
  const PORT = 3006;

  await new Promise(resolve => server.listen(PORT, resolve));
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const viewports = [
    { name: 'cms-hub-manager-desktop', url: `http://localhost:${PORT}/admin/?tab=hub`, width: 1440, height: 1000 },
    { name: 'cms-pricing-manager-desktop', url: `http://localhost:${PORT}/admin/?tab=pricing`, width: 1440, height: 1100 },
    { name: 'cms-translations-desktop', url: `http://localhost:${PORT}/admin/?tab=translations`, width: 1440, height: 1100 },
    { name: 'cms-seo-manager-desktop', url: `http://localhost:${PORT}/admin/?tab=seo`, width: 1440, height: 1000 }
  ];

  for (const vp of viewports) {
    const outFile = path.join(screenshotsDir, `${vp.name}.png`);
    console.log(`Capturing ${vp.name}...`);
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
          resolve();
        } else {
          reject(new Error(`Failed to capture ${vp.name}`));
        }
      });
    });
  }

  server.close();
  console.log('Subtabs captured successfully!');
}

captureSubtabs().catch(err => {
  console.error(err);
  process.exit(1);
});
