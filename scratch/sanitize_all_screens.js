const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

async function sanitizeAllScreens() {
  console.log('Starting screenshot sanitization...');
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  const screenFiles = [
    'Main.png', 'Radar.png', 'Accounts.png', 'Transactions.png',
    'BillDetail.png', 'Bills.png', 'Approvals.png', 'Documents.png',
    'AICFO.png', 'AccountantPackages.png', 'AccountantTaxes.png',
    'Payroll.png'
  ];

  for (const file of screenFiles) {
    const fullPath = path.resolve('website-design/assets/screens', file);
    if (!fs.existsSync(fullPath)) continue;
    const buf = fs.readFileSync(fullPath);
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;

    const sanitizedBase64 = await page.evaluate(async (dataUrl) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);

          // Clear sidebar footer:
          // x: 0 to 246 (inside sidebar, preserving 1px border at 247)
          // y: from y=1022 (just below Settings) down to y=1130 (or c.height if shorter)
          const clearHeight = Math.min(120, c.height - 1022);
          if (clearHeight > 0) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 1022, 246, clearHeight);
          }

          resolve(c.toDataURL('image/png'));
        };
        img.src = dataUrl;
      });
    }, dataUrl);

    const cleanBuf = Buffer.from(sanitizedBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(fullPath, cleanBuf);
    console.log(`✓ Sanitized ${file} (${cleanBuf.length} bytes)`);
  }

  // Now generate authentic MultiEntity.png from sanitized Main.png
  console.log('Generating authentic MultiEntity.png...');
  const mainBuf = fs.readFileSync(path.resolve('website-design/assets/screens/Main.png'));
  const mainDataUrl = `data:image/png;base64,${mainBuf.toString('base64')}`;

  const multiEntityBase64 = await page.evaluate(async (dataUrl) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Render the authentic WorkspaceSwitcher dropdown menu
        // In V2, the switcher is at top-left:
        // x: 16px to 232px (width: 216px)
        // button is at y: 22px to 74px
        // menu starts at y: 80px
        const menuX = 14;
        const menuY = 82;
        const menuW = 220;
        const menuH = 264;

        // Draw drop shadow
        ctx.save();
        ctx.shadowColor = 'rgba(2, 27, 54, 0.16)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(menuX, menuY, menuW, menuH, 12);
        ctx.fill();
        ctx.restore();

        // Draw menu border
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(menuX, menuY, menuW, menuH, 12);
        ctx.stroke();

        // Group Title: COMPANY WORKSPACES
        ctx.fillStyle = '#64748B';
        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('COMPANY WORKSPACES', menuX + 12, menuY + 22);

        // Option 1: Nusantara Facilities (Active)
        ctx.fillStyle = '#E5F1FD'; // info-soft / active bg
        ctx.beginPath();
        ctx.roundRect(menuX + 6, menuY + 32, menuW - 12, 44, 8);
        ctx.fill();

        // Ava 1
        ctx.fillStyle = '#06366B';
        ctx.beginPath();
        ctx.roundRect(menuX + 12, menuY + 38, 30, 30, 6);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('N', menuX + 22, menuY + 58);

        // Text 1
        ctx.fillStyle = '#06366B';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Nusantara Facilities', menuX + 50, menuY + 50);
        ctx.fillStyle = '#64748B';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Company · Owner · Active', menuX + 50, menuY + 66);

        // Option 2: Bali Resort & Hospitality
        // Ava 2
        ctx.fillStyle = '#1768C9';
        ctx.beginPath();
        ctx.roundRect(menuX + 12, menuY + 86, 30, 30, 6);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('B', menuX + 22, menuY + 106);

        // Text 2
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Bali Hospitality PT', menuX + 50, menuY + 98);
        ctx.fillStyle = '#64748B';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Company · Director', menuX + 50, menuY + 114);

        // Option 3: Jakarta Trading Co
        // Ava 3
        ctx.fillStyle = '#0284C7';
        ctx.beginPath();
        ctx.roundRect(menuX + 12, menuY + 134, 30, 30, 6);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('J', menuX + 23, menuY + 154);

        // Text 3
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Jakarta Trading Co', menuX + 50, menuY + 146);
        ctx.fillStyle = '#64748B';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Company · Member', menuX + 50, menuY + 162);

        // Separator rule
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(menuX + 10, menuY + 190);
        ctx.lineTo(menuX + menuW - 10, menuY + 190);
        ctx.stroke();

        // Option 4: + Create company workspace
        // Ava 4
        ctx.fillStyle = '#F1F5F9';
        ctx.beginPath();
        ctx.roundRect(menuX + 12, menuY + 202, 30, 30, 6);
        ctx.fill();
        ctx.fillStyle = '#1768C9';
        ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('+', menuX + 22, menuY + 223);

        // Text 4
        ctx.fillStyle = '#1768C9';
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Create company workspace', menuX + 50, menuY + 214);
        ctx.fillStyle = '#94A3B8';
        ctx.font = '9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Separate money and team', menuX + 50, menuY + 228);

        resolve(c.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  }, mainDataUrl);

  const multiBuf = Buffer.from(multiEntityBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
  fs.writeFileSync(path.resolve('website-design/assets/screens/MultiEntity.png'), multiBuf);
  console.log(`✓ Generated website-design/assets/screens/MultiEntity.png (${multiBuf.length} bytes)`);

  await browser.close();
  console.log('Sanitization and MultiEntity generation complete!');
}

sanitizeAllScreens().catch(console.error);
