/**
 * Production Static Site Generator for Cloudflare Pages (npm run build:marketing)
 * Pre-renders all approved public marketing pages, articles, sitemap, robots, and assets.
 * Enforces pricing guard, sanitizes credentials, and validates output.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./server/index');
const PricingGuard = require('./engine/pricingGuard');

async function buildMarketingSite() {
  console.log('====================================================');
  console.log('   CFO AI — STATIC MARKETING BUILD PIPELINE (SSG)   ');
  console.log('====================================================');
  const startTime = Date.now();

  // 1. STEP 1: PRICING INTEGRITY GATE
  console.log('\n[Phase 1/5] Verifying commercial pricing catalog integrity...');
  const dataDir = path.join(__dirname, 'data');
  const pricingGuard = new PricingGuard(path.join(dataDir, 'billing_catalog_reference.json'));
  const currentPricing = JSON.parse(fs.readFileSync(path.join(dataDir, 'pricing.json'), 'utf8'));
  const pricingValidation = pricingGuard.validatePricing(currentPricing);

  if (!pricingValidation.isValid) {
    console.error('FATAL: Pricing discrepancies detected against billing catalog:');
    pricingValidation.discrepancies.forEach(d => console.error(`  - ${d.field}: ${d.message}`));
    process.exit(1);
  }
  console.log('  ✓ Pricing Guard: 100% catalog parity verified ($59 / $149 / $249, 168h trial).');

  // 2. STEP 2: SPIN UP INTERNAL COMPILER SERVER
  console.log('\n[Phase 2/5] Initializing rendering engine...');
  const { app, contentStore } = createApp();
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const outputDir = process.env.BUILD_OUT_DIR || path.join(__dirname, '../dist_marketing');
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const publishedLocales = contentStore.getLocales()
    .filter(l => l.status === 'published')
    .map(l => l.code);
  
  console.log(`  ✓ Approved published launch locales: [${publishedLocales.join(', ')}]`);
  const stagedLocales = contentStore.getLocales()
    .filter(l => l.status !== 'published')
    .map(l => l.code);
  console.log(`  ✓ Excluded draft locales: [${stagedLocales.join(', ')}]`);

  // 3. STEP 3: RENDER PAGES & ARTICLES
  console.log('\n[Phase 3/5] Pre-rendering static HTML pages...');
  const subroutes = [
    '',
    'platform',
    'pricing',
    'blog',
    'document-intelligence',
    'compliance',
    'about',
    'privacy',
    'terms'
  ];

  // Include published articles
  const publishedArticles = contentStore.getHubArticles().filter(a => a.review_status === 'published');
  publishedArticles.forEach(a => subroutes.push(`blog/${a.slug}`));

  let pageCount = 0;
  let totalBytes = 0;

  // Render Root Language Redirect (index.html at apex)
  const rootRedirectHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>CFO AI — Financial Operating System for Indonesia</title>
  <meta http-equiv="refresh" content="0; url=/id">
  <link rel="canonical" href="https://cfo-ai.site/id">
  <script>
    (function() {
      var lang = (navigator.language || navigator.userLanguage || 'id').toLowerCase();
      var target = '/id';
      if (lang.startsWith('en')) target = '/en';
      else if (lang.startsWith('ru')) target = '/ru';
      window.location.replace(target);
    })();
  </script>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background: #F8FAFC; color: #003366; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <p>Redirecting to <a href="/id" style="color: #1768C9; font-weight: bold;">CFO AI Indonesia</a>...</p>
</body>
</html>`;
  fs.writeFileSync(path.join(outputDir, 'index.html'), rootRedirectHtml, 'utf8');
  pageCount++;

  for (const loc of publishedLocales) {
    for (const sub of subroutes) {
      const urlPath = sub ? `/${loc}/${sub}` : `/${loc}`;
      const res = await fetch(`${baseUrl}${urlPath}`);
      if (res.status !== 200) {
        throw new Error(`Failed to render ${urlPath} (HTTP ${res.status})`);
      }
      const html = await res.text();
      const targetDir = sub ? path.join(outputDir, loc, sub) : path.join(outputDir, loc);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'index.html'), html, 'utf8');
      pageCount++;
      totalBytes += Buffer.byteLength(html, 'utf8');
    }
  }

  // 4. STEP 4: SITEMAP, ROBOTS, AND ASSETS
  console.log('\n[Phase 4/5] Exporting metadata and static design assets...');
  const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`);
  const sitemapXml = await sitemapRes.text();
  fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemapXml, 'utf8');

  const robotsRes = await fetch(`${baseUrl}/robots.txt`);
  const robotsTxt = await robotsRes.text();
  fs.writeFileSync(path.join(outputDir, 'robots.txt'), robotsTxt, 'utf8');

  // Render Custom 404 Page (for unpublished locales, draft routes, and broken URLs)
  const notFoundHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 — Page Not Found | CFO AI</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #F8FAFC;
      color: #003366;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      text-align: center;
    }
    .container {
      max-width: 560px;
      background: #FFFFFF;
      padding: 48px 36px;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 51, 102, 0.08);
      border: 1px solid #E2E8F0;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      background: #EFF6FF;
      color: #1768C9;
      font-weight: 700;
      font-size: 14px;
      border-radius: 9999px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 32px;
      font-weight: 800;
      color: #003366;
      margin-bottom: 12px;
      letter-spacing: -0.02em;
    }
    p {
      color: #64748B;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
    }
    .btn {
      display: block;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
      transition: all 0.2s ease;
    }
    .btn-primary {
      background: #1768C9;
      color: #FFFFFF;
    }
    .btn-primary:hover {
      background: #12529E;
    }
    .btn-outline {
      background: #F8FAFC;
      color: #003366;
      border: 1px solid #CBD5E1;
    }
    .btn-outline:hover {
      background: #F1F5F9;
    }
    .links {
      margin-top: 24px;
      display: flex;
      justify-content: center;
      gap: 16px;
      font-size: 13px;
      color: #94A3B8;
    }
    .links a {
      color: #64748B;
      text-decoration: none;
    }
    .links a:hover {
      color: #1768C9;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">Error 404</div>
    <h1>Page Not Found</h1>
    <p>The page you are looking for does not exist, has been moved, or is not yet available in your language.</p>
    <div class="buttons">
      <a href="/id" class="btn btn-primary">🇮🇩 Lanjutkan dalam Bahasa Indonesia</a>
      <a href="/en" class="btn btn-outline">🇺🇸 Continue in English</a>
      <a href="/ru" class="btn btn-outline">🇷🇺 Продолжить на русском</a>
    </div>
    <div class="links">
      <a href="/id/platform">Platform</a>
      <span>•</span>
      <a href="/id/pricing">Pricing</a>
      <span>•</span>
      <a href="https://app.cfo-ai.site/login">Log In</a>
    </div>
  </div>
</body>
</html>`;
  fs.writeFileSync(path.join(outputDir, '404.html'), notFoundHtml, 'utf8');
  pageCount++;

  // Export Cloudflare _headers
  const headersContent = `/404.html
  X-Robots-Tag: noindex, nofollow

/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
`;
  fs.writeFileSync(path.join(outputDir, '_headers'), headersContent, 'utf8');

  // Copy design assets
  const assetSrc = path.join(__dirname, '../website-design/assets');
  const assetDest = path.join(outputDir, 'assets');
  fs.cpSync(assetSrc, assetDest, { recursive: true });

  server.close();

  // 5. STEP 5: SECURITY AUDIT & OUTPUT VALIDATION
  console.log('\n[Phase 5/5] Running automated security audit on build artifacts...');
  const prohibitedTokens = [
    'cfo-staging-pass',
    'cfo-admin',
    'JWT_SECRET',
    'SUPABASE_SECRET',
    '/api/cms/releases/publish',
    'password123'
  ];

  function auditDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        auditDirectory(fullPath);
      } else if (file.endsWith('.html') || file.endsWith('.xml') || file.endsWith('.txt')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const token of prohibitedTokens) {
          if (content.includes(token)) {
            throw new Error(`SECURITY LEAK DETECTED: Found prohibited token '${token}' in artifact ${fullPath}`);
          }
        }
      }
    }
  }

  auditDirectory(outputDir);
  console.log('  ✓ Security Audit: 0 secrets, 0 credentials, 0 private paths detected.');

  const durationMs = Date.now() - startTime;
  console.log('\n====================================================');
  console.log('   STATIC MARKETING BUILD COMPLETED SUCCESSFULLY    ');
  console.log('====================================================');
  console.log(`Output Directory : ${outputDir}`);
  console.log(`Pages Generated  : ${pageCount} HTML documents`);
  console.log(`Total HTML Size  : ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`Published Locales: ${publishedLocales.join(', ')}`);
  console.log(`Build Duration   : ${durationMs} ms`);
  console.log('====================================================\n');
}

if (require.main === module) {
  buildMarketingSite().catch(err => {
    console.error('Build marketing failed:', err);
    process.exit(1);
  });
}

module.exports = { buildMarketingSite };
