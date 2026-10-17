/**
 * Public Website & Knowledge Hub SSR Router
 * Powers https://cfo-ai.site with 16-locale routing, Concept B rendering, and dynamic SEO.
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
    // Detect browser header or default to Indonesian /id or English /en
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
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <style>
    body { font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #F8FAFC; color: #003366; }
    .font-mono-num { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum' on, 'zero' on; }
    .bento-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgba(0, 51, 102, 0.04), 0 2px 4px -2px rgba(0, 51, 102, 0.02); transition: all 0.2s ease; }
    .bento-card:hover { border-color: #CBD5E1; box-shadow: 0 10px 15px -3px rgba(0, 51, 102, 0.08); }
    .bg-ice-tint { background: linear-gradient(180deg, #F0F6FD 0%, #F8FAFC 100%); }
    .watermark-bg { background-image: radial-gradient(rgba(21, 101, 192, 0.04) 1px, transparent 1px); background-size: 24px 24px; }
  </style>
</head>
<body class="min-h-screen flex flex-col watermark-bg">

  <!-- TOP ANNOUNCEMENT BAR (Concept B+ Ice/Electric Treatment) -->
  <div class="bg-[#1565C0] text-white py-2 px-4 text-center text-xs font-semibold tracking-wide">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex-1 text-center">
        <span>Indonesia Tax Transition (PMK 81/2024 CoreTax) Readiness Package is now active.</span>
        <a href="/${locale}/blog/coretax-pmk-81-2024-transition-guide" class="ml-2 underline font-bold hover:text-blue-100">Read Director's Guide →</a>
      </div>
      <!-- Language Switcher in Header -->
      <div class="hidden sm:flex items-center gap-1.5 text-xs text-blue-100 ml-4">
        <span>🌐</span>
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
          <svg class="w-10 h-10" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="200" rx="40" fill="#003366"/>
            <path d="M50 140V60H85C105 60 115 70 115 85C115 100 105 110 85 110H70V140H50ZM70 94H83C93 94 98 89 98 85C98 81 93 76 83 76H70V94Z" fill="#FFFFFF"/>
            <path d="M125 140L145 60H165L145 140H125Z" fill="#1565C0"/>
            <circle cx="155" cy="70" r="12" fill="#3399FF"/>
          </svg>
          <div>
            <span class="text-xl font-black text-[#003366] tracking-tight block">CFO AI</span>
            <span class="text-[10px] font-bold text-[#5A6E82] uppercase tracking-wider block">Financial OS</span>
          </div>
        </a>

        <nav class="hidden md:flex items-center gap-6 text-sm font-semibold text-[#334155]">
          <a href="/${locale}/platform" class="hover:text-[#1565C0] ${activeTab === 'platform' ? 'text-[#1565C0] font-bold' : ''}">Platform</a>
          <a href="/${locale}/document-intelligence" class="hover:text-[#1565C0] ${activeTab === 'doc' ? 'text-[#1565C0] font-bold' : ''}">Document Intelligence</a>
          <a href="/${locale}/compliance" class="hover:text-[#1565C0] ${activeTab === 'compliance' ? 'text-[#1565C0] font-bold' : ''}">Tax &amp; Compliance</a>
          <a href="/${locale}/blog" class="hover:text-[#1565C0] ${activeTab === 'blog' ? 'text-[#1565C0] font-bold' : ''}">Knowledge Hub</a>
          <a href="/${locale}/pricing" class="hover:text-[#1565C0] ${activeTab === 'pricing' ? 'text-[#1565C0] font-bold' : ''}">Pricing</a>
        </nav>
      </div>

      <div class="flex items-center gap-4">
        <a href="https://app.cfo-ai.site/login" class="text-sm font-bold text-[#003366] hover:text-[#1565C0] px-3 py-2">
          Log In
        </a>
        <a href="https://app.cfo-ai.site/login" class="text-sm font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-5 py-2.5 rounded-xl shadow-sm transition-all">
          Start Free Trial (7 Days)
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
            <svg class="w-8 h-8" viewBox="0 0 200 200" fill="none">
              <rect width="200" height="200" rx="40" fill="#1565C0"/>
              <path d="M50 140V60H85C105 60 115 70 115 85C115 100 105 110 85 110H70V140H50ZM70 94H83C93 94 98 89 98 85C98 81 93 76 83 76H70V94Z" fill="#FFFFFF"/>
            </svg>
            <span class="text-xl font-black text-white">CFO AI Indonesia</span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed mb-6 max-w-sm">
            AI-powered financial operating system for businesses in Indonesia. Real-time cash visibility, OCR document extraction, automated bank reconciliation, and regulatory tax intelligence.
          </p>
          <div class="text-[11px] text-slate-400">
            Official Application: <a href="https://app.cfo-ai.site" class="text-blue-300 underline font-mono">app.cfo-ai.site</a>
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
          <h4 class="text-xs font-bold uppercase tracking-wider text-white mb-4">Compliance</h4>
          <ul class="space-y-2 text-xs">
            <li><a href="/${locale}/compliance" class="hover:text-white">Indonesian Tax Radar</a></li>
            <li><a href="/${locale}/compliance#coretax" class="hover:text-white">CoreTax Transition</a></li>
            <li><a href="/${locale}/platform#security" class="hover:text-white">Data Security &amp; Isolation</a></li>
            <li><a href="https://app.cfo-ai.site/login" class="text-blue-300 font-bold hover:underline">Start 7-Day Free Trial →</a></li>
          </ul>
        </div>
      </div>

      <div class="border-t border-slate-700 pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
        <div>© 2026 CFO AI Indonesia. All rights reserved.</div>
        <div class="text-[11px] max-w-xl text-center sm:text-right">
          CFO AI is an operational financial management system. It does not issue statutory audit opinions or replace a licensed Indonesian Konsultan Pajak.
        </div>
      </div>
    </div>
  </footer>

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

    const title = page?.title || seo.pages_meta?.home?.title;
    const description = seo.pages_meta?.home?.description;
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
            <span>🛡️</span>
            <span>${heroBlock.badge || 'DESIGNED FOR INDONESIA • PT & PT PMA'}</span>
          </div>
          <h1 class="text-4xl sm:text-6xl font-black text-[#003366] tracking-tight max-w-4xl mx-auto mb-6 leading-tight">
            ${heroBlock.title || 'Know your numbers. Control your business.'}
          </h1>
          <p class="text-base sm:text-lg text-[#5A6E82] max-w-2xl mx-auto mb-10 leading-relaxed">
            ${heroBlock.subtitle || 'Your AI Chief Financial Officer. Real-time cash visibility, document intelligence, automated bank reconciliation, and Indonesian tax compliance — unified in one financial operating system.'}
          </p>

          <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <a href="${heroBlock.primary_cta_url || 'https://app.cfo-ai.site/login'}" class="w-full sm:w-auto text-sm font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-8 py-4 rounded-xl shadow-lg transition-all">
              ${heroBlock.primary_cta_text || 'Start Free Trial (7 Days)'}
            </a>
            <a href="/${locale}/platform" class="w-full sm:w-auto text-sm font-bold bg-white hover:bg-slate-50 text-[#003366] border border-[#CBD5E1] px-8 py-4 rounded-xl transition-all">
              Explore Platform Tour →
            </a>
          </div>
          <div class="text-xs text-[#5A6E82] font-medium">
            ${heroBlock.trial_disclaimer || 'No credit card required • Instant company provisioning • Full access for 168 hours'}
          </div>

          <!-- Hero Software Illustration -->
          <div class="mt-14 max-w-5xl mx-auto bento-card p-4 sm:p-6 bg-white border border-[#CBD5E1] shadow-2xl">
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 text-xs text-[#5A6E82]">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-rose-400"></span>
                <span class="w-3 h-3 rounded-full bg-amber-400"></span>
                <span class="w-3 h-3 rounded-full bg-emerald-400"></span>
                <span class="font-mono ml-2 font-bold text-[#003366]">Pulse Command Center — PT Solusi Utama Nusantara</span>
              </div>
              <span class="text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">Live Operating Feed</span>
            </div>
            <img src="/assets/product/dashboard-pulse.svg" alt="CFO AI Pulse Dashboard" class="w-full rounded-lg" />
          </div>
        </div>
      </section>

      <!-- 4 VALUE PILLARS -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-16">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">FOUR CORE VALUE PILLARS</span>
            <h2 class="text-3xl sm:text-4xl font-black text-[#003366] mt-2 mb-4">Engineered for Complete Financial Control</h2>
            <p class="text-sm text-[#5A6E82]">Eliminate fragmented spreadsheets and disconnects between operations and accounting.</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-lg mb-4">01</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">AI Chief Financial Officer</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  Composite health score (0-100), automated weekly executive briefings, and conversational ledger Q&A with voucher citations.
                </p>
              </div>
              <a href="/${locale}/platform" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Learn more →</a>
            </div>

            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-lg mb-4">02</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">Document Intelligence</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  Multi-channel intake (Telegram bot & web upload), AI vision extraction of vendor names, DPP, and PPN 11% with review drawer.
                </p>
              </div>
              <a href="/${locale}/document-intelligence" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Review workflow →</a>
            </div>

            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-lg mb-4">03</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">Regulatory Intelligence</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  Indonesian statutory calendar monitoring, PPh 21 TER, PPh 23, PPN 11%, and CoreTax PMK 81/2024 compliance advisories.
                </p>
              </div>
              <a href="/${locale}/compliance" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Explore radar →</a>
            </div>

            <div class="bento-card p-6 flex flex-col justify-between">
              <div>
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1565C0] flex items-center justify-center font-bold text-lg mb-4">04</div>
                <h3 class="font-black text-lg text-[#003366] mb-2">Bank Reconciliation & Export</h3>
                <p class="text-xs text-[#5A6E82] leading-relaxed">
                  BCA Giro CSV and Permata e-Statement parsers with one-click downloadable Accountant Readiness Package (ZIP).
                </p>
              </div>
              <a href="/${locale}/platform#bank-import" class="text-xs font-bold text-[#1565C0] hover:underline mt-6 inline-block">Inspect package →</a>
            </div>
          </div>
        </div>
      </section>

      <!-- KNOWLEDGE HUB PREVIEW SECTION -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50 border-b border-[#E2E8F0]">
        <div class="max-w-7xl mx-auto">
          <div class="flex flex-col sm:flex-row items-baseline justify-between mb-12">
            <div>
              <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">KNOWLEDGE HUB</span>
              <h2 class="text-2xl sm:text-3xl font-black text-[#003366] mt-1">Authoritative Indonesian Tax &amp; Finance Guides</h2>
            </div>
            <a href="/${locale}/blog" class="text-xs font-bold text-[#1565C0] hover:underline mt-4 sm:mt-0">
              Browse all 12 guides →
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
                    <a href="/${locale}/blog/${art.slug}" class="font-bold text-[#1565C0] hover:underline">Read →</a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
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
    const description = seo.pages_meta?.pricing?.description || 'Transparent pricing plans for Indonesian PT and PT PMA companies.';
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
          <p class="text-sm text-[#5A6E82] max-w-2xl mx-auto mb-12">${pricing.subheadline}</p>

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
                    <span class="text-4xl font-black text-[#003366] font-mono-num">$${p.price_monthly}</span>
                    <span class="text-xs text-[#5A6E82]">/ month (USD)</span>
                  </div>

                  <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-[#003366] font-semibold mb-6 space-y-1.5">
                    ${p.capacity_highlights.map(h => `<div class="flex justify-between"><span>${h.label}:</span><span class="font-bold text-[#1565C0]">${h.value}</span></div>`).join('')}
                  </div>

                  <div class="space-y-2 text-xs text-[#334155] border-t border-slate-100 pt-6">
                    ${p.feature_bullets.map(b => `<div class="flex items-center gap-2"><span class="text-emerald-700">✓</span><span>${b}</span></div>`).join('')}
                  </div>
                </div>

                <div class="mt-8 pt-6 border-t border-slate-100">
                  <a href="${p.cta_url}" class="block w-full text-center text-xs font-bold py-3.5 rounded-xl transition-all ${p.is_recommended ? 'bg-[#1565C0] hover:bg-[#10529C] text-white shadow-md' : 'bg-slate-100 hover:bg-slate-200 text-[#003366]'}">
                    ${p.cta_text}
                  </a>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- TABLE 1: USAGE LIMITS MATRIX -->
          <div class="bento-card p-6 bg-slate-50 border border-slate-200 max-w-5xl mx-auto mb-12 text-left">
            <div class="text-center mb-6">
              <span class="text-[11px] font-bold text-[#1565C0] uppercase tracking-wider block">RESOURCE MATRIX</span>
              <h3 class="font-black text-xl text-[#003366] mt-0.5">Full Usage Limits Comparison</h3>
              <p class="text-xs text-[#5A6E82]">Commercial resource allowances across Starter, Control, and Pro plans.</p>
            </div>
            <div class="overflow-x-auto text-xs">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-slate-300 font-bold text-[#003366] bg-white">
                    <th class="p-3.5">Usage Limit</th>
                    <th class="p-3.5 text-center">Starter ($59)</th>
                    <th class="p-3.5 text-center bg-blue-50/80 font-bold text-[#1565C0] border-x border-blue-200">Control ($149)</th>
                    <th class="p-3.5 text-center">Pro ($249)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 text-[#334155]">
                  ${pricing.usage_limits_table.map(row => `
                    <tr class="hover:bg-white/60">
                      <td class="p-3 font-semibold text-[#003366]">${row.label}</td>
                      <td class="p-3 text-center font-mono">${row.starter}</td>
                      <td class="p-3 text-center bg-blue-50/40 font-mono font-bold text-[#1565C0] border-x border-blue-200">${row.control}</td>
                      <td class="p-3 text-center font-mono">${row.pro}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- TABLE 2: FEATURE AVAILABILITY MATRIX -->
          <div class="bento-card p-6 bg-slate-50 border border-slate-200 max-w-5xl mx-auto mb-16 text-left">
            <div class="text-center mb-6">
              <span class="text-[11px] font-bold text-[#1565C0] uppercase tracking-wider block">FEATURE BREAKDOWN</span>
              <h3 class="font-black text-xl text-[#003366] mt-0.5">Full Feature Availability Comparison</h3>
              <p class="text-xs text-[#5A6E82]">Module accessibility verified against CFO AI application entitlements.</p>
            </div>
            <div class="overflow-x-auto text-xs">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-slate-300 font-bold text-[#003366] bg-white">
                    <th class="p-3.5">Feature</th>
                    <th class="p-3.5 text-center">Starter ($59)</th>
                    <th class="p-3.5 text-center bg-blue-50/80 font-bold text-[#1565C0] border-x border-blue-200">Control ($149)</th>
                    <th class="p-3.5 text-center">Pro ($249)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 text-[#334155]">
                  ${pricing.feature_availability_table.map(row => `
                    <tr class="hover:bg-white/60">
                      <td class="p-3 font-semibold text-[#003366]">${row.label}</td>
                      <td class="p-3 text-center ${row.starter === 'Included' ? 'font-bold text-emerald-700' : 'text-slate-400'}">${row.starter}</td>
                      <td class="p-3 text-center bg-blue-50/40 ${row.control === 'Included' ? 'font-bold text-emerald-700' : 'text-slate-400'} border-x border-blue-200">${row.control}</td>
                      <td class="p-3 text-center ${row.pro === 'Included' ? 'font-bold text-emerald-700' : 'font-bold text-[#1565C0]'}">${row.pro}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
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
      activeTab: 'pricing',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- LOCALIZED KNOWLEDGE HUB DIRECTORY (/:locale/blog) ---
  router.get('/:locale/blog', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/blog');

    const categoryFilter = req.query.category;
    const categories = contentStore.getHubCategories();
    let articles = contentStore.getHubArticles().filter(a => a.review_status === 'published');

    if (categoryFilter) {
      articles = articles.filter(a => a.category === categoryFilter);
    }

    const title = 'Knowledge Hub & Indonesian Tax Guides — CFO AI';
    const description = 'Authoritative guides on Indonesian corporate tax compliance, PPh 21 TER calculations, bank reconciliation, and business operations.';
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
            <h1 class="text-3xl sm:text-5xl font-black text-[#003366] mt-2 mb-4">Indonesian Tax, Accounting &amp; Compliance Hub</h1>
            <p class="text-sm text-[#5A6E82]">Statutory regulations, accounting frameworks, and operational guides for Indonesian PT and PT PMA directors.</p>
          </div>

          <!-- Category Filters -->
          <div class="flex flex-wrap items-center justify-center gap-2 mb-12">
            <a href="/${locale}/blog" class="text-xs font-bold px-4 py-2 rounded-xl transition-all ${!categoryFilter ? 'bg-[#1565C0] text-white shadow-sm' : 'bg-white text-[#334155] border border-slate-200 hover:bg-slate-50'}">
              All Categories
            </a>
            ${categories.map(c => `
              <a href="/${locale}/blog?category=${c.slug}" class="text-xs font-bold px-4 py-2 rounded-xl transition-all ${categoryFilter === c.slug ? 'bg-[#1565C0] text-white shadow-sm' : 'bg-white text-[#334155] border border-slate-200 hover:bg-slate-50'}">
                ${c.name}
              </a>
            `).join('')}
          </div>

          <!-- Articles Grid -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            ${articles.map(art => {
              const trans = art.translations?.[locale] || art.translations?.['en'] || {};
              return `
                <div class="bento-card p-6 flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between text-[11px] text-[#5A6E82] mb-3">
                      <span class="font-bold text-[#1565C0] bg-blue-50 px-2 py-0.5 rounded">${art.category_name}</span>
                      <span class="font-mono">${art.jurisdiction} JURISDICTION</span>
                    </div>
                    <h3 class="font-black text-lg text-[#003366] mb-2 leading-snug">
                      <a href="/${locale}/blog/${art.slug}" class="hover:text-[#1565C0]">${trans.title || art.slug}</a>
                    </h3>
                    <p class="text-xs text-[#5A6E82] line-clamp-3 leading-relaxed mb-6">
                      ${trans.excerpt || ''}
                    </p>
                  </div>
                  <div class="border-t border-slate-100 pt-4 flex items-center justify-between text-xs text-[#5A6E82]">
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-[#003366]">${art.author?.name}</span>
                    </div>
                    <a href="/${locale}/blog/${art.slug}" class="font-bold text-[#1565C0] hover:underline">Read Guide →</a>
                  </div>
                </div>
              `;
            }).join('')}
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

  // --- LOCALIZED KNOWLEDGE HUB ARTICLE DETAIL (/:locale/blog/:slug) ---
  router.get('/:locale/blog/:slug', (req, res) => {
    const locale = req.params.locale;
    const slug = req.params.slug;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect(`/id/blog/${slug}`);

    const article = contentStore.getHubArticle(slug);
    if (!article || article.review_status !== 'published') {
      return res.status(404).send(renderLayout({
        locale,
        title: 'Article Not Found — CFO AI Knowledge Hub',
        description: 'The requested guide was not found.',
        canonical: `https://cfo-ai.site/${locale}/blog/${slug}`,
        activeTab: 'blog',
        content: `
          <div class="py-24 text-center max-w-md mx-auto">
            <h1 class="text-3xl font-black text-[#003366] mb-4">Guide Not Found</h1>
            <p class="text-xs text-[#5A6E82] mb-6">This article does not exist or has been archived.</p>
            <a href="/${locale}/blog" class="text-xs font-bold text-[#1565C0] underline">← Back to Knowledge Hub</a>
          </div>
        `
      }));
    }

    const trans = article.translations?.[locale] || article.translations?.['en'] || {};
    const title = trans.seo_title || trans.title;
    const description = trans.meta_description || trans.excerpt;
    const canonical = `https://cfo-ai.site/${locale}/blog/${slug}`;

    const hreflangs = locales.filter(l => l.status === 'published' && article.translations?.[l.code]).map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/blog/${slug}`
    }));

    // Convert markdown headings into HTML
    const contentMarkdown = trans.content_markdown || '';
    const formattedContent = contentMarkdown
      .replace(/^# (.*$)/gim, '<h1 class="text-3xl sm:text-4xl font-black text-[#003366] mt-8 mb-4">$1</h1>')
      .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-black text-[#003366] mt-8 mb-3 pb-2 border-b border-slate-200">$1</h2>')
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold text-[#003366] mt-6 mb-2">$1</h3>')
      .replace(/^\> (.*$)/gim, '<blockquote class="border-l-4 border-[#1565C0] pl-4 py-2 my-4 bg-blue-50/60 rounded-r text-xs text-[#334155] font-medium">$1</blockquote>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-bold text-[#003366]">$1</strong>')
      .replace(/\n\n/gim, '</p><p class="text-xs sm:text-sm text-[#334155] leading-relaxed mb-4">');

    const contentHtml = `
      <article class="py-16 px-4 sm:px-6 lg:px-8 bg-white">
        <div class="max-w-4xl mx-auto">
          
          <!-- Breadcrumb & Metadata -->
          <div class="flex items-center gap-2 text-xs text-[#5A6E82] mb-6">
            <a href="/${locale}" class="hover:underline">Home</a>
            <span>/</span>
            <a href="/${locale}/blog" class="hover:underline">Knowledge Hub</a>
            <span>/</span>
            <span class="font-bold text-[#003366]">${article.category_name}</span>
          </div>

          <!-- Legal & Verification Badges -->
          <div class="flex flex-wrap items-center gap-3 mb-6">
            <span class="text-[11px] font-bold text-[#1565C0] bg-blue-50 border border-blue-200 px-3 py-1 rounded-full uppercase tracking-wider">
              🏛️ JURISDICTION: INDONESIA (ID)
            </span>
            <span class="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
              ✓ Verified by ${article.legal_reviewer}
            </span>
            <span class="text-[11px] font-medium text-[#5A6E82]">
              Updated: ${article.last_updated.split('T')[0]}
            </span>
          </div>

          <h1 class="text-3xl sm:text-5xl font-black text-[#003366] tracking-tight mb-6 leading-tight">
            ${trans.title}
          </h1>

          <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-[#5A6E82] leading-relaxed mb-10 flex items-center justify-between">
            <div>
              <span class="font-bold text-[#003366]">Author:</span> ${article.author?.name} (${article.author?.role})
            </div>
            <div>
              <span class="font-bold text-[#003366]">Reading Time:</span> ${article.reading_time_minutes} minutes
            </div>
          </div>

          <!-- Body Content -->
          <div class="prose max-w-none text-[#334155] text-xs sm:text-sm leading-relaxed mb-16">
            <p class="text-xs sm:text-sm text-[#334155] leading-relaxed mb-4">
              ${formattedContent}
            </p>
          </div>

          <!-- Conversion Callout -->
          <div class="bento-card p-8 bg-ice-tint border-2 border-[#1565C0] text-center mb-12">
            <h3 class="text-xl font-black text-[#003366] mb-2">Automate Your Indonesian Tax &amp; Reconciliation Workflows</h3>
            <p class="text-xs text-[#5A6E82] max-w-lg mx-auto mb-6">
              CFO AI prepares your PPh 21 TER calculations, reconciles BCA bank statements, and formats month-close packages automatically.
            </p>
            <a href="https://app.cfo-ai.site/login" class="inline-block text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-8 py-3.5 rounded-xl shadow-md transition-all">
              Start Free Trial (7 Days) →
            </a>
          </div>

          <div class="border-t border-slate-200 pt-6">
            <a href="/${locale}/blog" class="text-xs font-bold text-[#1565C0] hover:underline">← Back to All Knowledge Hub Guides</a>
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

  // --- LOCALIZED STATIC PAGES (/platform, /document-intelligence, /compliance) ---
  ['platform', 'document-intelligence', 'compliance'].forEach(pageSlug => {
    router.get(`/:locale/${pageSlug}`, (req, res) => {
      const locale = req.params.locale;
      const locales = contentStore.getLocales();
      if (!locales.some(l => l.code === locale)) return res.redirect(`/id/${pageSlug}`);

      const page = contentStore.getPage(pageSlug);
      const seo = contentStore.getSeo();
      const title = page?.title || seo.pages_meta?.[pageSlug]?.title || `${pageSlug} — CFO AI`;
      const description = seo.pages_meta?.[pageSlug]?.description || 'CFO AI Indonesia Financial OS';
      const canonical = `https://cfo-ai.site/${locale}/${pageSlug}`;

      const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
        lang: l.code,
        url: `https://cfo-ai.site/${l.code}/${pageSlug}`
      }));

      const hero = page?.blocks?.find(b => b.type === 'hero') || {};

      const contentHtml = `
        <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-tint border-b border-[#E2E8F0]">
          <div class="max-w-7xl mx-auto text-center">
            <span class="text-xs font-bold text-[#1565C0] uppercase tracking-wider">${hero.badge || 'PLATFORM MODULE'}</span>
            <h1 class="text-3xl sm:text-5xl font-black text-[#003366] mt-2 mb-4">${hero.title || page?.title}</h1>
            <p class="text-sm text-[#5A6E82] max-w-2xl mx-auto mb-12">${hero.subtitle || description}</p>

            <div class="bento-card p-6 bg-white border border-[#CBD5E1] shadow-xl max-w-4xl mx-auto">
              <img src="/assets/product/${pageSlug === 'compliance' ? 'compliance-calendar-radar.svg' : pageSlug === 'document-intelligence' ? 'document-review-drawer.svg' : 'analytics-radar.svg'}" alt="${title}" class="w-full rounded-lg" />
            </div>

            <div class="mt-12">
              <a href="https://app.cfo-ai.site/login" class="inline-block text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-8 py-3.5 rounded-xl shadow-md transition-all">
                Start Free Trial (7 Days) →
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
        activeTab: pageSlug,
        content: contentHtml,
        hreflangs
      }));
    });
  });

  return router;
}

module.exports = createPublicRoutes;
