/**
 * Public Website & Knowledge Hub SSR Router
 * Powers https://cfo-ai.site with 16-locale routing, Concept B rendering, and dynamic SEO.
 * Zero emojis across all marketing copy and UI elements.
 */

const express = require('express');
const SitemapGenerator = require('../engine/sitemapGenerator');
const TranslationEngine = require('../engine/translationEngine');

function createPublicRoutes(contentStore) {
  const router = express.Router();
  const translationEngine = new TranslationEngine();

  // Middleware: Check 301 Redirects from SEO configuration
  router.use((req, res, next) => {
    const seo = contentStore.getSeo();
    if (seo.redirects && Array.isArray(seo.redirects)) {
      const match = seo.redirects.find(r => r.from === req.path);
      if (match) {
        return res.redirect(match.status || 301, match.to);
      }
    }
    next();
  });

  // --- XML SITEMAP & ROBOTS.TXT ---
  router.get('/sitemap.xml', (req, res) => {
    const seo = contentStore.getSeo();
    const locales = contentStore.getLocales();
    const pages = contentStore.getPages();
    const articles = contentStore.getHubArticles();
    const generator = new SitemapGenerator(seo.base_url || 'https://cfo-ai.site', locales, pages, articles);
    const xml = generator.generateXml();

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  });

  router.get('/robots.txt', (req, res) => {
    const seo = contentStore.getSeo();
    const base = seo.base_url || 'https://cfo-ai.site';
    const body = `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/cms/\nDisallow: /preview/\n\nSitemap: ${base}/sitemap.xml\n`;
    res.header('Content-Type', 'text/plain');
    res.send(body);
  });

  // --- ROOT REDIRECT TO DEFAULT LOCALE ---
  router.get('/', (req, res) => {
    const acceptLang = req.headers['accept-language'] || '';
    let target = 'id';
    if (acceptLang.includes('ru')) target = 'ru';
    else if (acceptLang.includes('en')) target = 'en';
    res.redirect(302, `/${target}`);
  });

  // --- HELPER TO RENDER CONCEPT B HTML SHELL ---
  function renderLayout({ locale, title, description, canonical, activeTab, content, hreflangs = [] }) {
    const locales = contentStore.getLocales();
    const nav = contentStore.getNavigation();
    const publishedLocales = locales.filter(l => l.status === 'published');
    const currentLocaleObj = locales.find(l => l.code === locale) || { code: locale, name: 'English', nativeName: 'English' };

    const hreflangTags = hreflangs.map(h => `<link rel="alternate" hreflang="${h.lang}" href="${h.url}" />`).join('\n  ');

    const localeDropdownOptions = locales.map(l => {
      const isPub = l.status === 'published';
      const isSelected = l.code === locale;
      return `<option value="${l.code}" ${isSelected ? 'selected' : ''} ${!isPub ? 'disabled' : ''}>
        ${l.nativeName} (${l.name}) ${!isPub ? '— Coming Soon' : ''}
      </option>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="${locale}" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" type="image/x-icon" href="/assets/brand/favicon.ico">
  ${hreflangTags}
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="CFO AI Indonesia">
  <meta name="twitter:card" content="summary_large_image">
  
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <style>
    body { font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #F8FAFC; color: #003366; }
    .font-brand { font-family: 'Archivo Black', sans-serif; }
    .font-mono-num { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum' on, 'zero' on; }
    .bento-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgba(0, 51, 102, 0.04), 0 2px 4px -2px rgba(0, 51, 102, 0.02); transition: all 0.2s ease; }
    .bento-card:hover { border-color: #CBD5E1; box-shadow: 0 10px 15px -3px rgba(0, 51, 102, 0.08); }
    .bg-ice-tint { background: linear-gradient(180deg, #F0F6FD 0%, #F8FAFC 100%); }
    .watermark-bg { background-image: radial-gradient(rgba(21, 101, 192, 0.04) 1px, transparent 1px); background-size: 24px 24px; }
  </style>
</head>
<body class="min-h-screen flex flex-col watermark-bg text-slate-800">

  <!-- TOP ANNOUNCEMENT BAR (Concept B+ Ice/Electric Treatment) -->
  <div class="bg-[#1565C0] text-white py-2 px-4 text-center text-xs font-semibold tracking-wide">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex-1 text-center">
        <span>Indonesia Tax Transition (PMK 81/2024 CoreTax) Readiness Package is now active.</span>
        <a href="/${locale}/blog/coretax-pmk-81-2024-transition-guide" class="ml-2 underline font-bold hover:text-blue-100">Read Director's Guide &rarr;</a>
      </div>
      <!-- Language Switcher in Header -->
      <div class="hidden sm:flex items-center gap-1.5 text-xs text-blue-100 ml-4">
        <svg class="w-3.5 h-3.5 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
        <select onchange="window.location.href='/' + this.value + window.location.pathname.substring(3)" class="bg-[#0D47A1] text-white text-xs rounded px-2 py-1 border border-blue-400 focus:outline-none cursor-pointer">
          ${localeDropdownOptions}
        </select>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-[#E2E8F0]">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
      <div class="flex items-center gap-8">
        <a href="/${locale}" class="flex items-center gap-3">
          <img src="/assets/brand/logo_main_navy_transparent.svg" alt="CFO AI Financial OS" class="h-9 w-auto">
        </a>

        <nav class="hidden lg:flex items-center gap-6 text-sm font-semibold text-[#334155]">
          <a href="/${locale}/platform" class="hover:text-[#1565C0] ${activeTab === 'platform' ? 'text-[#1565C0] font-bold' : ''}">Platform</a>
          <a href="/${locale}/document-intelligence" class="hover:text-[#1565C0] ${activeTab === 'doc' ? 'text-[#1565C0] font-bold' : ''}">Document Intelligence</a>
          <a href="/${locale}/compliance" class="hover:text-[#1565C0] ${activeTab === 'compliance' ? 'text-[#1565C0] font-bold' : ''}">Tax &amp; Compliance</a>
          <a href="/${locale}/blog" class="hover:text-[#1565C0] ${activeTab === 'blog' ? 'text-[#1565C0] font-bold' : ''}">Knowledge Hub</a>
          <a href="/${locale}/pricing" class="hover:text-[#1565C0] ${activeTab === 'pricing' ? 'text-[#1565C0] font-bold' : ''}">Pricing</a>
          <a href="/${locale}/about" class="hover:text-[#1565C0] ${activeTab === 'about' ? 'text-[#1565C0] font-bold' : ''}">About</a>
        </nav>
      </div>

      <div class="flex items-center gap-3">
        <a href="https://app.cfo-ai.site/login" class="hidden sm:inline-block text-sm font-bold text-[#003366] hover:text-[#1565C0] px-3 py-2">
          Log In
        </a>
        <a href="https://app.cfo-ai.site/login" class="text-xs sm:text-sm font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-4 sm:px-5 py-2.5 rounded-xl shadow-sm transition-all min-h-[44px] flex items-center justify-center">
          Start Free Trial (7 Days)
        </a>
        <!-- Mobile Menu Toggle Button -->
        <button onclick="toggleMobileMenu()" class="lg:hidden p-2.5 rounded-lg text-slate-600 hover:text-[#1565C0] hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Toggle navigation menu">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>
    </div>

    <!-- Mobile Drawer Navigation -->
    <div id="mobile-menu" class="hidden lg:hidden border-t border-slate-200 bg-white px-4 pt-4 pb-6 space-y-3">
      <a href="/${locale}/platform" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px] flex items-center">Platform Architecture</a>
      <a href="/${locale}/document-intelligence" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px] flex items-center">Document Intelligence &amp; OCR</a>
      <a href="/${locale}/compliance" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px] flex items-center">Tax &amp; Compliance Radar</a>
      <a href="/${locale}/blog" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px] flex items-center">Knowledge Hub &amp; Guides</a>
      <a href="/${locale}/pricing" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px] flex items-center">Pricing &amp; Subscription</a>
      <a href="/${locale}/about" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px] flex items-center">About CFO AI</a>
      <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
        <span class="text-xs font-bold text-slate-500">Language:</span>
        <select onchange="window.location.href='/' + this.value + window.location.pathname.substring(3)" class="bg-slate-100 text-slate-800 text-xs rounded px-2.5 py-1.5 border border-slate-300">
          ${localeDropdownOptions}
        </select>
      </div>
      <div class="pt-2">
        <a href="https://app.cfo-ai.site/login" class="block w-full text-center text-xs font-bold bg-[#1565C0] text-white py-3 rounded-xl min-h-[44px] flex items-center justify-center">
          Open CFO AI Application &rarr;
        </a>
      </div>
    </div>
  </header>

  <!-- MAIN PAGE CONTENT -->
  <main class="flex-grow">
    ${content}
  </main>

  <!-- FOOTER -->
  <footer class="bg-[#002244] text-slate-300 pt-16 pb-12 border-t border-slate-700">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-10 mb-12">
        <div class="md:col-span-2">
          <div class="flex items-center gap-3 mb-4">
            <img src="/assets/brand/logo_dark_bg_white_text.svg" alt="CFO AI Indonesia" class="h-8 w-auto rounded">
          </div>
          <p class="text-xs text-slate-300 leading-relaxed mb-6 max-w-sm">
            AI-powered financial operating system engineered for Indonesian PT and PT PMA companies. Real-time multi-currency cash visibility, Indonesian tax invoice OCR, automated bank reconciliation, and regulatory compliance intelligence.
          </p>
          <div class="text-[11px] text-slate-400 space-y-1">
            <div>SaaS Application: <a href="https://app.cfo-ai.site" class="text-blue-300 underline font-mono">app.cfo-ai.site</a></div>
            <div>Footprint: Jakarta &bull; Denpasar, Bali &bull; Operating across Indonesia</div>
            <div>Security: AES-256 Encryption &bull; Isolated Tenant Schemas &bull; Zero AI Training on Customer Data</div>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-white mb-4">Platform</h4>
          <ul class="space-y-2 text-xs">
            <li><a href="/${locale}/platform#pulse" class="hover:text-white">Pulse Command Center</a></li>
            <li><a href="/${locale}/platform#radar" class="hover:text-white">Radar Trajectory</a></li>
            <li><a href="/${locale}/document-intelligence" class="hover:text-white">Document Intelligence</a></li>
            <li><a href="/${locale}/platform#bank-import" class="hover:text-white">Bank Reconciliation</a></li>
            <li><a href="/${locale}/pricing" class="hover:text-white">Pricing &amp; Plans</a></li>
          </ul>
        </div>

        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-white mb-4">Knowledge Hub</h4>
          <ul class="space-y-2 text-xs">
            <li><a href="/${locale}/blog" class="hover:text-white">All Tax &amp; Business Guides</a></li>
            <li><a href="/${locale}/blog/pt-pma-tax-compliance-guide-2026" class="hover:text-white">PT PMA Tax Guide 2026</a></li>
            <li><a href="/${locale}/blog/pph-21-ter-calculation-rules-indonesia" class="hover:text-white">PPh 21 TER Formulas</a></li>
            <li><a href="/${locale}/blog/coretax-pmk-81-2024-transition-guide" class="hover:text-white">CoreTax PMK 81/2024</a></li>
          </ul>
        </div>

        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-white mb-4">Company &amp; Legal</h4>
          <ul class="space-y-2 text-xs">
            <li><a href="/${locale}/about" class="hover:text-white">About CFO AI</a></li>
            <li><a href="/${locale}/compliance" class="hover:text-white">Indonesian Tax Radar</a></li>
            <li><a href="/${locale}/privacy" class="hover:text-white">Privacy Policy (UU PDP)</a></li>
            <li><a href="/${locale}/terms" class="hover:text-white">Terms of Service</a></li>
            <li><a href="https://app.cfo-ai.site/login" class="text-blue-300 font-bold hover:underline">Start 7-Day Free Trial &rarr;</a></li>
          </ul>
        </div>
      </div>

      <div class="border-t border-slate-700 pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
        <div>&copy; 2026 CFO AI Indonesia. All rights reserved.</div>
        <div class="text-[11px] max-w-xl text-center sm:text-right">
          CFO AI is an operational financial management system. It does not issue statutory audit opinions or replace a licensed Indonesian Konsultan Pajak.
        </div>
      </div>
    </div>
  </footer>

  <script>
    function toggleMobileMenu() {
      const el = document.getElementById('mobile-menu');
      if (el) el.classList.toggle('hidden');
    }
  </script>
</body>
</html>`;
  }

  // --- LOCALIZED HOMEPAGE (/:locale) ---
  router.get('/:locale', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) {
      return res.redirect('/id');
    }

    const page = contentStore.getPage('home');
    const pricing = contentStore.getPricing();
    const articles = contentStore.getHubArticles().slice(0, 3);
    const seo = contentStore.getSeo();

    const title = page?.title || seo.pages_meta?.home?.title || 'CFO AI — Financial Operating System for Indonesia';
    const description = seo.pages_meta?.home?.description || 'Your AI Chief Financial Officer. Real-time cash visibility, document intelligence, automated bank reconciliation, and Indonesian tax compliance.';
    const canonical = `https://cfo-ai.site/${locale}`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}`
    }));

    const heroBlock = page?.blocks?.find(b => b.type === 'hero') || {};

    const contentHtml = `
      <!-- HERO SECTION -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-ice-tint border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto text-center">
          <div class="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-[#1565C0] text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-6">
            <span class="w-2 h-2 rounded-full bg-[#1565C0]"></span>
            <span>${heroBlock.badge || 'DESIGNED FOR INDONESIA • PT & PT PMA'}</span>
          </div>
          <h1 class="text-4xl sm:text-6xl font-black text-[#003366] tracking-tight max-w-4xl mx-auto mb-6 leading-tight">
            ${heroBlock.title || 'Know your numbers. Control your business.'}
          </h1>
          <p class="text-base sm:text-lg text-[#5A6E82] max-w-2xl mx-auto mb-10 leading-relaxed">
            ${heroBlock.subtitle || 'Your AI Chief Financial Officer. Real-time cash visibility, document intelligence, automated bank reconciliation, and Indonesian tax compliance — unified in one financial operating system.'}
          </p>

          <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <a href="${heroBlock.primary_cta_url || 'https://app.cfo-ai.site/login'}" class="w-full sm:w-auto text-sm font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-8 py-4 rounded-xl shadow-lg transition-all min-h-[44px] flex items-center justify-center">
              ${heroBlock.primary_cta_text || 'Start Free Trial (7 Days)'}
            </a>
            <a href="/${locale}/platform" class="w-full sm:w-auto text-sm font-bold bg-white hover:bg-slate-50 text-[#003366] border border-[#CBD5E1] px-8 py-4 rounded-xl transition-all min-h-[44px] flex items-center justify-center">
              Explore Platform Tour &rarr;
            </a>
          </div>
          <div class="text-xs text-[#5A6E82] font-medium">
            ${heroBlock.trial_disclaimer || 'No credit card required • Instant company provisioning • Full access for 168 hours'}
          </div>

          <!-- Real-Time Operational KPI Metrics Counter Bar -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto mt-12 text-left">
            <div class="bento-card p-4 sm:p-5">
              <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Cash Runway</div>
              <div class="text-2xl sm:text-3xl font-black text-[#003366] font-mono-num">162 Days</div>
              <div class="text-[11px] text-emerald-600 font-semibold mt-1">Healthy buffer (&gt;90 days)</div>
            </div>
            <div class="bento-card p-4 sm:p-5">
              <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">30-Day Net Flow</div>
              <div class="text-2xl sm:text-3xl font-black text-[#003366] font-mono-num">+Rp 148.5M</div>
              <div class="text-[11px] text-emerald-600 font-semibold mt-1">+14.2% vs previous period</div>
            </div>
            <div class="bento-card p-4 sm:p-5">
              <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Bank Reconciliation</div>
              <div class="text-2xl sm:text-3xl font-black text-[#003366] font-mono-num">100% Balanced</div>
              <div class="text-[11px] text-[#1565C0] font-semibold mt-1">BCA Giro &amp; Mandiri verified</div>
            </div>
            <div class="bento-card p-4 sm:p-5">
              <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Tax Exposure</div>
              <div class="text-2xl sm:text-3xl font-black text-emerald-700 font-mono-num">0 IDR Risk</div>
              <div class="text-[11px] text-slate-500 font-semibold mt-1">PPh 21 TER &amp; PPN current</div>
            </div>
          </div>

          <!-- Hero Software Illustration Showcase -->
          <div class="mt-10 max-w-5xl mx-auto bento-card p-4 sm:p-6 bg-white border border-[#CBD5E1] shadow-2xl text-left">
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 text-xs text-[#5A6E82]">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-rose-400"></span>
                <span class="w-3 h-3 rounded-full bg-amber-400"></span>
                <span class="w-3 h-3 rounded-full bg-emerald-400"></span>
                <span class="font-mono ml-2 font-bold text-[#003366]">Pulse Command Center — PT Solusi Utama Nusantara</span>
              </div>
              <span class="text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">Live Operating Feed</span>
            </div>
            <img src="/assets/product/dashboard-pulse.svg" alt="CFO AI Pulse Dashboard" class="w-full rounded-lg shadow-sm" />
          </div>
        </div>
      </section>

      <!-- 6 VALUE PILLARS -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-16">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">SIX CORE VALUE PILLARS</span>
            <h2 class="text-3xl sm:text-4xl font-black text-[#003366] mt-2 mb-4">Engineered for Complete Financial Control</h2>
            <p class="text-sm text-[#5A6E82]">Eliminate fragmented spreadsheets and disconnects between operations and accounting.</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-sm mb-4 font-mono">01</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">AI Chief Financial Officer</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  Composite health score (0-100), automated weekly executive briefings, and conversational ledger Q&amp;A with exact voucher citations.
                </p>
              </div>
              <a href="/${locale}/platform#ai-cfo" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Learn more &rarr;</a>
            </div>

            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-sm mb-4 font-mono">02</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">Document Intelligence &amp; OCR</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  Multi-channel intake (Telegram bot &amp; web upload), AI vision extraction of vendor names, DPP, and PPN 11% with human verification drawer.
                </p>
              </div>
              <a href="/${locale}/document-intelligence" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Review workflow &rarr;</a>
            </div>

            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-sm mb-4 font-mono">03</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">Indonesian Tax Radar</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  Indonesian statutory calendar monitoring, PPh 21 TER, PPh 23, PPN 11%, and CoreTax PMK 81/2024 compliance advisories.
                </p>
              </div>
              <a href="/${locale}/compliance" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Explore radar &rarr;</a>
            </div>

            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-sm mb-4 font-mono">04</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">Bank Reconciliation &amp; Auditor Export</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  BCA Giro CSV and Permata e-Statement parsers with one-click downloadable Accountant Readiness Package (ZIP).
                </p>
              </div>
              <a href="/${locale}/platform#bank-import" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Inspect package &rarr;</a>
            </div>

            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-sm mb-4 font-mono">05</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">Multi-Entity &amp; Treasury</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  Support for IDR, USD, EUR, and SGD multi-currency balances with real-time Bank Indonesia (BI) middle rate revaluations.
                </p>
              </div>
              <a href="/${locale}/platform#treasury" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">View multi-currency &rarr;</a>
            </div>

            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-sm mb-4 font-mono">06</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">Role Permissions &amp; Audit Trail</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  Rigid separation of roles between executive, finance operator, and external tax consultant with immutable audit timestamps.
                </p>
              </div>
              <a href="/${locale}/platform#audit" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Inspect security &rarr;</a>
            </div>
          </div>
        </div>
      </section>

      <!-- 3 PERSONA TABS -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50 border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-14">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">BUILT FOR YOUR ROLE</span>
            <h2 class="text-3xl font-black text-[#003366] mt-2 mb-4">Tailored Perspectives for Every Stakeholder</h2>
            <p class="text-sm text-[#5A6E82]">Whether you own the company, run day-to-day operations, or audit monthly tax filings.</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div class="bento-card p-8 bg-white border border-slate-200">
              <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider block mb-2">Founders &amp; Directors</span>
              <h3 class="text-xl font-black text-[#003366] mb-3">Total Cash Clarity Without Micromanagement</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed mb-6">
                Receive weekly automated financial executive summaries on WhatsApp or email. Know your exact runway in days and burn rate across all subsidiaries without digging through spreadsheets.
              </p>
              <ul class="text-xs space-y-2 text-slate-700">
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>Real-time cash balance across all Indonesian bank accounts</li>
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>Predictive runway trajectory (30 / 60 / 90 days)</li>
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>Approval workflows for payments exceeding thresholds</li>
              </ul>
            </div>

            <div class="bento-card p-8 bg-white border-2 border-[#1565C0] shadow-md relative">
              <div class="absolute -top-3 left-6 bg-[#1565C0] text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded">Core Workflow</div>
              <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider block mb-2">In-House Finance Teams</span>
              <h3 class="text-xl font-black text-[#003366] mb-3">Eliminate 80% of Manual Ledger Work</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed mb-6">
                Snap photos of paper receipts or upload PDF tax invoices. OCR extracts DPP, PPN 11%, and vendor details, automatically matching transactions to imported bank statement rows.
              </p>
              <ul class="text-xs space-y-2 text-slate-700">
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>BCA &amp; Permata statement auto-matching</li>
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>Side-by-side OCR verification drawer</li>
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>Automatic withholding tax (PPh 23) calculation</li>
              </ul>
            </div>

            <div class="bento-card p-8 bg-white border border-slate-200">
              <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider block mb-2">Konsultan Pajak &amp; CPAs</span>
              <h3 class="text-xl font-black text-[#003366] mb-3">Pre-Balanced Month-End Audit Packages</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed mb-6">
                Stop chasing clients for missing receipts at month-end. Download a complete, pre-reconciled Accountant Readiness Package ZIP with structured General Ledger CSVs and tax schedules.
              </p>
              <ul class="text-xs space-y-2 text-slate-700">
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>One-click Accountant Readiness ZIP download</li>
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>Pre-calculated PPh 21 TER schedules for payroll</li>
                <li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>CoreTax PMK 81/2024 structured data export</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- 3 INDONESIAN CUSTOMER STORIES -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-16">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">PROVEN IN PRODUCTION</span>
            <h2 class="text-3xl font-black text-[#003366] mt-2 mb-4">Trusted by Growing Indonesian Businesses</h2>
            <p class="text-sm text-[#5A6E82]">Real outcomes delivered across tech companies, hospitality groups, and commercial trade.</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div class="bento-card p-6">
              <div class="text-xs font-bold text-[#1565C0] mb-1 font-mono">CASE 01 &bull; JAKARTA SELATAN</div>
              <h3 class="font-black text-base text-[#003366] mb-3">PT Tech Indo Digital</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed mb-6">
                "Scaling from 15 to 60 engineers created severe payroll tax calculation overhead. CFO AI automated our monthly PPh 21 TER brackets and eliminated 3 days of manual calculation every month."
              </p>
              <div class="border-t border-slate-100 pt-4 text-[11px] text-slate-500 font-semibold">
                Outcome: 100% PPh 21 accuracy &bull; Zero penalty notices
              </div>
            </div>

            <div class="bento-card p-6">
              <div class="text-xs font-bold text-[#1565C0] mb-1 font-mono">CASE 02 &bull; BADUNG, BALI</div>
              <h3 class="font-black text-base text-[#003366] mb-3">Bali Hospitality Group</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed mb-6">
                "Managing 4 boutique resorts across 8 BCA Giro and Mandiri accounts was chaos. Pulse unified all liquidity in real-time, allowing our management board to forecast villa expansion runway with total confidence."
              </p>
              <div class="border-t border-slate-100 pt-4 text-[11px] text-slate-500 font-semibold">
                Outcome: Unified multi-property runway &bull; 162 days visibility
              </div>
            </div>

            <div class="bento-card p-6">
              <div class="text-xs font-bold text-[#1565C0] mb-1 font-mono">CASE 03 &bull; JAKARTA BARAT</div>
              <h3 class="font-black text-base text-[#003366] mb-3">Jakarta Trading Co (PT PMA)</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed mb-6">
                "As a foreign-owned PT PMA trading firm, multi-currency receipts and PPN 11% reconciliation used to take our external accountants 10 days every month-end. With CFO AI, our closing takes 48 hours."
              </p>
              <div class="border-t border-slate-100 pt-4 text-[11px] text-slate-500 font-semibold">
                Outcome: 75% reduction in month-end close cycle
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- FAQ ACCORDION -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50 border-b border-[#E2E8F0]">
        <div class="max-w-4xl mx-auto">
          <div class="text-center mb-12">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">FREQUENTLY ASKED QUESTIONS</span>
            <h2 class="text-3xl font-black text-[#003366] mt-2 mb-3">Everything You Need to Know</h2>
            <p class="text-sm text-[#5A6E82]">Clear answers about trial periods, security, Indonesian tax alignment, and bank connectivity.</p>
          </div>

          <div class="space-y-4 text-left">
            <div class="bento-card p-6">
              <h3 class="font-black text-sm text-[#003366] mb-2">How does the 7-day free trial work?</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">
                You get full, unrestricted access to your chosen plan for 168 hours (7 days). No credit card is required to register. You can upload documents, connect bank statements, and run tax calculations immediately. If you decide not to subscribe, your data remains safely exportable.
              </p>
            </div>

            <div class="bento-card p-6">
              <h3 class="font-black text-sm text-[#003366] mb-2">Which Indonesian banks are supported for statement import?</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">
                CFO AI natively parses official statement exports from Bank Central Asia (BCA Giro CSV and KlikBCA Bisnis), Bank Mandiri (MCM CSV), Bank Permata (e-Statement PDF/CSV), and Bank Rakyat Indonesia (BRI). Custom formats can also be mapped with our auto-delimiter detection.
              </p>
            </div>

            <div class="bento-card p-6">
              <h3 class="font-black text-sm text-[#003366] mb-2">Does CFO AI replace our registered Indonesian Konsultan Pajak?</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">
                No. CFO AI is an operational financial operating system, not a licensed tax consulting firm. It does not file official SPT tax returns on your behalf or provide formal legal audit opinions. Instead, it provides your in-house team and external Konsultan Pajak with structured, pre-balanced tax schedules and complete audit packages.
              </p>
            </div>

            <div class="bento-card p-6">
              <h3 class="font-black text-sm text-[#003366] mb-2">How is customer financial data protected under Indonesian Law?</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">
                All data is encrypted in transit using TLS 1.3 and at rest with AES-256. We maintain strict compliance with Indonesia's Personal Data Protection Law (UU PDP / Law No. 27/2022). Each company's data resides in isolated database schemas. We enforce a strict zero-data-sharing policy: customer ledger data is never sold, shared, or used to train public AI models.
              </p>
            </div>

            <div class="bento-card p-6">
              <h3 class="font-black text-sm text-[#003366] mb-2">Is CFO AI ready for the PMK 81/2024 CoreTax transition?</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">
                Yes. Our statutory compliance engine incorporates the new CoreTax data taxonomy mandated by the Directorate General of Taxes (DGT). Exported readiness packages include structured schemas matching the upcoming CoreTax filing format.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- KNOWLEDGE HUB PREVIEW SECTION -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto">
          <div class="flex flex-col sm:flex-row items-baseline justify-between mb-12">
            <div>
              <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">KNOWLEDGE HUB</span>
              <h2 class="text-2xl sm:text-3xl font-black text-[#003366] mt-1">Authoritative Indonesian Tax &amp; Finance Guides</h2>
            </div>
            <a href="/${locale}/blog" class="text-xs font-bold text-[#1565C0] hover:underline mt-4 sm:mt-0">
              Browse all 12 guides &rarr;
            </a>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            ${articles.map(art => {
              const trans = art.translations?.[locale] || art.translations?.['en'] || {};
              return `
                <div class="bento-card p-6 flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between text-[11px] text-[#5A6E82] mb-3">
                      <span class="font-bold text-[#1565C0] bg-blue-50 px-2 py-0.5 rounded">${art.category_name}</span>
                      <span>${art.reading_time_minutes} min read</span>
                    </div>
                    <h3 class="font-black text-base text-[#003366] mb-2 leading-snug">
                      <a href="/${locale}/blog/${art.slug}" class="hover:text-[#1565C0]">${trans.title || art.slug}</a>
                    </h3>
                    <p class="text-xs text-[#5A6E82] line-clamp-3 leading-relaxed mb-6">
                      ${trans.excerpt || ''}
                    </p>
                  </div>
                  <div class="border-t border-slate-100 pt-4 flex items-center justify-between text-xs text-[#5A6E82]">
                    <span>${art.author?.name}</span>
                    <a href="/${locale}/blog/${art.slug}" class="font-bold text-[#1565C0] hover:underline">Read &rarr;</a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>

      <!-- CTA BANNER -->
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-[#002244] text-white text-center">
        <div class="max-w-4xl mx-auto">
          <h2 class="text-3xl sm:text-4xl font-black tracking-tight mb-4">Ready to bring complete clarity to your business finances?</h2>
          <p class="text-sm text-slate-300 max-w-xl mx-auto mb-8">Join Indonesian businesses that have streamlined cash visibility, bank reconciliation, and tax readiness with CFO AI.</p>
          <a href="https://app.cfo-ai.site/login" class="inline-block text-sm font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-8 py-4 rounded-xl shadow-lg transition-all min-h-[44px]">
            Start Free Trial (7 Days) &rarr;
          </a>
          <div class="text-[11px] text-slate-400 mt-4">Zero credit card required &bull; Instant activation</div>
        </div>
      </section>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'home',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- LOCALIZED PRICING PAGE (/:locale/pricing) ---
  router.get('/:locale/pricing', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/pricing');

    const pricing = contentStore.getPricing();
    const seo = contentStore.getSeo();
    const title = seo.pages_meta?.pricing?.title || 'Pricing & Plans — CFO AI Indonesia';
    const description = seo.pages_meta?.pricing?.description || 'Transparent pricing plans for Indonesian PT and PT PMA companies. 7-day free trial on all plans.';
    const canonical = `https://cfo-ai.site/${locale}/pricing`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/pricing`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-tint border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto text-center">
          <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">TRANSPARENT SUBSCRIPTION PRICING</span>
          <h1 class="text-3xl sm:text-5xl font-black text-[#003366] mt-2 mb-4">${pricing.headline}</h1>
          <p class="text-sm text-[#5A6E82] max-w-2xl mx-auto mb-10">${pricing.subheadline}</p>

          <!-- Interactive Billing Interval Switcher -->
          <div class="inline-flex items-center p-1.5 rounded-xl bg-white border border-[#CBD5E1] shadow-sm mb-12">
            <button id="btn-monthly" onclick="setBillingInterval('monthly')" class="px-5 py-2 rounded-lg text-xs font-bold transition-all bg-[#003366] text-white min-h-[44px]">
              Monthly Billing
            </button>
            <button id="btn-annual" onclick="setBillingInterval('annual')" class="px-5 py-2 rounded-lg text-xs font-bold transition-all text-[#5A6E82] hover:text-[#003366] min-h-[44px] flex items-center gap-1.5">
              <span>Annual Billing</span>
              <span class="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-extrabold">-20% DISCOUNT</span>
            </button>
          </div>

          <!-- PRICING CARDS -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto mb-16 text-left">
            ${pricing.plans.map(p => `
              <div class="bento-card p-8 flex flex-col justify-between ${p.is_recommended ? 'border-2 border-[#1565C0] shadow-xl relative' : ''}">
                ${p.is_recommended ? `<div class="absolute -top-3.5 left-1/2 transform -translate-x-1/2 bg-[#1565C0] text-white text-[10px] font-black uppercase px-3 py-1 rounded-full">${p.badge}</div>` : ''}
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-black uppercase text-[#1565C0]">${p.name}</span>
                    <span class="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">7-Day Free Trial</span>
                  </div>
                  <h3 class="text-xl font-black text-[#003366] mb-1">${p.tagline}</h3>
                  <p class="text-xs text-[#5A6E82] mb-6">${p.description}</p>
                  
                  <div class="flex items-baseline gap-1 mb-6">
                    <span class="text-4xl font-black text-[#003366] font-mono-num plan-price" data-monthly="${p.price_monthly}" data-annual="${Math.round(p.price_monthly * 0.8)}">$${p.price_monthly}</span>
                    <span class="text-xs text-[#5A6E82] plan-interval">/ month (USD)</span>
                  </div>

                  <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-[#003366] font-semibold mb-6 space-y-1.5">
                    ${p.capacity_highlights.map(h => `<div class="flex justify-between"><span>${h.label}:</span><span class="font-bold text-[#1565C0]">${h.value}</span></div>`).join('')}
                  </div>

                  <ul class="space-y-2 text-xs text-[#334155] mb-8">
                    ${p.feature_bullets.map(b => `<li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1565C0]"></span>${b}</li>`).join('')}
                  </ul>
                </div>

                <a href="${p.cta_url}" class="w-full text-center text-xs font-bold py-3.5 rounded-xl transition-all min-h-[44px] flex items-center justify-center ${p.is_recommended ? 'bg-[#1565C0] hover:bg-[#10529C] text-white shadow-md' : 'bg-white hover:bg-slate-50 text-[#003366] border border-[#CBD5E1]'}">
                  ${p.cta_text} &rarr;
                </a>
              </div>
            `).join('')}
          </div>

          <!-- USAGE LIMITS COMPARISON TABLE (11 Authoritative Limits) -->
          <div class="max-w-6xl mx-auto mb-16 text-left">
            <h2 class="text-2xl font-black text-[#003366] mb-2 text-center">Comprehensive Usage Entitlements</h2>
            <p class="text-xs text-[#5A6E82] mb-8 text-center">Every limit is strictly enforced with zero silent penalties.</p>

            <div class="bento-card overflow-x-auto shadow-sm">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-slate-50 border-b border-slate-200 text-[#003366] font-bold">
                    <th class="p-4">Operational Limit Category</th>
                    <th class="p-4 text-center">Starter ($59/mo)</th>
                    <th class="p-4 text-center bg-blue-50/50 text-[#1565C0]">Control ($149/mo)</th>
                    <th class="p-4 text-center">Pro ($249/mo)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${(pricing.usage_limits_table || []).map(row => `
                    <tr class="hover:bg-slate-50/50">
                      <td class="p-4 font-semibold text-[#003366]">${row.label}</td>
                      <td class="p-4 text-center font-mono-num text-slate-700">${row.starter}</td>
                      <td class="p-4 text-center font-mono-num font-bold text-[#1565C0] bg-blue-50/30">${row.control}</td>
                      <td class="p-4 text-center font-mono-num text-slate-700">${row.pro}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- 12 FEATURE CATEGORIES COMPARISON TABLE -->
          <div class="max-w-6xl mx-auto mb-16 text-left">
            <h2 class="text-2xl font-black text-[#003366] mb-2 text-center">Feature Matrix Comparison</h2>
            <p class="text-xs text-[#5A6E82] mb-8 text-center">Full functionality breakdown across Starter, Control, and Pro plans.</p>

            <div class="bento-card overflow-x-auto shadow-sm">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-slate-50 border-b border-slate-200 text-[#003366] font-bold">
                    <th class="p-4">Feature Module</th>
                    <th class="p-4 text-center">Starter</th>
                    <th class="p-4 text-center bg-blue-50/50 text-[#1565C0]">Control</th>
                    <th class="p-4 text-center">Pro</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${(pricing.features_table || []).map(f => {
                    const renderVal = val => {
                      if (val === true) return '<span class="text-emerald-600 font-bold font-mono">YES</span>';
                      if (val === false) return '<span class="text-slate-300 font-mono">-</span>';
                      return `<span class="text-slate-700 font-semibold">${val}</span>`;
                    };
                    return `
                      <tr class="hover:bg-slate-50/50">
                        <td class="p-4 font-semibold text-[#003366]">${f.name}</td>
                        <td class="p-4 text-center">${renderVal(f.starter)}</td>
                        <td class="p-4 text-center bg-blue-50/30">${renderVal(f.control)}</td>
                        <td class="p-4 text-center">${renderVal(f.pro)}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Enterprise Custom Inquiries Banner -->
          <div class="bento-card p-8 bg-[#002244] text-white max-w-4xl mx-auto text-center">
            <h3 class="text-xl font-black mb-2">Need a custom multi-entity deployment?</h3>
            <p class="text-xs text-slate-300 max-w-xl mx-auto mb-6">For groups operating more than 5 Indonesian entities, holding companies, or specialized CoreTax ERP integrations.</p>
            <a href="mailto:enterprise@cfo-ai.site" class="inline-block text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-6 py-3 rounded-xl min-h-[44px]">
              Contact Enterprise Advisory &rarr;
            </a>
          </div>
        </div>
      </section>

      <script>
        function setBillingInterval(mode) {
          const btnMonthly = document.getElementById('btn-monthly');
          const btnAnnual = document.getElementById('btn-annual');
          const priceEls = document.querySelectorAll('.plan-price');
          const intervalEls = document.querySelectorAll('.plan-interval');

          if (mode === 'annual') {
            btnAnnual.classList.remove('text-[#5A6E82]', 'hover:text-[#003366]');
            btnAnnual.classList.add('bg-[#003366]', 'text-white');
            btnMonthly.classList.remove('bg-[#003366]', 'text-white');
            btnMonthly.classList.add('text-[#5A6E82]', 'hover:text-[#003366]');

            priceEls.forEach(el => {
              el.textContent = '$' + el.getAttribute('data-annual');
            });
            intervalEls.forEach(el => {
              el.textContent = '/ month, billed annually';
            });
          } else {
            btnMonthly.classList.remove('text-[#5A6E82]', 'hover:text-[#003366]');
            btnMonthly.classList.add('bg-[#003366]', 'text-white');
            btnAnnual.classList.remove('bg-[#003366]', 'text-white');
            btnAnnual.classList.add('text-[#5A6E82]', 'hover:text-[#003366]');

            priceEls.forEach(el => {
              el.textContent = '$' + el.getAttribute('data-monthly');
            });
            intervalEls.forEach(el => {
              el.textContent = '/ month (USD)';
            });
          }
        }
      </script>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'pricing',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- KNOWLEDGE HUB DIRECTORY (/:locale/blog) ---
  router.get('/:locale/blog', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/blog');

    const categories = contentStore.getHubCategories();
    const articles = contentStore.getHubArticles();
    const briefs = contentStore.getHubBriefs();
    const seo = contentStore.getSeo();

    const title = seo.pages_meta?.blog?.title || 'Knowledge Hub — Indonesian Business Tax & Finance Guides';
    const description = seo.pages_meta?.blog?.description || 'Authoritative guides on PT PMA taxation, PPh 21 TER formulas, CoreTax PMK 81/2024, and Indonesian financial operations.';
    const canonical = `https://cfo-ai.site/${locale}/blog`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/blog`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-tint border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-12">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">CFO AI KNOWLEDGE HUB</span>
            <h1 class="text-3xl sm:text-5xl font-black text-[#003366] mt-2 mb-4">Indonesian Tax &amp; Finance Authority</h1>
            <p class="text-sm text-[#5A6E82] leading-relaxed">
              Clear, practical regulatory and operational intelligence for PT and PT PMA business directors, in-house finance teams, and licensed Konsultan Pajak.
            </p>
          </div>

          <!-- 6 CATEGORIES CHIPS -->
          <div class="flex flex-wrap items-center justify-center gap-2 mb-12">
            <a href="/${locale}/blog" class="px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#003366] text-white">All Categories (6)</a>
            ${categories.map(cat => `
              <span class="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:border-[#1565C0] hover:text-[#1565C0] cursor-pointer">
                ${cat.name}
              </span>
            `).join('')}
          </div>

          <!-- 3 CORNERSTONE DEEP-DIVE ARTICLES -->
          <div class="mb-16">
            <h2 class="text-xl font-black text-[#003366] mb-6">Cornerstone Regulatory Guides</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
              ${articles.map(art => {
                const trans = art.translations?.[locale] || art.translations?.['en'] || {};
                return `
                  <article class="bento-card p-6 flex flex-col justify-between hover:border-[#1565C0]">
                    <div>
                      <div class="flex items-center justify-between text-[11px] text-[#5A6E82] mb-3">
                        <span class="font-bold text-[#1565C0] bg-blue-50 px-2 py-0.5 rounded">${art.category_name}</span>
                        <span class="font-mono">${art.reading_time_minutes} min read</span>
                      </div>
                      <h3 class="font-black text-lg text-[#003366] mb-3 leading-snug">
                        <a href="/${locale}/blog/${art.slug}" class="hover:text-[#1565C0]">${trans.title || art.slug}</a>
                      </h3>
                      <p class="text-xs text-[#5A6E82] line-clamp-3 leading-relaxed mb-6">
                        ${trans.excerpt || ''}
                      </p>
                    </div>

                    <div class="border-t border-slate-100 pt-4 flex items-center justify-between text-xs text-[#5A6E82]">
                      <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-full bg-blue-100 text-[#1565C0] font-bold flex items-center justify-center text-[10px]">
                          ${art.author?.name ? art.author.name[0] : 'C'}
                        </div>
                        <span class="font-medium text-slate-700">${art.author?.name}</span>
                      </div>
                      <a href="/${locale}/blog/${art.slug}" class="font-bold text-[#1565C0] hover:underline">Read Guide &rarr;</a>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          </div>

          <!-- 9 UPCOMING TOPIC BRIEFS -->
          <div>
            <h2 class="text-xl font-black text-[#003366] mb-2">Operational Library &amp; Executive Briefs</h2>
            <p class="text-xs text-[#5A6E82] mb-6">Curated compliance memoranda prepared by our tax and finance research team.</p>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              ${briefs.map(b => `
                <div class="bento-card p-5 bg-white border border-slate-200">
                  <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-2">
                    <span class="text-[#1565C0] font-bold uppercase">${b.category}</span>
                    <span>${b.reading_time_minutes} min</span>
                  </div>
                  <h3 class="font-bold text-sm text-[#003366] mb-2">${b.title}</h3>
                  <p class="text-xs text-[#5A6E82] leading-relaxed line-clamp-2">${b.summary}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </section>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'blog',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- KNOWLEDGE HUB ARTICLE VIEW (/:locale/blog/:slug) ---
  router.get('/:locale/blog/:slug', (req, res) => {
    const { locale, slug } = req.params;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect(`/id/blog/${slug}`);

    const article = contentStore.getHubArticle(slug);
    if (!article) return res.redirect(`/${locale}/blog`);

    const trans = article.translations?.[locale] || article.translations?.['en'] || {};
    const title = trans.title ? `${trans.title} — CFO AI Knowledge Hub` : article.slug;
    const description = trans.excerpt || 'Authoritative Indonesian business and tax guide.';
    const canonical = `https://cfo-ai.site/${locale}/blog/${slug}`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/blog/${slug}`
    }));

    const contentHtml = `
      <article class="py-16 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#E2E8F0]">
        <div class="max-w-4xl mx-auto">
          <!-- BREADCRUMBS -->
          <nav class="flex items-center gap-2 text-xs text-slate-400 mb-8 font-medium">
            <a href="/${locale}" class="hover:text-[#1565C0]">Home</a>
            <span>/</span>
            <a href="/${locale}/blog" class="hover:text-[#1565C0]">Knowledge Hub</a>
            <span>/</span>
            <span class="text-slate-600 truncate">${article.category_name}</span>
          </nav>

          <!-- HEADER -->
          <header class="mb-12">
            <div class="flex flex-wrap items-center gap-3 text-xs mb-4">
              <span class="font-bold text-[#1565C0] bg-blue-50 px-3 py-1 rounded-full">${article.category_name}</span>
              <span class="text-slate-400 font-mono">${article.reading_time_minutes} min read</span>
              <span class="text-slate-400">&bull;</span>
              <span class="text-slate-500 font-mono">Updated: ${(article.last_updated || article.publication_date || '2026-10-18').substring(0, 10)}</span>
              <span class="text-slate-400">&bull;</span>
              <span class="text-slate-500 font-semibold"><span class="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono font-bold mr-1.5">ID</span> JURISDICTION: INDONESIA (ID)</span>
            </div>

            <h1 class="text-3xl sm:text-5xl font-black text-[#003366] tracking-tight leading-tight mb-6">
              ${trans.title}
            </h1>

            <p class="text-base sm:text-lg text-[#5A6E82] leading-relaxed mb-8 border-l-4 border-[#1565C0] pl-4 italic">
              ${trans.excerpt}
            </p>

            <div class="flex items-center justify-between py-4 border-y border-slate-100 text-xs text-slate-600">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-blue-100 text-[#1565C0] font-black flex items-center justify-center text-sm">
                  ${article.author?.name ? article.author.name[0] : 'C'}
                </div>
                <div>
                  <div class="font-bold text-[#003366]">${article.author?.name}</div>
                  <div class="text-[11px] text-slate-400">${article.author?.title}</div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-[11px] text-slate-400">Statutory Citation:</div>
                <div class="font-mono font-bold text-[#003366]">UU No. 7/2021 &bull; PMK No. 81/2024</div>
              </div>
            </div>
          </header>

          <!-- BODY CONTENT -->
          <div class="prose prose-slate max-w-none text-slate-700 text-sm leading-relaxed space-y-6">
            ${(trans.body_markdown || '').split('\n\n').map(p => {
              if (p.startsWith('## ')) return `<h2 class="text-2xl font-black text-[#003366] pt-6 pb-2 border-b border-slate-100">${p.replace('## ', '')}</h2>`;
              if (p.startsWith('### ')) return `<h3 class="text-lg font-bold text-[#003366] pt-4 pb-1">${p.replace('### ', '')}</h3>`;
              if (p.startsWith('- ')) {
                const items = p.split('\n').map(li => `<li>${li.replace(/^- /, '')}</li>`).join('');
                return `<ul class="list-disc pl-5 space-y-1">${items}</ul>`;
              }
              return `<p>${p}</p>`;
            }).join('')}
          </div>

          <!-- AUTHOR BOX & CTA FOOTER -->
          <div class="mt-16 pt-8 border-t border-slate-200">
            <div class="bento-card p-6 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-6">
              <div>
                <h4 class="font-black text-sm text-[#003366] mb-1">Automate Indonesian Tax &amp; Cash Flow Workflows</h4>
                <p class="text-xs text-[#5A6E82]">CFO AI automates PPh 21 TER, bank reconciliation, and CoreTax readiness for your company.</p>
              </div>
              <a href="https://app.cfo-ai.site/login" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-6 py-3 rounded-xl shadow-sm whitespace-nowrap min-h-[44px] flex items-center justify-center">
                Start 7-Day Free Trial &rarr;
              </a>
            </div>
          </div>
        </div>
      </article>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'blog',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- PLATFORM PAGE (/:locale/platform) ---
  router.get('/:locale/platform', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/platform');

    const seo = contentStore.getSeo();
    const title = seo.pages_meta?.platform?.title || 'Platform Architecture & 12 Core Modules — CFO AI Indonesia';
    const description = seo.pages_meta?.platform?.description || 'A complete tour of the CFO AI financial operating system engineered for Indonesian businesses.';
    const canonical = `https://cfo-ai.site/${locale}/platform`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/platform`
    }));

    const modules = [
      { id: 'pulse', num: '01', title: 'Pulse Command Center', desc: 'Executive financial cockpit offering unified multi-currency liquidity visibility across BCA, Mandiri, Permata, and cash floats with real-time runway forecasting.', img: '/assets/product/dashboard-pulse.svg' },
      { id: 'radar', num: '02', title: 'Radar Forward Trajectory', desc: 'Predictive cash flow modeling with 30, 60, and 90-day step horizons. Interactive what-if scenario levers simulate customer payment delays and corporate tax installments.', img: '/assets/product/analytics-radar.svg' },
      { id: 'bank-import', num: '03', title: 'Bank Reconciliation Engine', desc: 'Automated statement parsers for BCA Giro CSV and Permata e-Statements. Matches bank rows against ledger bills and invoices with 99.4% algorithmic accuracy.', img: '/assets/product/dashboard-pulse.svg' },
      { id: 'invoicing', num: '04', title: 'Invoicing & Accounts Receivable (AR)', desc: 'Multi-currency sales invoicing with Indonesian Rupiah (IDR) statutory equivalents, aging analysis, customer credit monitoring, and automated payment receipts.', img: '/assets/product/ai-cfo-brief.svg' },
      { id: 'bills', num: '05', title: 'Bills & Accounts Payable (AP)', desc: 'Vendor bill management with approval thresholds, duplicate detection, payment scheduling, and automated withholding tax deduction (PPh 23).', img: '/assets/product/document-review-drawer.svg' },
      { id: 'doc-intelligence', num: '06', title: 'Document Intelligence & OCR', desc: 'Multimodal AI vision extraction for Indonesian tax invoices (Faktur Pajak) and receipts. Automatically parses vendor name, DPP, PPN 11%, and QR verification links.', img: '/assets/product/document-review-drawer.svg' },
      { id: 'tax-radar', num: '07', title: 'Indonesian Tax Radar', desc: 'Continuous statutory calendar monitoring for PPh 21 TER, PPh 23, PPh 4(2), and PPN 11%. Automated tax worksheets prevent late penalties under UU KUP.', img: '/assets/product/compliance-calendar-radar.svg' },
      { id: 'treasury', num: '08', title: 'Multi-Entity & Multi-Currency Treasury', desc: 'Manage holding structures, parent-subsidiary intercompany balances, and multi-currency accounts (IDR, USD, EUR, SGD) with Bank Indonesia middle rate revaluation.', img: '/assets/product/dashboard-pulse.svg' },
      { id: 'ai-cfo', num: '09', title: 'AI Chief Financial Officer', desc: 'Conversational natural language interface answering ledger inquiries (e.g., "What was our marketing burn last quarter?") with exact voucher citations.', img: '/assets/product/ai-cfo-brief.svg' },
      { id: 'accountant-package', num: '10', title: 'Accountant Readiness Package Export', desc: 'One-click export of an auditor-ready ZIP package containing balanced General Ledger CSVs, reconciliation logs, tax schedules, and receipt archives.', img: '/assets/product/compliance-calendar-radar.svg' },
      { id: 'coretax', num: '11', title: 'CoreTax PMK 81/2024 Integration Bridge', desc: 'Structured data extraction and validation pipeline matching the Directorate General of Taxes (DGT) CoreTax system specifications.', img: '/assets/product/compliance-calendar-radar.svg' },
      { id: 'audit', num: '12', title: 'RBAC & Immutable Audit Trail', desc: 'Granular access controls separating executive oversight, operator entry, and external accountant review with cryptographically verified audit timestamps.', img: '/assets/product/ai-cfo-brief.svg' }
    ];

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-tint border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto text-center">
          <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">PLATFORM ARCHITECTURE</span>
          <h1 class="text-3xl sm:text-5xl font-black text-[#003366] mt-2 mb-4">A Complete Financial Operating System</h1>
          <p class="text-sm text-[#5A6E82] max-w-2xl mx-auto mb-12">Discover how CFO AI replaces fragmented software with a unified, high-integrity financial operations workspace engineered for Indonesia.</p>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 text-left max-w-7xl mx-auto">
            ${modules.map(m => `
              <div id="${m.id}" class="bento-card p-6 flex flex-col justify-between scroll-mt-24">
                <div>
                  <div class="flex items-center justify-between mb-4">
                    <span class="text-xs font-mono font-bold text-[#1565C0] bg-blue-50 px-2 py-0.5 rounded">${m.num}</span>
                    <span class="text-[10px] uppercase font-bold text-slate-400">CFO AI Core</span>
                  </div>
                  <h3 class="font-black text-lg text-[#003366] mb-2">${m.title}</h3>
                  <p class="text-xs text-[#5A6E82] leading-relaxed mb-6">${m.desc}</p>
                </div>
                <div class="border-t border-slate-100 pt-4">
                  <img src="${m.img}" alt="${m.title}" class="w-full h-36 object-cover rounded-lg border border-slate-200" />
                </div>
              </div>
            `).join('')}
          </div>

          <div class="mt-16">
            <a href="https://app.cfo-ai.site/login" class="inline-block text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-8 py-3.5 rounded-xl shadow-md transition-all min-h-[44px]">
              Start Free Trial (7 Days) &rarr;
            </a>
          </div>
        </div>
      </section>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'platform',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- DOCUMENT INTELLIGENCE PAGE (/:locale/document-intelligence) ---
  router.get('/:locale/document-intelligence', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/document-intelligence');

    const seo = contentStore.getSeo();
    const title = seo.pages_meta?.doc?.title || 'Document Intelligence & Indonesian Tax Invoice OCR — CFO AI';
    const description = seo.pages_meta?.doc?.description || 'AI vision OCR extraction for Indonesian Faktur Pajak and receipts with side-by-side human review.';
    const canonical = `https://cfo-ai.site/${locale}/document-intelligence`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/document-intelligence`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-tint border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto text-center">
          <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">DOCUMENT INTELLIGENCE</span>
          <h1 class="text-3xl sm:text-5xl font-black text-[#003366] mt-2 mb-4">From Paper Receipt to General Ledger in Seconds</h1>
          <p class="text-sm text-[#5A6E82] max-w-2xl mx-auto mb-12">Eliminate 80% of manual data entry with multimodal vision OCR, human-in-the-loop verification, and automated bank matching.</p>

          <div class="bento-card p-6 bg-white border border-[#CBD5E1] shadow-xl max-w-4xl mx-auto mb-16 text-left">
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 text-xs text-[#5A6E82]">
              <span class="font-mono font-bold text-[#003366]">Verification Workbench — Side-by-Side Review Drawer</span>
              <span class="text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">100% Tax Line Match</span>
            </div>
            <img src="/assets/product/document-review-drawer.svg" alt="Document Review Drawer" class="w-full rounded-lg" />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-left max-w-5xl mx-auto mb-16">
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1565C0] block mb-2">FEATURE 01</span>
              <h3 class="font-black text-base text-[#003366] mb-2">Faktur Pajak &amp; QR Scanner</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">Instantly parses DGT standard tax invoices, extracting Nomor Seri Faktur Pajak (NSFP), NPWP, DPP, and PPN 11% with automated QR validation.</p>
            </div>
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1565C0] block mb-2">FEATURE 02</span>
              <h3 class="font-black text-base text-[#003366] mb-2">WhatsApp Mobile Intake</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">Field staff snap photos of fuel receipts or vendor invoices on WhatsApp. CFO AI ingests the image and stages it for review within 3 seconds.</p>
            </div>
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1565C0] block mb-2">FEATURE 03</span>
              <h3 class="font-black text-base text-[#003366] mb-2">Human-in-the-Loop Audit</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">High-confidence extractions are flagged for quick one-click confirmation. Ambiguous handwriting is highlighted for operator review.</p>
            </div>
          </div>

          <a href="https://app.cfo-ai.site/login" class="inline-block text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-8 py-3.5 rounded-xl shadow-md min-h-[44px]">
            Start Free Trial (7 Days) &rarr;
          </a>
        </div>
      </section>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'doc',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- TAX & COMPLIANCE PAGE (/:locale/compliance) ---
  router.get('/:locale/compliance', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/compliance');

    const seo = contentStore.getSeo();
    const title = seo.pages_meta?.compliance?.title || 'Indonesian Tax & CoreTax Radar — CFO AI';
    const description = seo.pages_meta?.compliance?.description || 'Automated compliance engine for PPh 21 TER, PPh 23, PPN 11%, and PMK 81/2024 CoreTax transition.';
    const canonical = `https://cfo-ai.site/${locale}/compliance`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/compliance`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-tint border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto text-center">
          <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">STATUTORY RADAR</span>
          <h1 class="text-3xl sm:text-5xl font-black text-[#003366] mt-2 mb-4">Indonesian Tax &amp; CoreTax Radar</h1>
          <p class="text-sm text-[#5A6E82] max-w-2xl mx-auto mb-12">Stay ahead of PPh 21 TER, PPh 23, PPN 11%, and PMK 81/2024 CoreTax transition deadlines with automated calculation worksheets.</p>

          <div class="bento-card p-6 bg-white border border-[#CBD5E1] shadow-xl max-w-4xl mx-auto mb-16 text-left">
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 text-xs text-[#5A6E82]">
              <span class="font-mono font-bold text-[#003366]">Statutory Calendar — Directorate General of Taxes (DGT)</span>
              <span class="text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">Current Filing Period</span>
            </div>
            <img src="/assets/product/compliance-calendar-radar.svg" alt="Compliance Radar" class="w-full rounded-lg" />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-left max-w-5xl mx-auto mb-16">
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1565C0] block mb-2">TAX REGIME 01</span>
              <h3 class="font-black text-base text-[#003366] mb-2">PPh 21 TER Engine</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">Automatically calculates monthly employee withholding using Tarif Efektif Rata-Rata (TER Categories A, B, C) per PP 58/2023 and PMK 168/2023.</p>
            </div>
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1565C0] block mb-2">TAX REGIME 02</span>
              <h3 class="font-black text-base text-[#003366] mb-2">PPh 23 &amp; PPh 4(2) Withholding</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">Tracks 2% service withholding and final tax on commercial property leases, auto-generating Bukti Potong summaries for month-end filing.</p>
            </div>
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1565C0] block mb-2">TAX REGIME 03</span>
              <h3 class="font-black text-base text-[#003366] mb-2">PPN 11% VAT Reconciliation</h3>
              <p class="text-xs text-[#5A6E82] leading-relaxed">Cross-checks Pajak Keluaran (output VAT) against Pajak Masukan (input VAT) to ensure accurate net tax payable before the end-of-month deadline.</p>
            </div>
          </div>

          <a href="https://app.cfo-ai.site/login" class="inline-block text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-8 py-3.5 rounded-xl shadow-md min-h-[44px]">
            Start Free Trial (7 Days) &rarr;
          </a>
        </div>
      </section>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'compliance',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- ABOUT PAGE (/:locale/about) ---
  router.get('/:locale/about', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/about');

    const seo = contentStore.getSeo();
    const title = 'About CFO AI — Built for Indonesian Business Financial Control';
    const description = 'Learn about CFO AI Indonesia: our mission, operational presence in Jakarta and Bali, leadership, and security commitments.';
    const canonical = `https://cfo-ai.site/${locale}/about`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/about`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-tint border-b border-[#E2E8F0]">
        <div class="max-w-4xl mx-auto">
          <div class="text-center mb-12">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">OUR MISSION</span>
            <h1 class="text-3xl sm:text-5xl font-black text-[#003366] mt-2 mb-4">Empowering Indonesian Businesses With Total Financial Control</h1>
            <p class="text-sm text-[#5A6E82] leading-relaxed">
              CFO AI was built to eliminate the chaos of fragmented spreadsheets, delayed reconciliations, and regulatory compliance friction for companies operating in Indonesia.
            </p>
          </div>

          <div class="space-y-8 text-left text-xs leading-relaxed text-slate-700">
            <div class="bento-card p-8">
              <h2 class="text-xl font-black text-[#003366] mb-3">Operational Background &amp; Footprint</h2>
              <p class="mb-4">
                Operating a PT or foreign-owned PT PMA in Indonesia involves distinct operational complexities: multi-currency transactions, unique withholding tax regimes (PPh 21 TER, PPh 23, PPh 4(2)), strict e-Faktur Pajak reconciliation, and the upcoming nationwide transition to the DGT CoreTax system.
              </p>
              <p>
                CFO AI maintains direct engineering and client operations across Jakarta and Bali. Our platform is purpose-built to navigate Indonesian banking formats (BCA, Mandiri, Permata) and local statutory accounting guidelines without expensive legacy enterprise consulting.
              </p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="bento-card p-6">
                <h3 class="font-black text-sm text-[#003366] mb-2">Bank &amp; Data Security</h3>
                <p class="text-[#5A6E82]">
                  We enforce bank-grade AES-256 encryption at rest and TLS 1.3 in transit. Tenant databases are isolated with strict row-level segregation. We will never share or sell customer financial data.
                </p>
              </div>
              <div class="bento-card p-6">
                <h3 class="font-black text-sm text-[#003366] mb-2">UU PDP Privacy Compliance</h3>
                <p class="text-[#5A6E82]">
                  Fully aligned with Indonesia's Personal Data Protection Law (Law No. 27/2022). Customer financial entries are never used to train public commercial AI models.
                </p>
              </div>
            </div>

            <div class="bento-card p-8 bg-[#002244] text-white">
              <h2 class="text-lg font-black mb-2">Statutory Accounting Disclosure</h2>
              <p class="text-slate-300 text-xs leading-relaxed mb-6">
                CFO AI is an operational financial operating system designed to provide real-time visibility, bank matching, and structured tax preparation. CFO AI does not issue formal statutory audit opinions or replace a licensed Indonesian Konsultan Pajak. We equip your internal finance team and external CPA with verified, audit-ready data.
              </p>
              <a href="https://app.cfo-ai.site/login" class="inline-block text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-6 py-3 rounded-xl min-h-[44px]">
                Start Free Trial (7 Days) &rarr;
              </a>
            </div>
          </div>
        </div>
      </section>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'about',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- PRIVACY POLICY PAGE (/:locale/privacy) ---
  router.get('/:locale/privacy', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/privacy');

    const title = 'Privacy Policy — CFO AI Indonesia (UU PDP Compliant)';
    const description = 'Official privacy policy for CFO AI Indonesia under Law No. 27/2022 (UU PDP) with strict zero-data-sharing policy.';
    const canonical = `https://cfo-ai.site/${locale}/privacy`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/privacy`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#E2E8F0]">
        <div class="max-w-4xl mx-auto text-left text-xs leading-relaxed text-slate-700 space-y-6">
          <div class="border-b border-slate-200 pb-6 mb-8">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">LEGAL &bull; UU PDP COMPLIANCE</span>
            <h1 class="text-3xl font-black text-[#003366] mt-2">Privacy Policy &amp; Data Protection</h1>
            <p class="text-slate-500 mt-1">Effective Date: October 2026 &bull; Indonesian Law No. 27/2022 (UU PDP)</p>
          </div>

          <h2 class="text-lg font-black text-[#003366] pt-2">1. Commitment to Data Sovereignty and Privacy</h2>
          <p>
            CFO AI Indonesia ("we", "our", or "the Platform") respects the privacy and confidentiality of your company's corporate, accounting, and personal data. This Privacy Policy outlines our procedures regarding the collection, processing, encryption, and protection of data processed via https://cfo-ai.site and https://app.cfo-ai.site.
          </p>

          <h2 class="text-lg font-black text-[#003366] pt-2">2. Zero Data-Sharing Policy for AI Models</h2>
          <p class="p-4 rounded-xl bg-blue-50 border border-blue-200 text-[#003366] font-semibold">
            Strict Zero-Sharing Guarantee: Your financial records, general ledger balances, invoices, vendor contacts, and employee payroll data are never sold, rented, monetized, or shared with third parties. Furthermore, customer financial records are NEVER used to train, retrain, or fine-tune public foundation AI models.
          </p>

          <h2 class="text-lg font-black text-[#003366] pt-2">3. Data Collection and Processing Purposes</h2>
          <p>We process information exclusively for the provision of operational financial services, including:</p>
          <ul class="list-disc pl-5 space-y-1">
            <li>Ingestion and optical character recognition (OCR) of commercial invoices and receipts.</li>
            <li>Reconciliation of uploaded bank statement rows (BCA, Mandiri, Permata).</li>
            <li>Computation of statutory withholding and value-added tax estimates (PPh 21 TER, PPh 23, PPN 11%).</li>
            <li>Generation of the downloadable Accountant Readiness Package (ZIP).</li>
          </ul>

          <h2 class="text-lg font-black text-[#003366] pt-2">4. Security Architecture and Tenant Isolation</h2>
          <p>
            All data in transit is encrypted using Transport Layer Security (TLS 1.3). Data at rest is encrypted using Advanced Encryption Standard (AES-256). Each commercial tenant operates with isolated relational schema partitions to prevent cross-customer data leakage.
          </p>

          <h2 class="text-lg font-black text-[#003366] pt-2">5. Data Retention and Deletion Rights</h2>
          <p>
            In accordance with Indonesian Law No. 27/2022 (UU PDP), business owners retain the right to request full export or permanent cryptographic deletion of their company tenant data at any time upon cancellation of subscription.
          </p>

          <div class="border-t border-slate-200 pt-6 mt-8">
            <p class="text-slate-500">For privacy or data protection inquiries, contact our Data Protection Officer at <span class="font-mono text-[#1565C0]">privacy@cfo-ai.site</span>.</p>
          </div>
        </div>
      </section>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'privacy',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- TERMS OF SERVICE PAGE (/:locale/terms) ---
  router.get('/:locale/terms', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/terms');

    const title = 'Terms of Service — CFO AI Indonesia';
    const description = 'Terms of Service governing the use of CFO AI Indonesia commercial software and services.';
    const canonical = `https://cfo-ai.site/${locale}/terms`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/terms`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#E2E8F0]">
        <div class="max-w-4xl mx-auto text-left text-xs leading-relaxed text-slate-700 space-y-6">
          <div class="border-b border-slate-200 pb-6 mb-8">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">LEGAL &bull; USER AGREEMENT</span>
            <h1 class="text-3xl font-black text-[#003366] mt-2">Terms of Service</h1>
            <p class="text-slate-500 mt-1">Effective Date: October 2026 &bull; Indonesian Jurisdiction</p>
          </div>

          <h2 class="text-lg font-black text-[#003366] pt-2">1. Acceptance of Terms</h2>
          <p>
            By accessing or using CFO AI (https://cfo-ai.site and https://app.cfo-ai.site), you agree to be bound by these Terms of Service. If you are entering into this agreement on behalf of a company or legal entity (e.g. PT or PT PMA), you represent that you have the authority to bind such entity.
          </p>

          <h2 class="text-lg font-black text-[#003366] pt-2">2. Description of Operational Service</h2>
          <p>
            CFO AI provides an automated financial management operating system featuring document OCR, cash flow tracking, bank statement reconciliation, and statutory tax tracking.
          </p>

          <h2 class="text-lg font-black text-[#003366] pt-2">3. Not a Statutory Audit or Licensed Tax Firm</h2>
          <p class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-semibold">
            Important Notice: CFO AI is an operational software platform. It does not provide certified public accountant (CPA) statutory audit opinions, and it does not replace a licensed Indonesian Konsultan Pajak. Users remain solely responsible for the accuracy and statutory submission of official tax filings to the Directorate General of Taxes (DGT).
          </p>

          <h2 class="text-lg font-black text-[#003366] pt-2">4. 7-Day Free Trial and Subscription Billing</h2>
          <p>
            All subscription plans include a 7-day (168-hour) trial period without credit card requirement. Upon subscription activation, fees are billed monthly or annually according to the agreed pricing schedule. Subscriptions may be cancelled at any time prior to the next billing cycle.
          </p>

          <h2 class="text-lg font-black text-[#003366] pt-2">5. Governing Law and Dispute Resolution</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the Republic of Indonesia. Any disputes arising out of these Terms shall be subject to amicable settlement, failing which they shall be submitted to the jurisdiction of the Indonesian courts.
          </p>

          <div class="border-t border-slate-200 pt-6 mt-8">
            <p class="text-slate-500">For legal or contractual inquiries, contact <span class="font-mono text-[#1565C0]">legal@cfo-ai.site</span>.</p>
          </div>
        </div>
      </section>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'terms',
      content: contentHtml,
      hreflangs
    }));
  });

  return router;
}

module.exports = createPublicRoutes;
