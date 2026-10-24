/**
 * Public Website & Knowledge Hub SSR Router
 * Powers https://cfo-ai.site with 16-locale routing, Concept B rendering, and dynamic SEO.
 * Zero emojis across all marketing copy and UI elements.
 * Features approved Dark -> Luminous Navy -> Dark gradient, soft Ice Blue backgrounds,
 * increased official logo size, transparent geometric watermarks, full uncropped UI screenshots,
 * click-to-enlarge lightbox, bank-agnostic positioning, and 100% complete EN/ID/RU localization.
 */

const express = require('express');
const SitemapGenerator = require('../engine/sitemapGenerator');
const TranslationEngine = require('../engine/translationEngine');
const dict = require('./translations');

function createPublicRoutes(contentStore) {
  const router = express.Router();
  const translationEngine = new TranslationEngine();

  // Helper: Get localization strings for active locale with English fallback
  function getT(locale) {
    return dict[locale] || dict['en'];
  }

  // Helper: Render official CFO AI transparent geometric watermark
  function renderWatermark({ color = '#06366B', opacity = '0.035', size = 'w-96 h-96', className = 'absolute -right-20 -bottom-20 pointer-events-none select-none z-0' } = {}) {
    return `
      <div class="${className} ${size} overflow-hidden">
        <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full" style="opacity: ${opacity};">
          <path d="M 12.97,127.48 L 73.25,188.00 L 98.67,187.03 L 149.75,135.71 L 167.66,135.71 L 124.33,179.77 L 131.59,187.03 L 187.03,131.59 L 184.85,126.27 L 145.88,126.27 L 93.83,177.59 L 77.12,178.56 L 20.23,121.43 Z M 187.03,66.47 L 133.77,12.00 L 103.03,12.00 L 29.43,86.08 L 36.69,92.13 L 110.05,18.54 L 125.78,18.54 L 167.91,59.45 L 148.78,60.42 L 113.92,26.53 L 107.87,33.79 L 144.91,70.83 L 184.85,70.83 Z M 69.13,12.00 L 13.94,67.44 L 12.00,92.86 L 88.02,170.57 L 94.07,162.34 L 21.44,88.98 L 21.44,74.22 L 78.57,17.33 L 75.67,12.00 Z" fill="${color}" fill-rule="evenodd"/>
          <circle cx="101.57" cy="98.67" r="17.91" fill="${color}"/>
        </svg>
      </div>
    `;
  }

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

  // Middleware: Protect staged draft locales with noindex headers
  router.use((req, res, next) => {
    const parts = req.path.split('/').filter(Boolean);
    if (parts.length > 0) {
      const locCode = parts[0];
      const locales = contentStore.getLocales();
      const loc = locales.find(l => l.code === locCode);
      if (loc && loc.status !== 'published') {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
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
    const helpArticles = contentStore.getHelpArticles ? contentStore.getHelpArticles() : [];
    const generator = new SitemapGenerator(seo.base_url || 'https://cfo-ai.site', locales, pages, articles, helpArticles);
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
    const t = getT(locale);
    const currentLocaleObj = locales.find(l => l.code === locale) || { code: locale, name: 'English', nativeName: 'English' };

    const activeHreflangs = [...hreflangs];
    if (activeHreflangs.length > 0 && !activeHreflangs.some(h => h.lang === 'x-default')) {
      const enMatch = activeHreflangs.find(h => h.lang === 'en');
      if (enMatch) {
        activeHreflangs.push({ lang: 'x-default', url: enMatch.url });
      }
    }
    const hreflangTags = activeHreflangs.map(h => `<link rel="alternate" hreflang="${h.lang}" href="${h.url}" />`).join('\n  ');

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
  ${currentLocaleObj.status !== 'published' ? '<meta name="robots" content="noindex, nofollow">\n  ' : ''}<link rel="icon" type="image/x-icon" href="/assets/brand/favicon.ico">
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
    :root {
      --cfo-navy-dark: #021B36;
      --cfo-navy-mid: #042C53;
      --cfo-navy-luminous: #063D72;

      --cfo-ice-blue: #E5F1FD;
      --cfo-ice-blue-light: #F5F9FE;

      --cfo-text-primary: #06366B;
      --cfo-accent-blue: #318FF4;
      --cfo-white: #FFFFFF;

      --cfo-navy-gradient: linear-gradient(
        90deg,
        #021B36 0%,
        #042C53 25%,
        #063D72 50%,
        #042C53 75%,
        #021B36 100%
      );
    }
    body { font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif; background-color: var(--cfo-ice-blue); color: #021B36; }
    .font-brand { font-family: 'Archivo Black', sans-serif; }
    .font-mono-num { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum' on, 'zero' on; }
    .bg-navy-brand { background: var(--cfo-navy-gradient); }
    .bg-ice-primary { background-color: var(--cfo-ice-blue); }
    .bg-ice-light { background-color: var(--cfo-ice-blue-light); }
    .text-cfo-primary { color: var(--cfo-text-primary); }
    .bento-card { background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgba(2, 27, 54, 0.04), 0 2px 4px -2px rgba(2, 27, 54, 0.02); transition: all 0.2s ease; position: relative; }
    .bento-card:hover { border-color: #94A3B8; box-shadow: 0 10px 15px -3px rgba(2, 27, 54, 0.08); }
    .browser-frame { border: 1px solid #CBD5E1; border-radius: 0.75rem; overflow: hidden; background: #FFFFFF; box-shadow: 0 10px 25px -5px rgba(2, 27, 54, 0.1); }
    .watermark-bg { background-image: radial-gradient(rgba(6, 54, 107, 0.04) 1px, transparent 1px); background-size: 24px 24px; }
  </style>
</head>
<body class="min-h-screen flex flex-col watermark-bg text-slate-800">

  <!-- TOP ANNOUNCEMENT BAR (Dark -> Luminous Navy -> Dark Gradient) -->
  <div class="bg-navy-brand text-white py-2 px-4 text-center text-xs font-semibold tracking-wide border-b border-blue-900/60 shadow-sm">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex-1 text-center truncate">
        <span>${t.announcement.text}</span>
        <a href="/${locale}/blog/coretax-pmk-81-2024-transition-guide" class="ml-2 underline font-bold hover:text-blue-200">${t.announcement.link_text} &rarr;</a>
      </div>
      <!-- Language Switcher in Header (Compact Active Locales Only) -->
      <div class="hidden sm:flex items-center gap-1.5 text-xs text-blue-100 ml-4 shrink-0">
        <svg class="w-3.5 h-3.5 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
        <select onchange="switchLanguage(this.value)" class="bg-[#042C53] text-white text-xs rounded px-2 py-0.5 border border-blue-400/50 focus:outline-none cursor-pointer" aria-label="Select language">
          <option value="en" ${locale === 'en' ? 'selected' : ''}>English (EN)</option>
          <option value="id" ${locale === 'id' ? 'selected' : ''}>Bahasa Indonesia (ID)</option>
          <option value="ru" ${locale === 'ru' ? 'selected' : ''}>Русский (RU)</option>
        </select>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER (White with crisp border, 35% increased official logo) -->
  <header class="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#CBD5E1]">
    <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-20 sm:h-22 flex items-center justify-between gap-2.5 lg:gap-4 xl:gap-6">
      <div class="flex items-center min-w-0">
        <!-- Official Logo increased by 35% on left -->
        <a href="/${locale}" class="flex items-center py-2 shrink-0" aria-label="CFO AI Homepage">
          <img src="/assets/brand/logo_main_navy_transparent.svg" alt="CFO AI Financial OS" class="h-11 sm:h-12 w-auto object-contain">
        </a>

        <!-- Desktop Navigation shifted slightly right (xl:flex avoids 1024px crowding across EN/ID/RU) -->
        <nav class="hidden xl:flex items-center gap-2 xl:gap-2.5 2xl:gap-4 text-xs xl:text-sm font-semibold text-[#06366B] ml-3.5 xl:ml-5 2xl:ml-8">
          <a href="/${locale}" class="whitespace-nowrap hover:text-[#318FF4] transition-colors ${activeTab === 'home' ? 'text-[#318FF4] font-bold' : ''}">${t.nav.home}</a>
          <a href="/${locale}/platform" class="whitespace-nowrap hover:text-[#318FF4] transition-colors ${activeTab === 'platform' ? 'text-[#318FF4] font-bold' : ''}">${t.nav.platform}</a>
          <a href="/${locale}/document-intelligence" class="whitespace-nowrap hover:text-[#318FF4] transition-colors ${activeTab === 'doc' ? 'text-[#318FF4] font-bold' : ''}">${t.nav.doc_intelligence}</a>
          <a href="/${locale}/compliance" class="whitespace-nowrap hover:text-[#318FF4] transition-colors ${activeTab === 'compliance' ? 'text-[#318FF4] font-bold' : ''}">${t.nav.compliance}</a>
          <a href="/${locale}/blog" class="whitespace-nowrap hover:text-[#318FF4] transition-colors ${activeTab === 'blog' ? 'text-[#318FF4] font-bold' : ''}">${t.nav.hub}</a>
          <a href="/${locale}/help" class="whitespace-nowrap hover:text-[#318FF4] transition-colors ${activeTab === 'help' ? 'text-[#318FF4] font-bold' : ''}">${t.nav.help || 'Help Center'}</a>
          <a href="/${locale}/pricing" class="whitespace-nowrap hover:text-[#318FF4] transition-colors ${activeTab === 'pricing' ? 'text-[#318FF4] font-bold' : ''}">${t.nav.pricing}</a>
          <a href="/${locale}/about" class="whitespace-nowrap hover:text-[#318FF4] transition-colors ${activeTab === 'about' ? 'text-[#318FF4] font-bold' : ''}">${t.nav.about}</a>
        </nav>
      </div>

      <!-- Right Action Cluster: Compact Lang Selector, Log In, Trial CTA, Hamburger -->
      <div class="flex items-center gap-2 sm:gap-2.5 xl:gap-3 shrink-0 mr-0.5 sm:mr-1">
        <!-- Compact Language Selector (~76-82px wide) -->
        <div class="relative inline-block text-left" id="cfo-lang-selector">
          <button type="button" onclick="toggleLangDropdown(event)" class="inline-flex items-center justify-between w-[76px] sm:w-[82px] h-[38px] px-2.5 py-1.5 text-xs font-bold text-[#06366B] bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1768C9] transition-all" aria-haspopup="true" aria-expanded="false" id="lang-menu-btn" title="Switch Language">
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
              <span>${locale.toUpperCase()}</span>
            </span>
            <svg class="w-3 h-3 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
          </button>
          <div id="lang-dropdown-menu" class="hidden absolute right-0 mt-1.5 w-48 rounded-xl shadow-xl bg-white border border-slate-200 py-1.5 z-50 ring-1 ring-black ring-opacity-5 focus:outline-none">
            <button type="button" onclick="switchLanguage('en')" class="w-full text-left px-3.5 py-2 text-xs font-semibold ${locale === 'en' ? 'text-[#1768C9] bg-blue-50/70 font-bold' : 'text-slate-700 hover:bg-slate-50'} flex items-center justify-between transition-colors">
              <span>English</span>
              <span class="text-[10px] font-mono font-bold text-slate-400">EN</span>
            </button>
            <button type="button" onclick="switchLanguage('id')" class="w-full text-left px-3.5 py-2 text-xs font-semibold ${locale === 'id' ? 'text-[#1768C9] bg-blue-50/70 font-bold' : 'text-slate-700 hover:bg-slate-50'} flex items-center justify-between transition-colors">
              <span>Bahasa Indonesia</span>
              <span class="text-[10px] font-mono font-bold text-slate-400">ID</span>
            </button>
            <button type="button" onclick="switchLanguage('ru')" class="w-full text-left px-3.5 py-2 text-xs font-semibold ${locale === 'ru' ? 'text-[#1768C9] bg-blue-50/70 font-bold' : 'text-slate-700 hover:bg-slate-50'} flex items-center justify-between transition-colors">
              <span>Русский</span>
              <span class="text-[10px] font-mono font-bold text-slate-400">RU</span>
            </button>
          </div>
        </div>

        <a href="https://app.cfo-ai.site/login" class="hidden sm:inline-block text-xs xl:text-sm font-bold text-[#06366B] hover:text-[#318FF4] px-2.5 py-2 transition-colors whitespace-nowrap">
          ${t.nav.login}
        </a>
        <a href="https://app.cfo-ai.site/login" class="text-xs xl:text-sm font-bold bg-[#1768C9] hover:bg-[#06366B] text-white px-3.5 sm:px-5 py-2.5 rounded-xl shadow-sm transition-all min-h-[44px] flex items-center justify-center whitespace-nowrap">
          ${t.nav.trial_cta}
        </a>
        <!-- Mobile / Tablet Hamburger Toggle Button -->
        <button onclick="toggleMobileMenu()" class="xl:hidden p-2 rounded-lg text-slate-700 hover:text-[#318FF4] hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Toggle navigation menu">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>
    </div>

    <!-- Mobile Drawer Navigation -->
    <div id="mobile-menu" class="hidden xl:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-1.5 shadow-lg">
      <a href="/${locale}" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] flex items-center ${activeTab === 'home' ? 'text-[#1768C9] font-bold bg-blue-50/60' : ''}">${t.nav.home}</a>
      <a href="/${locale}/platform" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] flex items-center ${activeTab === 'platform' ? 'text-[#1768C9] font-bold bg-blue-50/60' : ''}">${t.nav.platform}</a>
      <a href="/${locale}/document-intelligence" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] flex items-center ${activeTab === 'doc' ? 'text-[#1768C9] font-bold bg-blue-50/60' : ''}">${t.nav.doc_intelligence}</a>
      <a href="/${locale}/compliance" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] flex items-center ${activeTab === 'compliance' ? 'text-[#1768C9] font-bold bg-blue-50/60' : ''}">${t.nav.compliance}</a>
      <a href="/${locale}/blog" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] flex items-center ${activeTab === 'blog' ? 'text-[#1768C9] font-bold bg-blue-50/60' : ''}">${t.nav.hub}</a>
      <a href="/${locale}/help" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] flex items-center ${activeTab === 'help' ? 'text-[#1768C9] font-bold bg-blue-50/60' : ''}">${t.nav.help || 'Help Center'}</a>
      <a href="/${locale}/pricing" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] flex items-center ${activeTab === 'pricing' ? 'text-[#1768C9] font-bold bg-blue-50/60' : ''}">${t.nav.pricing}</a>
      <a href="/${locale}/about" class="block py-2.5 px-3 rounded-lg text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] flex items-center ${activeTab === 'about' ? 'text-[#1768C9] font-bold bg-blue-50/60' : ''}">${t.nav.about}</a>
      <div class="pt-3 border-t border-slate-200">
        <span class="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Language / Bahasa / Язык</span>
        <div class="grid grid-cols-3 gap-2">
          <button onclick="switchLanguage('en')" class="h-11 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center ${locale === 'en' ? 'bg-[#1768C9] text-white border-[#1768C9]' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}">EN &bull; English</button>
          <button onclick="switchLanguage('id')" class="h-11 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center ${locale === 'id' ? 'bg-[#1768C9] text-white border-[#1768C9]' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}">ID &bull; Indonesia</button>
          <button onclick="switchLanguage('ru')" class="h-11 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center ${locale === 'ru' ? 'bg-[#1768C9] text-white border-[#1768C9]' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}">RU &bull; Русский</button>
        </div>
      </div>
      <div class="pt-2 flex items-center gap-2">
        <a href="https://app.cfo-ai.site/login" class="flex-1 text-center text-xs font-bold bg-slate-100 text-[#06366B] py-3 rounded-xl min-h-[44px] flex items-center justify-center border border-slate-200">
          ${t.nav.login}
        </a>
        <a href="https://app.cfo-ai.site/login" class="flex-1 text-center text-xs font-bold bg-[#1768C9] text-white py-3 rounded-xl min-h-[44px] flex items-center justify-center shadow">
          ${t.nav.trial_cta} &rarr;
        </a>
      </div>
    </div>
  </header>

  <!-- MAIN PAGE CONTENT -->
  <main class="flex-grow">
    ${content}
  </main>

  <!-- FOOTER (Unified 4-Column Layout, Rendered Height Reduced by 25-30%) -->
  <footer class="bg-navy-brand text-slate-300 pt-7 pb-5 border-t border-slate-700 relative overflow-hidden">
    ${renderWatermark({ color: '#FFFFFF', opacity: '0.04', size: 'w-[360px] h-[360px]', className: 'absolute -right-16 -bottom-16 pointer-events-none select-none z-0' })}
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-5">
        <!-- Col 1: Brand & footprint -->
        <div class="space-y-2">
          <div class="flex items-center gap-2.5">
            <img src="/assets/brand/logo_dark_bg_white_text.svg" alt="CFO AI Indonesia" class="h-7 w-auto rounded">
          </div>
          <p class="text-xs text-slate-300 leading-relaxed max-w-xs">
            ${t.footer.about_text}
          </p>
        </div>

        <!-- Col 2: Platform -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-white mb-2">${t.footer.col_platform}</h4>
          <ul class="space-y-2 text-sm text-slate-300">
            <li><a href="/${locale}/platform" class="hover:text-white transition-colors">${t.footer.link_overview}</a></li>
            <li><a href="/${locale}/platform#features" class="hover:text-white transition-colors">${t.footer.link_features}</a></li>
            <li><a href="/${locale}/document-intelligence" class="hover:text-white transition-colors">${t.nav.doc_intelligence}</a></li>
            <li><a href="/${locale}/compliance" class="hover:text-white transition-colors">${t.nav.compliance}</a></li>
            <li><a href="/${locale}/pricing" class="hover:text-white transition-colors">${t.nav.pricing}</a></li>
          </ul>
        </div>

        <!-- Col 3: Knowledge Hub -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-white mb-2">${t.footer.col_hub}</h4>
          <ul class="space-y-2 text-sm text-slate-300">
            <li><a href="/${locale}/help" class="hover:text-white transition-colors font-semibold text-blue-300">${t.footer.link_help_center || 'Help Center & Guides'}</a></li>
            <li><a href="/${locale}/blog" class="hover:text-white transition-colors">All Tax &amp; Business Guides</a></li>
            <li><a href="/${locale}/blog/pt-pma-tax-compliance-guide-2026" class="hover:text-white transition-colors">${t.footer.link_tax_guides}</a></li>
            <li><a href="/${locale}/blog/pph-21-ter-calculation-rules-indonesia" class="hover:text-white transition-colors">${t.footer.link_pph21}</a></li>
            <li><a href="/${locale}/blog/coretax-pmk-81-2024-transition-guide" class="hover:text-white transition-colors">${t.footer.link_coretax}</a></li>
          </ul>
        </div>

        <!-- Col 4: Company & Legal -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-white mb-2">${t.footer.col_legal}</h4>
          <ul class="space-y-2 text-sm text-slate-300">
            <li><a href="/${locale}/about" class="hover:text-white transition-colors">${t.nav.about}</a></li>
            <li><a href="/${locale}/about#contact" class="hover:text-white transition-colors">${t.footer.link_contact}</a></li>
            <li><a href="/${locale}/privacy" class="hover:text-white transition-colors">${t.footer.link_privacy}</a></li>
            <li><a href="/${locale}/terms" class="hover:text-white transition-colors">${t.footer.link_terms}</a></li>
            <li class="pt-0.5"><a href="https://app.cfo-ai.site/login" class="text-blue-300 font-bold hover:underline inline-flex items-center gap-1">${t.nav.trial_cta} &rarr;</a></li>
          </ul>
        </div>
      </div>

      <!-- Footer Bottom Bar with Back to Top (Consolidated Compact Single Row) -->
      <div class="border-t border-slate-700/60 pt-3.5 flex flex-col md:flex-row items-center justify-between text-xs text-slate-300 gap-3 leading-relaxed">
        <div class="flex flex-wrap items-center justify-center md:justify-start gap-x-3 gap-y-1 text-center md:text-left">
          <span class="font-medium text-slate-300">${t.footer.copyright}</span>
          <span class="hidden md:inline text-slate-600">&bull;</span>
          <span class="max-w-xl text-slate-400">${t.footer.disclaimer}</span>
        </div>
        <button onclick="scrollToTop()" class="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 min-h-[32px]" aria-label="${t.footer.back_to_top}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>
          <span>${t.footer.back_to_top}</span>
        </button>
      </div>
    </div>
  </footer>

  <!-- FULLSCREEN LIGHTBOX MODAL (Click-to-enlarge unconstrained UI) -->
  <div id="cfo-lightbox" class="fixed inset-0 z-50 hidden bg-[#021B36]/90 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
    <div class="w-full max-w-6xl flex items-center justify-between text-white pb-3 mb-2 border-b border-white/10">
      <div class="flex items-center gap-3">
        <span id="cfo-lightbox-badge" class="text-xs uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-[#318FF4] text-white">AUTHENTIC V2 SCREEN</span>
        <h3 id="cfo-lightbox-title" class="text-xs sm:text-sm font-bold tracking-tight text-white">CFO AI Application Screen</h3>
      </div>
      <div class="flex items-center gap-2 sm:gap-3">
        <button onclick="toggleLightboxZoom()" id="cfo-lightbox-zoom-btn" class="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white min-h-[44px] flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"/></svg>
          <span>Zoom (1.5x)</span>
        </button>
        <button onclick="closeLightbox()" class="text-xs font-bold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close modal">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div class="relative w-full max-w-6xl flex-1 flex items-center justify-center overflow-auto p-2" onclick="if (event.target === this) closeLightbox();">
      <img id="cfo-lightbox-img" src="" alt="CFO AI Screen" class="max-w-full max-h-[78vh] object-contain rounded-lg shadow-2xl transition-transform duration-200 cursor-zoom-in" onclick="toggleLightboxZoom()" />
    </div>
    <div id="cfo-lightbox-desc" class="text-center text-xs text-slate-300 max-w-2xl mt-2 px-4"></div>
  </div>

  <script>
    function toggleLangDropdown(e) {
      if (e) e.stopPropagation();
      const menu = document.getElementById('lang-dropdown-menu');
      if (menu) menu.classList.toggle('hidden');
    }

    document.addEventListener('click', function(e) {
      const selector = document.getElementById('cfo-lang-selector');
      const menu = document.getElementById('lang-dropdown-menu');
      if (menu && selector && !selector.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });

    function switchLanguage(targetLang) {
      const path = window.location.pathname;
      const segments = path.split('/').filter(Boolean);
      if (segments.length === 0) {
        window.location.href = '/' + targetLang;
        return;
      }
      const knownLocales = ['en', 'id', 'ru', 'fr', 'de', 'es', 'it', 'zh-cn', 'ja', 'th', 'vi'];
      if (knownLocales.includes(segments[0])) {
        segments[0] = targetLang;
      } else {
        segments.unshift(targetLang);
      }
      const newPath = '/' + segments.join('/') + window.location.search + window.location.hash;
      window.location.href = newPath;
    }

    function scrollToTop() {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion ? 'auto' : 'smooth'
      });
    }

    function toggleMobileMenu() {
      const el = document.getElementById('mobile-menu');
      if (el) el.classList.toggle('hidden');
    }

    function openLightbox(src, title, desc, badge) {
      const modal = document.getElementById('cfo-lightbox');
      const img = document.getElementById('cfo-lightbox-img');
      const titleEl = document.getElementById('cfo-lightbox-title');
      const descEl = document.getElementById('cfo-lightbox-desc');
      const badgeEl = document.getElementById('cfo-lightbox-badge');
      if (!modal || !img) return;
      img.src = src;
      img.style.transform = 'scale(1)';
      img.classList.remove('cursor-zoom-out');
      img.classList.add('cursor-zoom-in');
      if (titleEl) titleEl.textContent = title || 'CFO AI Application Screen';
      if (descEl) descEl.textContent = desc || '';
      if (badgeEl) badgeEl.textContent = badge || 'AUTHENTIC V2 SCREEN';
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      const modal = document.getElementById('cfo-lightbox');
      if (modal) modal.classList.add('hidden');
      document.body.style.overflow = '';
    }

    function toggleLightboxZoom() {
      const img = document.getElementById('cfo-lightbox-img');
      const btn = document.getElementById('cfo-lightbox-zoom-btn');
      if (!img || !btn) return;
      if (img.style.transform === 'scale(1.5)') {
        img.style.transform = 'scale(1)';
        img.classList.remove('cursor-zoom-out');
        img.classList.add('cursor-zoom-in');
        btn.querySelector('span').textContent = 'Zoom (1.5x)';
      } else {
        img.style.transform = 'scale(1.5)';
        img.classList.remove('cursor-zoom-in');
        img.classList.add('cursor-zoom-out');
        btn.querySelector('span').textContent = 'Reset (1x)';
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
    });
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

    const t = getT(locale);
    const page = contentStore.getPage('home');
    const heroBlock = page?.blocks?.find(b => b.type === 'hero') || {};
    const heroTitle = (locale === 'en' && heroBlock.title) ? heroBlock.title : t.hero.title;
    const heroSubtitle = (locale === 'en' && heroBlock.subtitle) ? heroBlock.subtitle : t.hero.subtitle;
    const heroBadge = (locale === 'en' && heroBlock.badge) ? heroBlock.badge : t.hero.badge;
    const heroPrimaryCta = (locale === 'en' && heroBlock.primary_cta_text) ? heroBlock.primary_cta_text : t.hero.primary_cta;

    const articles = contentStore.getHubArticles().slice(0, 3);
    const seo = contentStore.getSeo();

    const title = seo.pages_meta?.home?.title || 'CFO AI — Financial Operating System for Indonesia';
    const description = seo.pages_meta?.home?.description || heroSubtitle;
    const canonical = `https://cfo-ai.site/${locale}`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}`
    }));

    const contentHtml = `
      <!-- HERO SECTION (Soft Ice Blue with Transparent Watermark) -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1] relative overflow-hidden">
        ${renderWatermark({ color: '#06366B', opacity: '0.04', size: 'w-[520px] h-[520px]', className: 'absolute -right-28 -top-10 pointer-events-none select-none z-0' })}
        <div class="max-w-7xl mx-auto text-center relative z-10">
          <div class="inline-flex items-center gap-2 bg-white border border-blue-200 text-[#06366B] text-xs font-bold px-3.5 py-1 rounded-full uppercase tracking-wider mb-6 shadow-sm">
            <span class="w-2 h-2 rounded-full bg-[#318FF4]"></span>
            <span>${heroBadge}</span>
          </div>
          <h1 class="text-4xl sm:text-6xl font-black text-[#06366B] tracking-tight max-w-4xl mx-auto mb-6 leading-tight">
            ${heroTitle}
          </h1>
          <p class="text-base sm:text-lg text-[#042C53] max-w-2xl mx-auto mb-10 leading-relaxed">
            ${heroSubtitle}
          </p>

          <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <a href="https://app.cfo-ai.site/login" class="w-full sm:w-auto text-sm font-bold bg-[#1768C9] hover:bg-[#06366B] text-white px-8 py-4 rounded-xl shadow-lg transition-all min-h-[44px] flex items-center justify-center">
              ${heroPrimaryCta}
            </a>
            <a href="/${locale}/platform" class="w-full sm:w-auto text-sm font-bold bg-white hover:bg-slate-50 text-[#06366B] border border-[#CBD5E1] px-8 py-4 rounded-xl transition-all min-h-[44px] flex items-center justify-center shadow-sm">
              ${t.hero.secondary_cta} &rarr;
            </a>
          </div>
          <div class="text-xs text-slate-600 font-medium">
            ${t.hero.disclaimer}
          </div>

          <!-- Real-Time Operational KPI Metrics Counter Bar -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto mt-12 text-left">
            <div class="bento-card p-4 sm:p-5">
              <div class="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">${t.kpis.runway_label}</div>
              <div class="text-2xl sm:text-3xl font-black text-[#06366B] font-mono-num">${t.kpis.runway_val}</div>
              <div class="text-xs sm:text-sm text-emerald-800 font-bold mt-1">${t.kpis.runway_sub}</div>
            </div>
            <div class="bento-card p-4 sm:p-5">
              <div class="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">${t.kpis.net_flow_label}</div>
              <div class="text-2xl sm:text-3xl font-black text-[#06366B] font-mono-num">${t.kpis.net_flow_val}</div>
              <div class="text-xs sm:text-sm text-emerald-800 font-bold mt-1">${t.kpis.net_flow_sub}</div>
            </div>
            <div class="bento-card p-4 sm:p-5">
              <div class="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">${t.kpis.recon_label}</div>
              <div class="text-2xl sm:text-3xl font-black text-[#06366B] font-mono-num">${t.kpis.recon_val}</div>
              <div class="text-xs sm:text-sm text-[#1768C9] font-bold mt-1">${t.kpis.recon_sub}</div>
            </div>
            <div class="bento-card p-4 sm:p-5">
              <div class="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">${t.kpis.tax_label}</div>
              <div class="text-2xl sm:text-3xl font-black text-emerald-800 font-mono-num">${t.kpis.tax_val}</div>
              <div class="text-xs sm:text-sm text-slate-700 font-bold mt-1">${t.kpis.tax_sub}</div>
            </div>
          </div>

          <!-- Hero Software Illustration Showcase (Authentic UI with Lightbox) -->
          <div class="mt-10 max-w-5xl mx-auto browser-frame text-left">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-rose-400"></span>
                <span class="w-3 h-3 rounded-full bg-amber-400"></span>
                <span class="w-3 h-3 rounded-full bg-emerald-400"></span>
                <span class="font-mono ml-2 font-bold text-[#06366B]">${t.hero.hero_caption}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-emerald-800 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">${t.hero.live_feed_badge}</span>
                <button onclick="openLightbox('/assets/screens/Main.png', 'Pulse Command Center', 'Real-time liquidity, cash runway in days, and burn rate across all corporate bank accounts.', 'AUTHENTIC V2 SCREEN')" class="text-xs sm:text-sm font-semibold text-[#1768C9] hover:underline cursor-pointer">Enlarge &rarr;</button>
              </div>
            </div>
            <div class="p-3 sm:p-5 bg-white cursor-zoom-in" onclick="openLightbox('/assets/screens/Main.png', 'Pulse Command Center', 'Real-time liquidity, cash runway in days, and burn rate across all corporate bank accounts.', 'AUTHENTIC V2 SCREEN')">
              <img src="/assets/screens/Main.png" alt="CFO AI Pulse Dashboard" class="w-full h-auto object-contain rounded-md" />
            </div>
          </div>
        </div>
      </section>

      <!-- 6 VALUE PILLARS (Clean White Cards over Ice Light) -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-ice-light border-b border-[#CBD5E1]">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-16">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${t.pillars.badge}</span>
            <h2 class="text-3xl sm:text-4xl font-black text-[#06366B] mt-2 mb-4">${t.pillars.heading}</h2>
            <p class="text-sm text-slate-600">${t.pillars.subheading}</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${t.pillars.items.map(p => `
              <div class="bento-card p-6 flex flex-col justify-between">
                <div>
                  <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#1768C9] flex items-center justify-center font-bold text-sm mb-4 font-mono">${p.num}</div>
                  <h3 class="font-black text-lg text-[#06366B] mb-2">${p.title}</h3>
                  <p class="text-xs text-slate-600 leading-relaxed mb-6">${p.desc}</p>
                </div>
                <a href="/${locale}/platform" class="text-xs font-bold text-[#1768C9] hover:underline mt-4 inline-block">${p.link} &rarr;</a>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- 3 PERSONA TABS (Soft Ice Blue with Watermark) -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1] relative overflow-hidden">
        ${renderWatermark({ color: '#06366B', opacity: '0.03', size: 'w-96 h-96', className: 'absolute -left-20 -bottom-20 pointer-events-none select-none z-0' })}
        <div class="max-w-7xl mx-auto relative z-10">
          <div class="text-center max-w-3xl mx-auto mb-14">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${t.personas.badge}</span>
            <h2 class="text-3xl font-black text-[#06366B] mt-2 mb-4">${t.personas.heading}</h2>
            <p class="text-sm text-slate-600">${t.personas.subheading}</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            ${t.personas.cards.map((c, i) => `
              <div class="bento-card p-8 bg-white ${i === 1 ? 'border-2 border-[#1768C9] shadow-md relative' : ''}">
                ${c.badge ? `<div class="absolute -top-3 left-6 bg-[#1768C9] text-white text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded">${c.badge}</div>` : ''}
                <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider block mb-2">${c.role}</span>
                <h3 class="text-xl font-black text-[#06366B] mb-3">${c.title}</h3>
                <p class="text-xs text-slate-600 leading-relaxed mb-6">${c.desc}</p>
                <ul class="text-xs space-y-2 text-slate-700">
                  ${c.bullets.map(b => `<li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#1768C9] shrink-0"></span>${b}</li>`).join('')}
                </ul>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- REPRESENTATIVE DEPLOYMENT PROFILES (Accurate Commercial Claims) -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-ice-light border-b border-[#CBD5E1]">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-16">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${t.scenarios.badge}</span>
            <h2 class="text-3xl font-black text-[#06366B] mt-2 mb-4">${t.scenarios.heading}</h2>
            <p class="text-sm text-slate-600">${t.scenarios.subheading}</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            ${t.scenarios.cards.map(s => `
              <div class="bento-card p-6 flex flex-col justify-between">
                <div>
                  <div class="text-xs font-bold text-[#1768C9] mb-1 font-mono">${s.location}</div>
                  <h3 class="font-black text-base text-[#06366B] mb-1">${s.company}</h3>
                  <div class="text-xs sm:text-sm text-slate-600 italic mb-4">${s.profile}</div>
                  <p class="text-xs text-slate-600 leading-relaxed mb-6">"${s.quote}"</p>
                </div>
                <div class="border-t border-slate-100 pt-4 text-xs sm:text-sm text-emerald-800 font-semibold">
                  ${s.outcome}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- FAQ ACCORDION -->
      <section class="py-20 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1]">
        <div class="max-w-4xl mx-auto">
          <div class="text-center mb-12">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${t.faqs.badge}</span>
            <h2 class="text-3xl font-black text-[#06366B] mt-2 mb-3">${t.faqs.heading}</h2>
            <p class="text-sm text-slate-600">${t.faqs.subheading}</p>
          </div>

          <div class="space-y-4 text-left">
            ${t.faqs.items.map(f => `
              <div class="bento-card p-6">
                <h3 class="font-black text-sm text-[#06366B] mb-2">${f.q}</h3>
                <p class="text-xs text-slate-600 leading-relaxed">${f.a}</p>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- KNOWLEDGE HUB PREVIEW SECTION (Refined compact bottom padding) -->
      <section class="pt-14 pb-8 sm:pt-16 sm:pb-10 px-4 sm:px-6 lg:px-8 bg-ice-light border-b border-[#CBD5E1]">
        <div class="max-w-7xl mx-auto">
          <div class="flex flex-col sm:flex-row items-baseline justify-between mb-8 sm:mb-10">
            <div>
              <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">KNOWLEDGE HUB</span>
              <h2 class="text-2xl sm:text-3xl font-black text-[#06366B] mt-1">Authoritative Indonesian Tax &amp; Finance Guides</h2>
            </div>
            <a href="/${locale}/blog" class="text-xs font-bold text-[#1768C9] hover:underline mt-4 sm:mt-0">
              Browse all 12 guides &rarr;
            </a>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            ${articles.map(art => {
              const trans = art.translations?.[locale] || art.translations?.['en'] || {};
              return `
                <div class="bento-card p-6 flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between text-xs text-slate-600 mb-3">
                      <span class="font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded">${art.category_name}</span>
                      <span>${art.reading_time_minutes} min read</span>
                    </div>
                    <h3 class="font-black text-base text-[#06366B] mb-2 leading-snug">
                      <a href="/${locale}/blog/${art.slug}" class="hover:text-[#1768C9]">${trans.title || art.slug}</a>
                    </h3>
                    <p class="text-xs text-slate-600 line-clamp-3 leading-relaxed mb-6">
                      ${trans.excerpt || ''}
                    </p>
                  </div>
                  <div class="border-t border-slate-100 pt-4 flex items-center justify-between text-xs text-slate-500">
                    <span>${art.author?.name}</span>
                    <a href="/${locale}/blog/${art.slug}" class="font-bold text-[#1768C9] hover:underline">Read &rarr;</a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>

      <!-- FLOATING FINAL CTA SECTION (Centered 1200px Floating Banner on Ice Blue Canvas) -->
      <section class="bg-ice-light pt-6 sm:pt-8 pb-[30px] px-4 sm:px-6 lg:px-8">
        <div class="max-w-[1200px] mx-auto">
          <div class="bg-navy-brand text-white text-center relative overflow-hidden rounded-[20px] py-5 sm:py-5 px-6 sm:px-8 shadow-xl border border-white/10" style="background: linear-gradient(90deg, #021B36 0%, #042C53 25%, #063D72 50%, #042C53 75%, #021B36 100%);">
            ${renderWatermark({ color: '#FFFFFF', opacity: '0.035', size: 'w-64 h-64', className: 'absolute -right-8 -bottom-8 pointer-events-none select-none z-0' })}
            <div class="max-w-3xl mx-auto relative z-10">
              <h2 class="text-lg sm:text-xl md:text-2xl font-black tracking-tight mb-1.5 text-white">${t.cta_section.heading}</h2>
              <p class="text-xs sm:text-sm text-slate-300 max-w-lg mx-auto mb-3.5 leading-normal sm:leading-relaxed">${t.cta_section.subheading}</p>
              <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
                <a href="https://app.cfo-ai.site/login" class="w-full sm:w-auto inline-flex items-center justify-center text-xs sm:text-sm font-bold bg-[#1768C9] hover:bg-[#318FF4] text-white px-6 py-2.5 rounded-xl shadow-md transition-all min-h-[40px]">
                  ${t.hero.primary_cta} &rarr;
                </a>
              </div>
              <div class="text-xs sm:text-sm text-slate-600 mt-2 font-medium">${t.cta_section.note}</div>
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
      activeTab: 'home',
      content: contentHtml,
      hreflangs
    }));
  });

  // Helpers for Connected Financial Workspace
  function renderChannelBrandIcon(id) {
    if (id === 'whatsapp') {
      return `<svg class="w-5 h-5 text-[#25D366] shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.04 20.15C10.56 20.15 9.11 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.8 7.37 7.5 3.67 12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15ZM16.56 14.36C16.31 14.24 15.09 13.64 14.86 13.56C14.64 13.47 14.47 13.43 14.31 13.68C14.14 13.92 13.66 14.49 13.51 14.66C13.37 14.82 13.22 14.85 12.97 14.72C12.72 14.6 11.92 14.34 10.97 13.49C10.23 12.83 9.73 12.01 9.58 11.77C9.44 11.52 9.56 11.39 9.69 11.26C9.8 11.15 9.94 10.97 10.06 10.83C10.19 10.68 10.23 10.58 10.31 10.42C10.39 10.25 10.35 10.11 10.29 9.99C10.23 9.86 9.73 8.64 9.53 8.13C9.33 7.64 9.12 7.71 8.97 7.7C8.82 7.69 8.66 7.69 8.49 7.69C8.33 7.69 8.06 7.75 7.84 7.99C7.61 8.24 6.98 8.83 6.98 10.02C6.98 11.22 7.85 12.38 7.97 12.54C8.09 12.7 9.7 15.18 12.16 16.24C12.74 16.5 13.2 16.65 13.55 16.76C14.14 16.95 14.68 16.92 15.11 16.86C15.58 16.79 16.56 16.27 16.76 15.69C16.97 15.12 16.97 14.63 16.91 14.52C16.85 14.42 16.81 14.48 16.56 14.36Z"/></svg>`;
    }
    if (id === 'telegram') {
      return `<svg class="w-5 h-5 text-[#229ED9] shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>`;
    }
    if (id === 'chatgpt') {
      return `<svg class="w-5 h-5 text-[#10A37F] shrink-0" fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.946-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/></svg>`;
    }
    if (id === 'claude') {
      return `<svg class="w-5 h-5 text-[#D97757] shrink-0" fill="currentColor" fill-rule="nonzero" viewBox="0 0 24 24"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></svg>`;
    }
    return `<svg class="w-5 h-5 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" stroke-width="2"/><path d="M8 21h8M12 17v4" stroke-width="2" stroke-linecap="round"/></svg>`;
  }

  function renderDestinationIcon(idx) {
    const icons = [
      `<svg class="w-4 h-4 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>`,
      `<svg class="w-4 h-4 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
      `<svg class="w-4 h-4 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/></svg>`,
      `<svg class="w-4 h-4 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>`,
      `<svg class="w-4 h-4 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
      `<svg class="w-4 h-4 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>`
    ];
    return icons[idx] || icons[0];
  }

  function renderConnectedWorkspaceSection(t, locale) {
    const cw = t.platform.connected_workspace;
    if (!cw) return '';
    const ui = cw.ui || {};

    let channels = cw.channels;
    const cmsIntegrations = contentStore.getIntegrations ? contentStore.getIntegrations() : [];
    if (cmsIntegrations && cmsIntegrations.length > 0) {
      channels = cmsIntegrations
        .filter(item => item.visible !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(item => {
          const trans = (item.translations && (item.translations[locale] || item.translations['en'])) || {};
          const statusLabel = (item.status_labels && item.status_labels[locale]) || 
            (item.status === 'coming_soon' ? (locale === 'id' ? 'Segera Hadir' : locale === 'ru' ? 'Скоро' : 'Coming Soon') :
             item.status === 'temporarily_unavailable' ? (locale === 'id' ? 'Tidak Tersedia' : locale === 'ru' ? 'Временно недоступно' : 'Temporarily Unavailable') :
             (locale === 'id' ? 'Tersedia' : locale === 'ru' ? 'Доступно' : 'Available'));
          return {
            id: item.id,
            name: trans.name || item.name,
            subtitle: trans.subtitle || '',
            status: statusLabel,
            status_type: item.status,
            example: trans.example || '',
            description: trans.description || '',
            flow_desc: trans.flow_desc || ''
          };
        });
    }

    return `
      <!-- CONNECTED FINANCIAL WORKSPACE ARCHITECTURE -->
      <section class="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1] relative overflow-hidden" id="connected-workspace">
        ${renderWatermark({ color: '#06366B', opacity: '0.03', size: 'w-[540px] h-[540px]', className: 'absolute -left-28 -top-20 pointer-events-none select-none z-0' })}
        <div class="max-w-7xl mx-auto relative z-10">
          <!-- Section Heading -->
          <div class="text-center max-w-3xl mx-auto mb-12 sm:mb-14">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${cw.eyebrow}</span>
            <h2 class="text-2xl sm:text-4xl font-black text-[#06366B] mt-2 mb-3 tracking-tight">${cw.heading}</h2>
            <p class="text-xs sm:text-sm text-slate-600 max-w-2xl mx-auto leading-relaxed">${cw.subheading}</p>
          </div>

          <!-- LEVEL 1: INPUT & INTERACTION CHANNELS -->
          <div class="mb-4">
            <div class="flex items-center justify-between mb-3 px-1">
              <div class="inline-flex items-center gap-2">
                <span class="text-xs font-mono font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${ui.level_1_badge || 'LEVEL 1'}</span>
                <span class="text-xs font-bold text-[#06366B] uppercase tracking-wider">${ui.level_1_title || 'Input &amp; Interaction Channels'}</span>
              </div>
              <span class="text-[11px] text-slate-500 hidden sm:inline">${ui.level_1_hint || 'Click any channel to inspect pipeline and governance'}</span>
            </div>

            <!-- 5 Channels Grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5" role="tablist" aria-label="Input channels">
              ${channels.map(ch => {
                const badgeClass = (ch.status_type === 'available' || ch.status === 'Available' || ch.status === 'Tersedia' || ch.status === 'Доступно')
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : (ch.status_type === 'coming_soon' || ch.status_type === 'in_dev' || ch.status === 'Coming Soon' || ch.status === 'Segera Hadir' || ch.status === 'Скоро')
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-slate-100 text-slate-700 border-slate-300';

                return `
                  <div 
                    id="cw-channel-${ch.id}"
                    role="tab"
                    tabindex="0"
                    aria-selected="${ch.id === 'webapp' ? 'true' : 'false'}"
                    onclick="selectPlatformChannel('${ch.id}')"
                    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectPlatformChannel('${ch.id}');}"
                    class="cw-channel-card bento-card p-4 bg-white border border-[#CBD5E1] rounded-xl cursor-pointer hover:border-[#1768C9] transition-all duration-150 flex flex-col justify-between select-none min-h-[140px] group ${ch.id === 'webapp' ? 'border-[#1768C9] bg-blue-50/30 ring-2 ring-[#1768C9]/20 shadow-sm' : ''}"
                  >
                    <div>
                      <div class="flex items-center justify-between gap-2 mb-2">
                        <div class="flex items-center gap-2">
                          <div class="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 group-hover:bg-blue-50/50 transition-colors">
                            ${renderChannelBrandIcon(ch.id)}
                          </div>
                          <span class="font-bold text-sm text-[#06366B]">${ch.name}</span>
                        </div>
                        <span class="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeClass}">
                          ${ch.status}
                        </span>
                      </div>
                      <div class="text-[11px] font-medium text-slate-500 mb-2">${ch.subtitle}</div>
                      <p class="text-xs text-slate-600 line-clamp-2 leading-snug">${ch.example}</p>
                    </div>
                    <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-[#1768C9]">
                      <span>${ui.inspect_flow || 'Inspect flow'}</span>
                      <span>&rarr;</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- CONNECTOR: DOWNWARD FLOW INDICATOR -->
          <div class="flex justify-center py-2 sm:py-3 relative">
            <div class="inline-flex items-center gap-2 text-xs font-mono font-bold text-slate-400 bg-white/70 backdrop-blur-xs px-3 py-1 rounded-full border border-slate-200">
              <svg class="w-3.5 h-3.5 text-[#1768C9] animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
              <span>${ui.connector_1 || 'Secure Ingestion &amp; API Integration'}</span>
            </div>
          </div>

          <!-- LEVEL 2: CFO AI INTELLIGENCE ENGINE (Central Component) -->
          <div class="mb-4">
            <div class="bento-card p-6 sm:p-8 bg-white border-2 border-[#1768C9]/30 rounded-2xl shadow-md relative overflow-hidden">
              ${renderWatermark({ color: '#06366B', opacity: '0.035', size: 'w-72 h-72', className: 'absolute -right-12 -top-12 pointer-events-none select-none z-0' })}
              
              <!-- Engine Header -->
              <div class="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-slate-100 gap-4 relative z-10">
                <div class="flex items-start sm:items-center gap-3.5">
                  <div class="w-11 h-11 rounded-xl bg-[#06366B] flex items-center justify-center shrink-0 shadow-xs p-2">
                    <svg viewBox="0 0 200 200" fill="none" class="w-full h-full">
                      <path d="M 12.97,127.48 L 73.25,188.00 L 98.67,187.03 L 149.75,135.71 L 167.66,135.71 L 124.33,179.77 L 131.59,187.03 L 187.03,131.59 L 184.85,126.27 L 145.88,126.27 L 93.83,177.59 L 77.12,178.56 L 20.23,121.43 Z M 187.03,66.47 L 133.77,12.00 L 103.03,12.00 L 29.43,86.08 L 36.69,92.13 L 110.05,18.54 L 125.78,18.54 L 167.91,59.45 L 148.78,60.42 L 113.92,26.53 L 107.87,33.79 L 144.91,70.83 L 184.85,70.83 Z M 69.13,12.00 L 13.94,67.44 L 12.00,92.86 L 88.02,170.57 L 94.07,162.34 L 21.44,88.98 L 21.44,74.22 L 78.57,17.33 L 75.67,12.00 Z" fill="#FFFFFF" fill-rule="evenodd"/>
                      <circle cx="101.57" cy="98.67" r="17.91" fill="#318FF4"/>
                    </svg>
                  </div>
                  <div>
                    <div class="inline-flex items-center gap-2 mb-1">
                      <span class="text-[10px] font-mono font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${ui.level_2_badge || 'LEVEL 2 • CENTRAL CORE'}</span>
                      <span class="text-xs uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">${ui.level_2_pill || 'AI Suggests • User Confirms'}</span>
                    </div>
                    <h3 class="text-xl sm:text-2xl font-black text-[#06366B] tracking-tight">${cw.intelligence_engine.title}</h3>
                    <p class="text-xs text-slate-500 mt-0.5">${cw.intelligence_engine.subtitle}</p>
                  </div>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                  <span class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    ${ui.level_2_status || 'Centralized Validation Core'}
                  </span>
                </div>
              </div>

              <!-- 4 Central Capabilities Grid -->
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 relative z-10">
                ${cw.intelligence_engine.capabilities.map((cap, capIdx) => `
                  <div class="bg-slate-50/80 rounded-xl border border-slate-200/80 p-4 hover:bg-slate-50 transition-colors">
                    <div class="flex items-center gap-2 mb-2">
                      <span class="w-6 h-6 rounded-full bg-[#1768C9] text-white font-mono font-bold text-xs flex items-center justify-center shrink-0">0${capIdx + 1}</span>
                      <h4 class="text-xs font-bold text-[#06366B] leading-tight">${cap.title}</h4>
                    </div>
                    <p class="text-[11px] text-slate-600 leading-relaxed">${cap.desc}</p>
                  </div>
                `).join('')}
              </div>

              <!-- Dynamic Channel Flow Inspector & Governance Callout -->
              <div id="cw-inspector" class="bg-gradient-to-r from-blue-50/70 via-slate-50 to-blue-50/40 rounded-xl border border-blue-200/80 p-5 relative z-10">
                <div class="flex flex-col md:flex-row md:items-center justify-between pb-3 mb-3 border-b border-blue-100 gap-2">
                  <div class="flex items-center gap-2.5">
                    <span class="text-[10px] font-mono font-bold text-[#1768C9] bg-white px-2 py-0.5 rounded border border-blue-200">${ui.inspector_badge || 'ACTIVE CHANNEL INSPECTOR'}</span>
                    <div id="cw-insp-icon" class="w-6 h-6 rounded bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      ${renderChannelBrandIcon(cw.channels[4].id)}
                    </div>
                    <span id="cw-insp-title" class="text-sm font-black text-[#06366B]">${cw.channels[4].name}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span id="cw-insp-badge" class="text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-800 border-emerald-200">
                      ${cw.channels[4].status}
                    </span>
                  </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                  <!-- Col 1: Business Scenario -->
                  <div class="space-y-1">
                    <span class="text-[10px] uppercase font-bold text-slate-500 tracking-wider">${ui.inspector_col1 || 'Business Scenario'}</span>
                    <div id="cw-insp-example" class="font-medium text-[#06366B] italic bg-white/70 p-2.5 rounded-lg border border-slate-200/60 leading-snug">
                      "${cw.channels[4].example}"
                    </div>
                  </div>

                  <!-- Col 2: Pipeline Data Flow -->
                  <div class="space-y-1">
                    <span class="text-[10px] uppercase font-bold text-slate-500 tracking-wider">${ui.inspector_col2 || 'End-to-End Pipeline'}</span>
                    <div class="bg-white/70 p-2.5 rounded-lg border border-slate-200/60">
                      <div id="cw-insp-flow" class="font-mono text-[11px] text-[#1768C9] font-bold leading-snug">
                        ${cw.channels[4].flow_desc}
                      </div>
                    </div>
                  </div>

                  <!-- Col 3: Governance & Technical Boundary -->
                  <div class="space-y-1">
                    <span class="text-[10px] uppercase font-bold text-slate-500 tracking-wider">${ui.inspector_col3 || 'Governance &amp; Controls'}</span>
                    <div id="cw-insp-desc" class="text-slate-600 bg-white/70 p-2.5 rounded-lg border border-slate-200/60 leading-snug">
                      ${cw.channels[4].description}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- CONNECTOR: DOWNWARD FLOW INDICATOR -->
          <div class="flex justify-center py-2 sm:py-3 relative">
            <div class="inline-flex items-center gap-2 text-xs font-mono font-bold text-slate-400 bg-white/70 backdrop-blur-xs px-3 py-1 rounded-full border border-slate-200">
              <svg class="w-3.5 h-3.5 text-[#1768C9] animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
              <span>${ui.connector_2 || 'Verified Ledger Posting &amp; Tenant Isolation'}</span>
            </div>
          </div>

          <!-- LEVEL 3: UNIFIED FINANCIAL WORKSPACE -->
          <div class="mb-8">
            <div class="flex items-center justify-between mb-3 px-1">
              <div class="inline-flex items-center gap-2">
                <span class="text-xs font-mono font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${ui.level_3_badge || 'LEVEL 3'}</span>
                <span class="text-xs font-bold text-[#06366B] uppercase tracking-wider">${cw.workspace_destinations.badge}</span>
              </div>
              <span class="text-[11px] text-slate-500 hidden sm:inline">${cw.workspace_destinations.title}</span>
            </div>

            <!-- 6 Domains Grid -->
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              ${cw.workspace_destinations.items.map((it, itIdx) => `
                <div class="bento-card p-3.5 bg-white border border-[#CBD5E1] rounded-xl hover:border-[#1768C9] transition-colors flex flex-col justify-between">
                  <div>
                    <div class="w-7 h-7 rounded-lg bg-blue-50/70 border border-blue-100 flex items-center justify-center mb-2.5">
                      ${renderDestinationIcon(itIdx)}
                    </div>
                    <h5 class="text-xs font-black text-[#06366B] mb-1">${it.name}</h5>
                    <p class="text-[10px] text-slate-600 leading-tight">${it.desc}</p>
                  </div>
                  <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-[9px] font-bold text-slate-500">
                    <span class="w-1.5 h-1.5 rounded-full bg-[#1768C9]"></span>
                    <span>${it.tag || 'Operational Domain'}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- TRANSITION BANNER (Seamlessly bridges to Workflows) -->
          <div class="bg-gradient-to-r from-[#021B36] via-[#042C53] to-[#021B36] text-white rounded-xl p-5 sm:p-6 text-center max-w-4xl mx-auto shadow-sm border border-white/10 relative overflow-hidden">
            ${renderWatermark({ color: '#FFFFFF', opacity: '0.03', size: 'w-48 h-48', className: 'absolute -right-8 -bottom-8 pointer-events-none select-none z-0' })}
            <div class="relative z-10 max-w-2xl mx-auto">
              <span class="text-[10px] font-mono font-bold uppercase tracking-widest text-blue-300 block mb-1">${ui.transition_badge || 'END-TO-END FLOW ARCHITECTURE'}</span>
              <p class="text-xs sm:text-sm font-semibold text-slate-100 leading-relaxed mb-3">
                ${cw.transition}
              </p>
              <div class="inline-flex items-center gap-2 text-xs font-bold text-blue-300 hover:text-white transition-colors">
                <span>${ui.transition_cta || 'Explore the 3 end-to-end workflows below'}</span>
                <svg class="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </div>
            </div>
          </div>

          <!-- FOOTNOTE DISCLAIMER -->
          <div class="text-center mt-4">
            <p class="text-[11px] text-slate-500 max-w-3xl mx-auto leading-normal">
              ${cw.footnote}
            </p>
          </div>
        </div>
      </section>

      <!-- CLIENT SCRIPT FOR CONNECTED WORKSPACE CHANNEL SELECTION -->
      <script>
        (function() {
          const channelData = ${JSON.stringify(channels)};
          
          window.selectPlatformChannel = function(id) {
            const channel = channelData.find(function(c) { return c.id === id; });
            if (!channel) return;

            // Update card selected states
            channelData.forEach(function(c) {
              const card = document.getElementById('cw-channel-' + c.id);
              if (!card) return;
              const isCurrent = (c.id === id);
              card.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
              if (isCurrent) {
                card.classList.remove('border-[#CBD5E1]', 'bg-white');
                card.classList.add('border-[#1768C9]', 'bg-blue-50/30', 'ring-2', 'ring-[#1768C9]/20', 'shadow-sm');
              } else {
                card.classList.remove('border-[#1768C9]', 'bg-blue-50/30', 'ring-2', 'ring-[#1768C9]/20', 'shadow-sm');
                card.classList.add('border-[#CBD5E1]', 'bg-white');
              }
            });

            // Update Inspector elements
            const titleEl = document.getElementById('cw-insp-title');
            const badgeEl = document.getElementById('cw-insp-badge');
            const flowEl = document.getElementById('cw-insp-flow');
            const descEl = document.getElementById('cw-insp-desc');
            const exampleEl = document.getElementById('cw-insp-example');

            if (titleEl) titleEl.textContent = channel.name;
            const iconEl = document.getElementById('cw-insp-icon');
            const cardEl = document.getElementById('cw-channel-' + id);
            if (iconEl && cardEl) {
              const cardSvg = cardEl.querySelector('svg');
              if (cardSvg) iconEl.innerHTML = cardSvg.outerHTML;
            }
            if (exampleEl) exampleEl.textContent = '"' + channel.example + '"';
            if (flowEl) flowEl.textContent = channel.flow_desc;
            if (descEl) descEl.textContent = channel.description;

            if (badgeEl) {
              badgeEl.textContent = channel.status;
              var badgeClass = channel.status_type === 'available'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : channel.status_type === 'in_dev'
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-slate-100 text-slate-700 border-slate-300';
              badgeEl.className = 'text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ' + badgeClass;
            }
          };
        })();
      </script>
    `;
  }

  // --- LOCALIZED PLATFORM PAGE (/:locale/platform) ---
  router.get('/:locale/platform', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/platform');

    const t = getT(locale);
    const seo = contentStore.getSeo();
    const title = seo.pages_meta?.platform?.title || `${t.platform.heading} — CFO AI Indonesia`;
    const description = seo.pages_meta?.platform?.description || t.platform.subheading;
    const canonical = `https://cfo-ai.site/${locale}/platform`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/platform`
    }));

    // Primary showcases: large full uncropped UI layouts
    const primaryModules = [
      { id: 'pulse', key: 'pulse', img: '/assets/screens/Main.png' },
      { id: 'radar', key: 'radar', img: '/assets/screens/Radar.png' },
      { id: 'accounts', key: 'accounts', img: '/assets/screens/Accounts.png' },
      { id: 'transactions', key: 'transactions', img: '/assets/screens/Transactions.png' },
      { id: 'bank-import', key: 'bank_import', img: '/assets/screens/BankImport.png' }
    ];

    // Secondary feature grid: compact cards with full uncropped previews + lightbox
    const secondaryModules = [
      { id: 'invoicing', key: 'invoicing', img: '/assets/screens/BillDetail.png' },
      { id: 'bills', key: 'bills', img: '/assets/screens/Bills.png' },
      { id: 'approvals', key: 'approvals', img: '/assets/screens/Approvals.png' },
      { id: 'doc-intelligence', key: 'doc_intelligence', img: '/assets/screens/Documents.png' },
      { id: 'ai-cfo', key: 'ai_cfo', img: '/assets/screens/AICFO.png' },
      { id: 'ai-accountant', key: 'ai_accountant', img: '/assets/screens/AccountantPackages.png' },
      { id: 'compliance', key: 'compliance', img: '/assets/screens/AccountantTaxes.png' },
      { id: 'payroll', key: 'payroll', img: '/assets/screens/Payroll.png' },
      { id: 'multi-company', key: 'multi_company', img: '/assets/screens/MultiEntity.png' }
    ];

    const contentHtml = `
      <!-- PLATFORM HERO (Soft Ice Blue with Watermark) -->
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1] relative overflow-hidden">
        ${renderWatermark({ color: '#06366B', opacity: '0.04', size: 'w-[480px] h-[480px]', className: 'absolute -right-24 -top-12 pointer-events-none select-none z-0' })}
        <div class="max-w-7xl mx-auto text-center relative z-10">
          <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${t.platform.badge}</span>
          <h1 class="text-3xl sm:text-5xl font-black text-[#06366B] mt-2 mb-4">${t.platform.heading}</h1>
          <p class="text-sm text-slate-700 max-w-2xl mx-auto mb-10">${t.platform.subheading}</p>
        </div>
      </section>

      <!-- CONNECTED FINANCIAL WORKSPACE -->
      ${renderConnectedWorkspaceSection(t, locale)}

      <!-- HOW CFO AI WORKS (Cross-Functional Business Workflows) -->
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-light border-b border-[#CBD5E1] relative">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-14">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${t.platform.how_it_works_badge || 'END-TO-END BUSINESS WORKFLOWS'}</span>
            <h2 class="text-2xl sm:text-4xl font-black text-[#06366B] mt-1.5 mb-3">${t.platform.how_it_works_heading}</h2>
            <p class="text-xs sm:text-sm text-slate-600 max-w-2xl mx-auto leading-relaxed">${t.platform.how_it_works_subheading}</p>
          </div>

          <!-- 3 Workflows -->
          <div class="space-y-12">
            ${(t.platform.workflows || []).map((wf) => `
              <div class="bento-card p-6 sm:p-8 bg-white border border-[#CBD5E1] shadow-xs">
                <!-- Workflow Header -->
                <div class="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-slate-100 gap-4">
                  <div>
                    <div class="inline-flex items-center gap-2 mb-2">
                      <span class="text-xs font-mono font-bold text-[#1768C9] bg-blue-50 px-2.5 py-0.5 rounded">WORKFLOW ${wf.num}</span>
                      <span class="text-xs uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-100 text-[#06366B] border border-slate-200">${wf.badge}</span>
                    </div>
                    <h3 class="text-xl sm:text-2xl font-black text-[#06366B] tracking-tight">${wf.title}</h3>
                    <p class="text-xs sm:text-sm text-slate-600 mt-1 max-w-3xl leading-relaxed">${wf.desc}</p>
                  </div>
                  <div class="shrink-0">
                    <span class="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                      ${(t.platform.connected_workspace && t.platform.connected_workspace.ui) ? t.platform.connected_workspace.ui.connected_steps : '4 Connected Steps'}
                    </span>
                  </div>
                </div>

                <!-- 4 Connected Steps Grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 relative">
                  ${wf.steps.map((st, stepIdx) => {
                    const isLast = stepIdx === wf.steps.length - 1;
                    const tagClass = (st.tag_type === 'authorized' || st.tag_type === 'settled' || st.tag_type === 'actionable' || st.tag_type === 'verified')
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : (st.tag_type === 'assist' || st.tag_type === 'projected' || st.tag_type === 'separated')
                      ? 'bg-blue-50 text-[#1768C9] border-blue-200'
                      : (st.tag_type === 'reviewed' || st.tag_type === 'tracked' || st.tag_type === 'aggregated')
                      ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                      : 'bg-slate-100 text-slate-700 border-slate-300';
                    const tagBadge = '<span class="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ' + tagClass + '">' + st.tag + '</span>';

                    return `
                      <div class="relative flex flex-col justify-between bg-slate-50/70 hover:bg-slate-50 rounded-xl border border-slate-200/80 p-5 transition-all">
                        <div>
                          <div class="flex items-center justify-between mb-3">
                            <span class="w-7 h-7 rounded-full bg-[#1768C9] text-white font-mono font-bold text-xs flex items-center justify-center shadow-xs">${st.step}</span>
                            ${tagBadge}
                          </div>
                          <span class="text-[10px] font-bold text-[#1768C9] uppercase tracking-wider block mb-1">${st.label}</span>
                          <h4 class="text-sm font-black text-[#06366B] mb-2 leading-snug">${st.title}</h4>
                          <p class="text-xs text-slate-600 leading-relaxed">${st.desc}</p>
                        </div>
                        
                        ${!isLast ? `
                          <div class="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-slate-400">
                            <svg class="w-6 h-6 transform translate-x-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                          </div>
                        ` : ''}
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- PRIMARY PRODUCT SHOWCASES (Complete Uncropped Full UI with Lightbox) -->
      <section id="features" class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-light border-b border-[#CBD5E1] scroll-mt-20">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-12">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">PRIMARY INTERFACE SHOWCASE</span>
            <h2 class="text-2xl sm:text-3xl font-black text-[#06366B] mt-1 mb-2">${t.platform.primary_heading}</h2>
            <p class="text-xs text-slate-600">${t.platform.primary_subheading}</p>
          </div>

          <div class="space-y-16">
            ${primaryModules.map((m, idx) => {
              const mod = t.platform.modules[m.key];
              const isEven = idx % 2 === 1;
              return `
                <div id="${m.id}" class="bento-card p-6 sm:p-8 scroll-mt-24">
                  <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                    <div class="lg:col-span-5 ${isEven ? 'lg:order-2' : ''}">
                      <div class="inline-flex items-center gap-2 mb-3">
                        <span class="text-xs font-mono font-bold text-[#1768C9] bg-blue-50 px-2.5 py-0.5 rounded">MOD 0${idx + 1}</span>
                        <span class="text-xs uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">${t.platform.authentic_tag}</span>
                      </div>
                      <h3 class="text-2xl font-black text-[#06366B] mb-3">${mod.title}</h3>
                      <p class="text-xs sm:text-sm text-slate-600 leading-relaxed mb-6">${mod.desc}</p>
                      <button onclick="openLightbox('${m.img}', '${mod.title}', '${mod.desc.replace(/'/g, "\\'")}', '${t.platform.authentic_tag}')" class="inline-flex items-center gap-2 text-xs font-bold text-[#1768C9] hover:underline cursor-pointer min-h-[44px]">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"/></svg>
                        <span>${t.platform.click_to_enlarge} &rarr;</span>
                      </button>
                    </div>

                    <div class="lg:col-span-7 ${isEven ? 'lg:order-1' : ''}">
                      <div class="browser-frame cursor-zoom-in" onclick="openLightbox('${m.img}', '${mod.title}', '${mod.desc.replace(/'/g, "\\'")}', '${t.platform.authentic_tag}')">
                        <div class="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                          <div class="flex items-center gap-1.5">
                            <span class="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
                            <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                            <span class="font-mono ml-2 font-bold text-[#06366B]">${mod.title}</span>
                          </div>
                          <span class="text-[10px] font-semibold text-[#475569] font-mono">100% Complete UI</span>
                        </div>
                        <div class="p-2 sm:p-4 bg-white flex items-center justify-center">
                          <img src="${m.img}" alt="${mod.title}" class="w-full h-auto max-h-[380px] object-contain rounded" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>

      <!-- SECONDARY FEATURE GRID (9 Compact Cards with Full Preview & Lightbox) -->
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1]">
        <div class="max-w-7xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-12">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">SPECIALIZED MODULES</span>
            <h2 class="text-2xl sm:text-3xl font-black text-[#06366B] mt-1 mb-2">${t.platform.secondary_heading}</h2>
            <p class="text-xs text-slate-600">${t.platform.secondary_subheading}</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            ${secondaryModules.map((m, idx) => {
              const mod = t.platform.modules[m.key];
              return `
                <div id="${m.id}" class="bento-card p-6 flex flex-col justify-between scroll-mt-24">
                  <div>
                    <div class="flex items-center justify-between mb-3">
                      <span class="text-xs font-mono font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded">MOD 0${idx + 6}</span>
                      <span class="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">${t.platform.authentic_tag}</span>
                    </div>
                    <h3 class="font-black text-lg text-[#06366B] mb-2">${mod.title}</h3>
                    <p class="text-xs text-slate-600 leading-relaxed mb-6">${mod.desc}</p>
                  </div>

                  <div class="border-t border-slate-100 pt-4">
                    <div class="browser-frame cursor-zoom-in" onclick="openLightbox('${m.img}', '${mod.title}', '${mod.desc.replace(/'/g, "\\'")}', '${t.platform.authentic_tag}')">
                      <div class="p-2 bg-white flex items-center justify-center">
                        <img src="${m.img}" alt="${mod.title}" class="w-full h-44 object-contain rounded" />
                      </div>
                    </div>
                    <div class="text-center mt-3">
                      <button onclick="openLightbox('${m.img}', '${mod.title}', '${mod.desc.replace(/'/g, "\\'")}', '${t.platform.authentic_tag}')" class="text-xs font-bold text-[#1768C9] hover:underline cursor-pointer min-h-[44px]">
                        ${t.platform.click_to_enlarge} &rarr;
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

        </div>
      </section>

      <!-- FLOATING FINAL CTA SECTION (Centered 1200px Floating Banner on Ice Blue Canvas) -->
      <section class="bg-ice-light pt-6 sm:pt-8 pb-[30px] px-4 sm:px-6 lg:px-8">
        <div class="max-w-[1200px] mx-auto">
          <div class="bg-navy-brand text-white text-center relative overflow-hidden rounded-[20px] py-5 sm:py-5 px-6 sm:px-8 shadow-xl border border-white/10" style="background: linear-gradient(90deg, #021B36 0%, #042C53 25%, #063D72 50%, #042C53 75%, #021B36 100%);">
            ${renderWatermark({ color: '#FFFFFF', opacity: '0.035', size: 'w-64 h-64', className: 'absolute -right-8 -bottom-8 pointer-events-none select-none z-0' })}
            <div class="max-w-3xl mx-auto relative z-10">
              <h2 class="text-lg sm:text-xl md:text-2xl font-black tracking-tight mb-1.5 text-white">${t.cta_section.heading}</h2>
              <p class="text-xs sm:text-sm text-slate-300 max-w-lg mx-auto mb-3.5 leading-normal sm:leading-relaxed">${t.cta_section.subheading}</p>
              <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
                <a href="https://app.cfo-ai.site/login" class="w-full sm:w-auto inline-flex items-center justify-center text-xs sm:text-sm font-bold bg-[#1768C9] hover:bg-[#318FF4] text-white px-6 py-2.5 rounded-xl shadow-md transition-all min-h-[40px]">
                  ${t.hero.primary_cta} &rarr;
                </a>
              </div>
              <div class="text-xs sm:text-sm text-slate-600 mt-2 font-medium">${t.cta_section.note}</div>
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
      activeTab: 'platform',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- LOCALIZED PRICING PAGE (/:locale/pricing) ---
  router.get('/:locale/pricing', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/pricing');

    const t = getT(locale);
    const pricing = contentStore.getPricing();
    const seo = contentStore.getSeo();
    const pPage = t.pricing_page || {};
    const title = seo.pages_meta?.pricing?.title || `${pPage.heading} — CFO AI Indonesia`;
    const description = seo.pages_meta?.pricing?.description || (pPage.subheading || pPage.subheadline || '');
    const canonical = `https://cfo-ai.site/${locale}/pricing`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/pricing`
    }));

    const categoryTitles = {
      financial_core: pPage.cat_financial_core || "Financial Core",
      operations: pPage.cat_operations || "Operations & Spend Control",
      ai_automation: pPage.cat_ai_automation || "AI & Automation",
      tax_compliance: pPage.cat_tax_compliance || "Tax & Compliance",
      team_organization: pPage.cat_team_organization || "Team & Organization",
      integrations_usage: pPage.cat_integrations_usage || "Integrations & Platform"
    };

    const renderCell = (val, isControl = false) => {
      if (val === 'Included' || val === true) {
        return '<span class="inline-flex items-center justify-center text-emerald-600 font-extrabold text-sm" title="Included"><svg class="w-4 h-4 text-emerald-600 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg></span>';
      }
      if (val === '—' || val === '-' || val === 'Not Included' || val === false) {
        return '<span class="inline-flex items-center justify-center text-slate-400 font-bold text-sm" title="Not Included">—</span>';
      }
      return `<span class="font-mono-num ${isControl ? 'font-bold text-[#06366B]' : 'font-semibold text-slate-700'} text-xs">${val}</span>`;
    };

    const isQuotaRow = r => r.name.includes('/ Month') || r.name.includes('Seats') || r.name.includes('Workspaces') || r.name.includes('Accounts') || r.name.includes('Booked') || r.name.includes('Requests') || r.name.includes('OCR');

    // Level A: Business Capabilities Rows
    const levelARowsHtml = (pricing.matrix_categories || []).map(cat => {
      const catTitle = categoryTitles[cat.id] || cat.category_name;
      const capabilities = (cat.rows || []).filter(r => !isQuotaRow(r));
      if (capabilities.length === 0) return '';

      const rows = capabilities.map(r => `
        <tr class="hover:bg-slate-50/70 border-b border-slate-100 transition-colors">
          <td class="p-3.5 sm:p-4 font-semibold text-[#06366B]">
            <div class="font-bold text-xs">${r.name}</div>
            ${r.desc ? `<div class="text-[11px] text-slate-500 font-normal leading-tight mt-0.5">${r.desc}</div>` : ''}
          </td>
          <td class="p-3.5 sm:p-4 text-center">
            ${renderCell(r.starter)}
          </td>
          <td class="p-3.5 sm:p-4 text-center bg-blue-50/30 border-x border-blue-100 font-bold text-[#06366B]">
            ${renderCell(r.control, true)}
          </td>
          <td class="p-3.5 sm:p-4 text-center">
            ${renderCell(r.pro)}
          </td>
        </tr>
      `).join('');

      return `
        <tr class="bg-slate-100/90 border-t-2 border-slate-200">
          <th colspan="4" class="py-2.5 px-4 text-xs font-black uppercase tracking-wider text-[#06366B] bg-slate-100/90 text-left">
            ${catTitle}
          </th>
        </tr>
        ${rows}
      `;
    }).join('');

    // Level B: Technical Limits & Quotas Rows
    const levelBRowsHtml = (pricing.matrix_categories || []).map(cat => {
      const catTitle = categoryTitles[cat.id] || cat.category_name;
      const quotas = (cat.rows || []).filter(r => isQuotaRow(r));
      if (quotas.length === 0) return '';

      const rows = quotas.map(r => `
        <tr class="hover:bg-slate-50/70 border-b border-slate-100 transition-colors">
          <td class="p-3.5 sm:p-4 font-semibold text-[#06366B]">
            <div class="font-bold text-xs">${r.name}</div>
            ${r.desc ? `<div class="text-[11px] text-slate-500 font-normal leading-tight mt-0.5">${r.desc}</div>` : ''}
          </td>
          <td class="p-3.5 sm:p-4 text-center">
            ${renderCell(r.starter)}
          </td>
          <td class="p-3.5 sm:p-4 text-center bg-blue-50/30 border-x border-blue-100 font-bold text-[#06366B]">
            ${renderCell(r.control, true)}
          </td>
          <td class="p-3.5 sm:p-4 text-center">
            ${renderCell(r.pro)}
          </td>
        </tr>
      `).join('');

      return `
        <tr class="bg-slate-100/90 border-t-2 border-slate-200">
          <th colspan="4" class="py-2.5 px-4 text-xs font-black uppercase tracking-wider text-[#06366B] bg-slate-100/90 text-left">
            ${catTitle}
          </th>
        </tr>
        ${rows}
      `;
    }).join('');

    const plans = [
      { key: 'starter', ...pPage.cards.starter, is_recommended: false, price_val: '$59' },
      { key: 'control', ...pPage.cards.control, is_recommended: true, price_val: '$149' },
      { key: 'pro', ...pPage.cards.pro, is_recommended: false, price_val: '$249' }
    ];

    const contentHtml = `
      <section class="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1] relative overflow-hidden" id="pricing-hero">
        ${renderWatermark({ color: '#06366B', opacity: '0.04', size: 'w-96 h-96', className: 'absolute -right-20 -top-10 pointer-events-none select-none z-0' })}
        <div class="max-w-7xl mx-auto text-center relative z-10">
          <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${pPage.badge}</span>
          <h1 class="text-3xl sm:text-5xl font-black text-[#06366B] mt-2 mb-4 tracking-tight">${pPage.heading}</h1>
          <p class="text-sm sm:text-base text-slate-700 max-w-2xl mx-auto mb-8 leading-relaxed">${pPage.subheading || pPage.subheadline}</p>

          <!-- VALUE PILLS -->
          <div class="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-14 max-w-4xl mx-auto">
            ${(pPage.pills || []).map(pill => `
              <div class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-[#CBD5E1] shadow-xs text-xs font-semibold text-[#06366B]">
                <svg class="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                <span>${pill}</span>
              </div>
            `).join('')}
          </div>

          <!-- 3 OUTCOME-ORIENTED PRICING CARDS -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto mb-20 text-left items-stretch">
            ${plans.map(p => `
              <div class="bento-card p-7 sm:p-8 flex flex-col justify-between bg-white rounded-2xl ${p.is_recommended ? 'border-2 border-[#1768C9] shadow-xl relative ring-4 ring-blue-500/10' : 'border border-[#CBD5E1] shadow-sm'}">
                ${p.is_recommended ? `<div class="absolute -top-3.5 left-1/2 transform -translate-x-1/2 bg-[#1768C9] text-white text-[10px] font-black uppercase tracking-wider px-3.5 py-1 rounded-full shadow-sm">${p.badge}</div>` : ''}
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-black uppercase tracking-wider text-[#1768C9]">${p.name}</span>
                    <span class="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">${pPage.trial_badge}</span>
                  </div>
                  <h3 class="text-xl font-black text-[#06366B] mb-2">${p.outcome}</h3>
                  <p class="text-xs text-slate-600 mb-6 leading-relaxed">${p.desc}</p>
                  
                  <div class="flex items-baseline gap-1 mb-4">
                    <span class="text-4xl font-black text-[#06366B] font-mono-num plan-price">${p.price_val}</span>
                    <span class="text-xs text-slate-500 plan-interval">${pPage.per_month}</span>
                  </div>

                  <div class="p-3 rounded-xl bg-blue-50/60 border border-blue-100 text-xs text-[#06366B] font-semibold mb-6 flex items-center gap-2">
                    <svg class="w-4 h-4 text-[#1768C9] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                    <span>${p.limits_highlight}</span>
                  </div>

                  <ul class="space-y-2.5 text-xs text-slate-700 mb-8">
                    ${p.benefits.map(b => `
                      <li class="flex items-start gap-2.5">
                        <svg class="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                        <span class="leading-snug">${b}</span>
                      </li>
                    `).join('')}
                  </ul>
                </div>

                <a href="${p.url}" data-track-cta="pricing-plan-trial" data-track-plan="${p.key}" class="w-full text-center text-xs font-bold py-3.5 rounded-xl transition-all min-h-[44px] flex items-center justify-center ${p.is_recommended ? 'bg-[#1768C9] hover:bg-[#06366B] text-white shadow-md' : 'bg-white hover:bg-slate-50 text-[#06366B] border border-[#CBD5E1]'}">
                  ${p.cta} &rarr;
                </a>
              </div>
            `).join('')}
          </div>

          <!-- HOW CFO AI WORKS FOR YOUR TEAM (OPERATIONAL WORKFLOW) -->
          <div class="max-w-6xl mx-auto mb-20 text-left">
            <div class="text-center mb-10 max-w-3xl mx-auto">
              <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${pPage.team_workflow.eyebrow}</span>
              <h2 class="text-2xl sm:text-3xl font-black text-[#06366B] mt-2 mb-2 tracking-tight">${pPage.team_workflow.title}</h2>
              <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${pPage.team_workflow.subtitle}</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              ${pPage.team_workflow.steps.map(s => `
                <div class="bento-card p-6 bg-white rounded-2xl border border-[#CBD5E1] shadow-xs flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between mb-4">
                      <span class="text-xs font-mono font-black text-[#1768C9] bg-blue-50 px-2.5 py-1 rounded border border-blue-200">STEP ${s.num}</span>
                      <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${s.phase}</span>
                    </div>
                    <h3 class="text-lg font-black text-[#06366B] mb-2">${s.title}</h3>
                    <p class="text-sm text-slate-700 leading-relaxed">
                  ${s.desc}</p>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- WHAT EVERY PLAN INCLUDES (FOUNDATIONAL PLATFORM TRUST) -->
          <div class="max-w-6xl mx-auto mb-20 text-left">
            <div class="text-center mb-10 max-w-3xl mx-auto">
              <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${pPage.platform_foundation.eyebrow}</span>
              <h2 class="text-2xl sm:text-3xl font-black text-[#06366B] mt-2 mb-2 tracking-tight">${pPage.platform_foundation.title}</h2>
              <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${pPage.platform_foundation.subtitle}</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              ${pPage.platform_foundation.items.map((item, idx) => `
                <div class="bento-card p-6 bg-white rounded-2xl border border-[#CBD5E1] shadow-xs">
                  <div class="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#1768C9] mb-3 shrink-0">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                  </div>
                  <h4 class="font-bold text-xs sm:text-sm text-[#06366B] mb-1.5">${item.title}</h4>
                  <p class="text-xs text-slate-600 leading-relaxed">${item.desc}</p>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- TWO-LEVEL COMPARISON MATRIX -->
          <div class="max-w-6xl mx-auto mb-20 text-left" id="plan-comparison">
            <div class="text-center mb-8 max-w-3xl mx-auto">
              <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">COMPREHENSIVE PLAN COMPARISON</span>
              <h2 class="text-2xl sm:text-3xl font-black text-[#06366B] mt-2 mb-2 tracking-tight">${pPage.comparison.title}</h2>
              <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${pPage.comparison.subtitle}</p>
            </div>

            <!-- LEVEL A: BUSINESS CAPABILITIES TABLE -->
            <div class="mb-6">
              <div class="flex items-center gap-2 mb-3">
                <span class="text-xs font-mono font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">LEVEL A</span>
                <span class="text-xs font-bold text-[#06366B] uppercase tracking-wider">${pPage.comparison.level_a_tab}</span>
              </div>

              <div class="bento-card overflow-x-auto shadow-sm rounded-2xl bg-white border border-[#CBD5E1]">
                <table class="w-full text-xs text-left border-collapse min-w-[680px]">
                  <thead>
                    <tr class="bg-slate-50 border-b border-slate-200 text-[#06366B]">
                      <th class="p-4 text-left font-bold text-xs uppercase tracking-wider w-2/5">${pPage.comparison.th_feature}</th>
                      <th class="p-4 text-center font-bold text-xs w-1/5">
                        <div class="text-[#06366B] font-black text-sm">Starter</div>
                        <div class="font-mono-num text-xs text-slate-500 mt-0.5">$59/mo</div>
                      </th>
                      <th class="p-4 text-center font-bold text-xs w-1/5 bg-blue-50/80 text-[#1768C9] border-x border-blue-200/80 relative">
                        <span class="text-[10px] uppercase font-black tracking-wider text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full inline-block mb-1">${pPage.comparison.recommended_tag}</span>
                        <div class="text-[#1768C9] font-black text-sm">Control</div>
                        <div class="font-mono-num text-xs font-bold text-[#06366B] mt-0.5">$149/mo</div>
                      </th>
                      <th class="p-4 text-center font-bold text-xs w-1/5">
                        <div class="text-[#06366B] font-black text-sm">Pro</div>
                        <div class="font-mono-num text-xs text-slate-500 mt-0.5">$249/mo</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    ${levelARowsHtml}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- LEVEL B: TECHNICAL LIMITS & QUOTAS (COLLAPSIBLE ACCORDION) -->
            <details class="group bento-card overflow-hidden bg-white border border-[#CBD5E1] shadow-sm rounded-2xl">
              <summary class="p-4 sm:p-5 cursor-pointer flex items-center justify-between font-bold text-[#06366B] hover:bg-slate-50 transition-colors select-none list-none">
                <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                  <div class="inline-flex items-center gap-2">
                    <span class="text-xs font-mono font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">LEVEL B</span>
                    <span class="text-xs sm:text-sm font-black text-[#06366B]">${pPage.comparison.level_b_tab}</span>
                  </div>
                  <span class="text-[11px] text-slate-500 font-normal">(${pPage.comparison.level_b_hint})</span>
                </div>
                <span class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 group-open:bg-blue-50 group-open:text-[#1768C9] transition-transform group-open:rotate-180 shrink-0">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                </span>
              </summary>
              <div class="border-t border-slate-200 overflow-x-auto">
                <table class="w-full text-xs text-left border-collapse min-w-[680px]">
                  <thead>
                    <tr class="bg-slate-50 border-b border-slate-200 text-[#06366B]">
                      <th class="p-4 text-left font-bold text-xs uppercase tracking-wider w-2/5">${pPage.comparison.th_quota}</th>
                      <th class="p-4 text-center font-bold text-xs w-1/5">
                        <div class="text-[#06366B] font-black text-sm">Starter</div>
                        <div class="font-mono-num text-xs text-slate-500 mt-0.5">$59/mo</div>
                      </th>
                      <th class="p-4 text-center font-bold text-xs w-1/5 bg-blue-50/80 text-[#1768C9] border-x border-blue-200/80">
                        <div class="text-[#1768C9] font-black text-sm">Control</div>
                        <div class="font-mono-num text-xs font-bold text-[#06366B] mt-0.5">$149/mo</div>
                      </th>
                      <th class="p-4 text-center font-bold text-xs w-1/5">
                        <div class="text-[#06366B] font-black text-sm">Pro</div>
                        <div class="font-mono-num text-xs text-slate-500 mt-0.5">$249/mo</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    ${levelBRowsHtml}
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          <!-- CONNECTED FINANCIAL WORKSPACE (INTEGRATION CHANNELS) -->
          <div class="max-w-6xl mx-auto mb-20 text-left">
            <div class="text-center mb-10 max-w-3xl mx-auto">
              <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${pPage.connected_channels.eyebrow}</span>
              <h2 class="text-2xl sm:text-3xl font-black text-[#06366B] mt-2 mb-2 tracking-tight">${pPage.connected_channels.title}</h2>
              <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${pPage.connected_channels.subtitle}</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
              ${pPage.connected_channels.channels.map(ch => `
                <div class="bento-card p-5 bg-white border border-[#CBD5E1] shadow-xs rounded-xl flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between mb-3">
                      <div class="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                        ${renderChannelBrandIcon(ch.id)}
                      </div>
                      <span class="text-[10px] font-bold ${ch.id === 'whatsapp' || (ch.status && (ch.status.toLowerCase().includes('soon') || ch.status.toLowerCase().includes('hadir') || ch.status.toLowerCase().includes('скоро'))) ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-emerald-800 bg-emerald-50 border-emerald-200'} px-2 py-0.5 rounded-full border">
                        ${ch.status}
                      </span>
                    </div>
                    <div class="flex items-baseline gap-1.5 mb-1">
                      <h4 class="font-bold text-xs sm:text-sm text-[#06366B]">${ch.name}</h4>
                    </div>
                    <div class="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded inline-block mb-2">${ch.type}</div>
                    <p class="text-xs text-slate-600 mb-4 leading-relaxed">${ch.desc}</p>
                  </div>
                  <div class="pt-3 border-t border-slate-100 text-[11px] font-semibold text-[#1768C9] flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    <span>${ch.quota_note}</span>
                  </div>
                </div>
              `).join('')}
            </div>
            <p class="text-xs text-slate-500 text-center max-w-2xl mx-auto">${pPage.connected_channels.hint}</p>
          </div>

          <!-- SOFTWARE SUBSCRIPTION VS PROFESSIONAL ACCOUNTING SERVICES NOTICE -->
          <div class="bento-card p-6 sm:p-8 bg-slate-50/90 border border-slate-200 rounded-2xl max-w-5xl mx-auto mb-20 text-left">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xs font-bold uppercase tracking-wider text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">${pPage.accountant_notice.eyebrow}</span>
            </div>
            <h3 class="text-xl sm:text-2xl font-black text-[#06366B] mb-2">${pPage.accountant_notice.title}</h3>
            <p class="text-xs sm:text-sm text-slate-700 font-semibold mb-6 p-3 bg-white border border-slate-200 rounded-xl leading-relaxed">
              ${pPage.accountant_notice.statement}
            </p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              ${pPage.accountant_notice.distinctions.map(d => `
                <div class="p-4 bg-white rounded-xl border border-slate-200">
                  <div class="flex items-center gap-2 mb-1.5">
                    <span class="text-xs font-mono font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded">${d.num}</span>
                    <h4 class="font-bold text-xs sm:text-sm text-[#06366B]">${d.title}</h4>
                  </div>
                  <p class="text-xs text-slate-600 leading-relaxed">${d.desc}</p>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- 12 FREQUENTLY ASKED QUESTIONS -->
          <div class="max-w-4xl mx-auto mb-20 text-left" id="pricing-faq">
            <div class="text-center mb-10 max-w-3xl mx-auto">
              <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">FREQUENTLY ASKED QUESTIONS</span>
              <h2 class="text-2xl sm:text-3xl font-black text-[#06366B] mt-2 mb-2 tracking-tight">${pPage.faqs.title}</h2>
              <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${pPage.faqs.subtitle}</p>
            </div>

            <div class="space-y-3">
              ${pPage.faqs.items.map((item, idx) => `
                <details class="group bg-white rounded-xl border border-[#CBD5E1] p-4 sm:p-5 transition-all hover:border-blue-300 shadow-2xs" data-faq-index="${idx}">
                  <summary class="flex items-center justify-between cursor-pointer font-bold text-xs sm:text-sm text-[#06366B] select-none list-none">
                    <span class="pr-4 leading-snug">${item.q}</span>
                    <span class="shrink-0 w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 group-open:bg-blue-50 group-open:text-[#1768C9] transition-transform group-open:rotate-180">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                    </span>
                  </summary>
                  <div class="mt-3 pt-3 border-t border-slate-100 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    ${item.a}
                  </div>
                </details>
              `).join('')}
            </div>
          </div>

          <!-- ENTERPRISE CUSTOM MULTI-ENTITY DEPLOYMENT BANNER -->
          <div class="bento-card p-8 sm:p-10 bg-white border border-[#CBD5E1] shadow-sm max-w-4xl mx-auto text-center relative overflow-hidden rounded-2xl">
            ${renderWatermark({ color: '#06366B', opacity: '0.03', size: 'w-80 h-80', className: 'absolute -right-16 -bottom-16 pointer-events-none select-none z-0' })}
            <div class="relative z-10">
              <span class="text-[10px] font-black uppercase tracking-wider text-[#1768C9] bg-blue-50 px-3 py-1 rounded-full mb-3 inline-block">CUSTOM MULTI-ENTITY DEPLOYMENT</span>
              <h3 class="text-xl sm:text-2xl font-black text-[#06366B] mb-2.5">${pPage.custom_enterprise_title}</h3>
              <p class="text-xs sm:text-sm text-[#475569] max-w-xl mx-auto mb-6 leading-relaxed">${pPage.custom_enterprise_desc}</p>
              <a href="mailto:enterprise@cfo-ai.site" data-track-cta="pricing-enterprise-contact" class="inline-flex items-center justify-center text-xs sm:text-sm font-bold bg-[#1768C9] hover:bg-[#06366B] text-white px-7 py-3.5 rounded-xl shadow-sm transition-all min-h-[44px]">
                ${pPage.custom_enterprise_btn} &rarr;
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
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1] relative overflow-hidden">
        ${renderWatermark({ color: '#06366B', opacity: '0.04', size: 'w-96 h-96', className: 'absolute -right-20 -top-10 pointer-events-none select-none z-0' })}
        <div class="max-w-7xl mx-auto relative z-10">
          <div class="text-center max-w-3xl mx-auto mb-12">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">CFO AI KNOWLEDGE HUB</span>
            <h1 class="text-3xl sm:text-5xl font-black text-[#06366B] mt-2 mb-4">Indonesian Tax &amp; Finance Authority</h1>
            <p class="text-sm text-slate-700 leading-relaxed">
              Clear, practical regulatory and operational intelligence for PT and PT PMA business directors, in-house finance teams, and licensed Konsultan Pajak.
            </p>
          </div>

          <!-- 6 CATEGORIES CHIPS -->
          <div class="flex flex-wrap items-center justify-center gap-2 mb-12">
            <a href="/${locale}/blog" class="px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#06366B] text-white">All Categories (6)</a>
            ${categories.map(cat => `
              <span class="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:border-[#1768C9] hover:text-[#1768C9] cursor-pointer">
                ${cat.name}
              </span>
            `).join('')}
          </div>

          <!-- 3 CORNERSTONE DEEP-DIVE ARTICLES -->
          <div class="mb-16">
            <h2 class="text-xl font-black text-[#06366B] mb-6">Cornerstone Regulatory Guides</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
              ${articles.map(art => {
                const trans = art.translations?.[locale] || art.translations?.['en'] || {};
                return `
                  <article class="bento-card p-6 flex flex-col justify-between hover:border-[#1768C9]">
                    <div>
                      <div class="flex items-center justify-between text-xs text-slate-600 mb-3">
                        <span class="font-bold text-[#1768C9] bg-blue-50 px-2 py-0.5 rounded">${art.category_name}</span>
                        <span class="font-mono">${art.reading_time_minutes} min read</span>
                      </div>
                      <h3 class="font-black text-lg text-[#06366B] mb-3 leading-snug">
                        <a href="/${locale}/blog/${art.slug}" class="hover:text-[#1768C9]">${trans.title || art.slug}</a>
                      </h3>
                      <p class="text-xs text-slate-600 line-clamp-3 leading-relaxed mb-6">
                        ${trans.excerpt || ''}
                      </p>
                    </div>

                    <div class="border-t border-slate-100 pt-4 flex items-center justify-between text-xs text-slate-500">
                      <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-full bg-blue-100 text-[#1768C9] font-bold flex items-center justify-center text-[10px]">
                          ${art.author?.name ? art.author.name[0] : 'C'}
                        </div>
                        <span class="font-medium text-slate-700">${art.author?.name}</span>
                      </div>
                      <a href="/${locale}/blog/${art.slug}" class="font-bold text-[#1768C9] hover:underline">Read Guide &rarr;</a>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          </div>

          <!-- 9 UPCOMING TOPIC BRIEFS -->
          <div>
            <h2 class="text-xl font-black text-[#06366B] mb-2">Operational Library &amp; Executive Briefs</h2>
            <p class="text-xs text-slate-600 mb-6">Curated compliance memoranda prepared by our tax and finance research team.</p>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              ${briefs.map(b => `
                <div class="bento-card p-5 bg-white border border-slate-200">
                  <div class="flex items-center justify-between text-[10px] text-[#475569] font-mono mb-2">
                    <span class="text-[#1768C9] font-bold uppercase">${b.category}</span>
                    <span>${b.reading_time_minutes} min</span>
                  </div>
                  <h3 class="font-bold text-sm text-[#06366B] mb-2">${b.title}</h3>
                  <p class="text-xs text-slate-600 leading-relaxed line-clamp-2">${b.summary}</p>
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
      <article class="py-16 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#CBD5E1]">
        <div class="max-w-4xl mx-auto">
          <!-- BREADCRUMBS -->
          <nav class="flex items-center gap-2 text-xs text-slate-500 mb-8 font-medium">
            <a href="/${locale}" class="hover:text-[#1768C9]">Home</a>
            <span>/</span>
            <a href="/${locale}/blog" class="hover:text-[#1768C9]">Knowledge Hub</a>
            <span>/</span>
            <span class="text-slate-700 truncate">${article.category_name}</span>
          </nav>

          <!-- HEADER -->
          <header class="mb-12">
            <div class="flex flex-wrap items-center gap-3 text-xs mb-4">
              <span class="font-bold text-[#1768C9] bg-blue-50 px-3 py-1 rounded-full">${article.category_name}</span>
              <span class="text-slate-500 font-mono">${article.reading_time_minutes} min read</span>
              <span class="text-slate-400">&bull;</span>
              <span class="text-slate-500 font-mono">Updated: ${(article.last_updated || article.publication_date || '2026-10-18').substring(0, 10)}</span>
              <span class="text-slate-400">&bull;</span>
              <span class="text-slate-600 font-semibold"><span class="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono font-bold mr-1.5">ID</span> JURISDICTION: INDONESIA (ID)</span>
            </div>

            <h1 class="text-3xl sm:text-5xl font-black text-[#06366B] tracking-tight leading-tight mb-6">
              ${trans.title}
            </h1>

            <p class="text-base sm:text-lg text-slate-700 leading-relaxed mb-8 border-l-4 border-[#1768C9] pl-4 italic">
              ${trans.excerpt}
            </p>

            <div class="flex items-center justify-between py-4 border-y border-slate-100 text-xs text-slate-600">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-blue-100 text-[#1768C9] font-black flex items-center justify-center text-sm">
                  ${article.author?.name ? article.author.name[0] : 'C'}
                </div>
                <div>
                  <div class="font-bold text-[#06366B]">${article.author?.name}</div>
                  <div class="text-[11px] text-slate-500">${article.author?.title || article.author?.role || 'Senior Tax Advisor'}</div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-[11px] text-[#475569] font-medium">Statutory Citation:</div>
                <div class="font-mono font-bold text-[#06366B]">UU No. 7/2021 &bull; CoreTax PMK No. 81/2024</div>
              </div>
            </div>
          </header>

          <!-- BODY CONTENT -->
          <div class="prose prose-slate max-w-none text-slate-700 text-sm leading-relaxed space-y-6">
            ${(trans.content_markdown || trans.body_markdown || '').split('\n\n').map(p => {
              if (p.startsWith('# ')) return '';
              if (p.startsWith('## ')) return `<h2 class="text-2xl font-black text-[#06366B] pt-6 pb-2 border-b border-slate-100">${p.replace('## ', '')}</h2>`;
              if (p.startsWith('### ')) return `<h3 class="text-lg font-bold text-[#06366B] pt-4 pb-1">${p.replace('### ', '')}</h3>`;
              if (p.startsWith('- ')) {
                const items = p.split('\n').map(li => `<li>${li.replace(/^- /, '')}</li>`).join('');
                return `<ul class="list-disc pl-5 space-y-1">${items}</ul>`;
              }
              const formattedP = p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
              return `<p>${formattedP}</p>`;
            }).filter(Boolean).join('')}
          </div>

          <!-- AUTHOR BOX & CTA FOOTER -->
          <div class="mt-16 pt-8 border-t border-slate-200">
            <div class="bento-card p-6 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-6">
              <div>
                <h4 class="font-black text-sm text-[#06366B] mb-1">Automate Indonesian Tax &amp; Cash Flow Workflows</h4>
                <p class="text-xs text-slate-600">CFO AI automates PPh 21 TER, bank reconciliation, and CoreTax readiness for your company.</p>
              </div>
              <a href="https://app.cfo-ai.site/login" class="text-xs font-bold bg-[#1768C9] hover:bg-[#06366B] text-white px-6 py-3 rounded-xl shadow-sm whitespace-nowrap min-h-[44px] flex items-center justify-center">
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

  // --- DOCUMENT INTELLIGENCE PAGE (/:locale/document-intelligence) ---
  router.get('/:locale/document-intelligence', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/document-intelligence');

    const t = getT(locale);
    const seo = contentStore.getSeo();
    const title = seo.pages_meta?.doc?.title || `${t.doc_page.heading} — CFO AI`;
    const description = seo.pages_meta?.doc?.description || t.doc_page.subheading;
    const canonical = `https://cfo-ai.site/${locale}/document-intelligence`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/document-intelligence`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1] relative overflow-hidden">
        ${renderWatermark({ color: '#06366B', opacity: '0.04', size: 'w-96 h-96', className: 'absolute -right-20 -top-10 pointer-events-none select-none z-0' })}
        <div class="max-w-7xl mx-auto text-center relative z-10">
          <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${t.doc_page.badge}</span>
          <h1 class="text-3xl sm:text-5xl font-black text-[#06366B] mt-2 mb-4">${t.doc_page.heading}</h1>
          <p class="text-sm text-slate-700 max-w-2xl mx-auto mb-12">${t.doc_page.subheading}</p>

          <div class="browser-frame max-w-4xl mx-auto mb-16 text-left cursor-zoom-in" onclick="openLightbox('/assets/screens/Documents.png', 'Document Review Drawer', 'Multimodal OCR parsing of Faktur Pajak with DPP, PPN 11%, and QR verification.', 'AUTHENTIC V2 SCREEN')">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <span class="font-mono font-bold text-[#06366B]">Verification Workbench — Side-by-Side Review Drawer</span>
              <div class="flex items-center gap-2">
                <span class="text-emerald-800 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">100% Tax Line Match</span>
                <span class="text-[#1768C9] font-bold text-[11px] hover:underline">Click to Enlarge &rarr;</span>
              </div>
            </div>
            <div class="p-3 sm:p-5 bg-white">
              <img src="/assets/screens/Documents.png" alt="Document Review Drawer" class="w-full h-auto object-contain rounded" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-left max-w-5xl mx-auto mb-16">
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1768C9] block mb-2">FEATURE 01</span>
              <h3 class="font-black text-base text-[#06366B] mb-2">${t.doc_page.faktur_title}</h3>
              <p class="text-xs text-slate-600 leading-relaxed">${t.doc_page.faktur_desc}</p>
            </div>
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1768C9] block mb-2">FEATURE 02</span>
              <h3 class="font-black text-base text-[#06366B] mb-2">${t.doc_page.intake_title}</h3>
              <p class="text-xs text-slate-600 leading-relaxed">${t.doc_page.intake_desc}</p>
            </div>
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1768C9] block mb-2">FEATURE 03</span>
              <h3 class="font-black text-base text-[#06366B] mb-2">${t.doc_page.review_title}</h3>
              <p class="text-xs text-slate-600 leading-relaxed">${t.doc_page.review_desc}</p>
            </div>
          </div>

          <a href="https://app.cfo-ai.site/login" class="inline-block text-xs font-bold bg-[#1768C9] hover:bg-[#06366B] text-white px-8 py-3.5 rounded-xl shadow-md min-h-[44px]">
            ${t.hero.primary_cta} &rarr;
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

    const t = getT(locale);
    const seo = contentStore.getSeo();
    const title = seo.pages_meta?.compliance?.title || `${t.tax_page.heading} — CFO AI`;
    const description = seo.pages_meta?.compliance?.description || t.tax_page.subheading;
    const canonical = `https://cfo-ai.site/${locale}/compliance`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/compliance`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-ice-primary border-b border-[#CBD5E1] relative overflow-hidden">
        ${renderWatermark({ color: '#06366B', opacity: '0.04', size: 'w-96 h-96', className: 'absolute -right-20 -top-10 pointer-events-none select-none z-0' })}
        <div class="max-w-7xl mx-auto text-center relative z-10">
          <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${t.tax_page.badge}</span>
          <h1 class="text-3xl sm:text-5xl font-black text-[#06366B] mt-2 mb-4">${t.tax_page.heading}</h1>
          <p class="text-sm text-slate-700 max-w-2xl mx-auto mb-12">${t.tax_page.subheading}</p>

          <div class="browser-frame max-w-4xl mx-auto mb-16 text-left cursor-zoom-in" onclick="openLightbox('/assets/screens/AccountantTaxes.png', 'Indonesian Tax Radar', 'Calculation worksheets for PPh 21 TER, PPh 23 withholding, and PPN 11% reconciliation.', 'AUTHENTIC V2 SCREEN')">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <span class="font-mono font-bold text-[#06366B]">Statutory Tax Worksheets — PPh 21 TER, PPh 23, PPN 11%</span>
              <div class="flex items-center gap-2">
                <span class="text-emerald-800 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">Current Period Verified</span>
                <span class="text-[#1768C9] font-bold text-[11px] hover:underline">Click to Enlarge &rarr;</span>
              </div>
            </div>
            <div class="p-3 sm:p-5 bg-white">
              <img src="/assets/screens/AccountantTaxes.png" alt="Compliance Radar" class="w-full h-auto object-contain rounded" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-left max-w-5xl mx-auto mb-16">
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1768C9] block mb-2">TAX REGIME 01</span>
              <h3 class="font-black text-base text-[#06366B] mb-2">${t.tax_page.pph21_title}</h3>
              <p class="text-xs text-slate-600 leading-relaxed">${t.tax_page.pph21_desc}</p>
            </div>
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1768C9] block mb-2">TAX REGIME 02</span>
              <h3 class="font-black text-base text-[#06366B] mb-2">${t.tax_page.pph23_title}</h3>
              <p class="text-xs text-slate-600 leading-relaxed">${t.tax_page.pph23_desc}</p>
            </div>
            <div class="bento-card p-6">
              <span class="text-xs font-mono font-bold text-[#1768C9] block mb-2">TAX REGIME 03</span>
              <h3 class="font-black text-base text-[#06366B] mb-2">${t.tax_page.ppn_title}</h3>
              <p class="text-xs text-slate-600 leading-relaxed">${t.tax_page.ppn_desc}</p>
            </div>
          </div>

          <a href="https://app.cfo-ai.site/login" class="inline-block text-xs font-bold bg-[#1768C9] hover:bg-[#06366B] text-white px-8 py-3.5 rounded-xl shadow-md min-h-[44px]">
            ${t.hero.primary_cta} &rarr;
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

    const t = getT(locale);
    const ab = t.about_page;
    const title = `${ab.heading} — CFO AI`;
    const description = ab.subheading;
    const canonical = `https://cfo-ai.site/${locale}/about`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/about`
    }));

    const contentHtml = `
      <!-- 1. HERO — OUR MISSION -->
      <section class="pt-16 pb-12 text-center max-w-4xl mx-auto px-4 sm:px-6 relative overflow-hidden">
        ${renderWatermark({ color: '#06366B', opacity: '0.04', size: 'w-96 h-96', className: 'absolute -right-20 -top-10 pointer-events-none select-none z-0' })}
        <div class="relative z-10">
          <span class="px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-bold uppercase tracking-wider mb-4 inline-block">${ab.badge}</span>
          <h1 class="font-brand text-3xl sm:text-5xl text-[#021B36] tracking-tight mb-6">
            ${ab.heading}
          </h1>
          <p class="text-base sm:text-xl text-slate-600 leading-relaxed font-normal max-w-3xl mx-auto">
            ${ab.subheading}
          </p>
          <div class="mt-4 text-xs sm:text-sm text-slate-500 max-w-2xl mx-auto">
            ${ab.subheading_note}
          </div>
        </div>
      </section>

      <!-- 2. WHY WE BUILT CFO AI (The Problem: 3 Everyday Challenges) -->
      <section class="py-14 bg-white border-y border-slate-200">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <div class="text-center max-w-2xl mx-auto mb-10">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${ab.problem_badge || 'THE PROBLEM'}</span>
            <h2 class="font-brand text-2xl sm:text-3xl text-[#021B36] mt-1">${ab.problem_heading}</h2>
            <p class="text-xs sm:text-sm text-slate-600 mt-2">
              ${ab.problem_subheading}
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            ${(ab.problems || []).map((p, idx) => `
              <div class="bento-card p-6">
                <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg mb-4">
                  ${idx + 1}
                </div>
                <h3 class="font-bold text-sm text-[#021B36] mb-2">${p.title}</h3>
                <p class="text-sm text-slate-700 leading-relaxed">
                  ${p.desc}
                </p>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- 3. WHAT CFO AI HELPS YOU DO (6 Real Product Capabilities) -->
      <section class="py-16">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <div class="text-center max-w-2xl mx-auto mb-12">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${ab.capabilities_badge || 'PRODUCT CAPABILITIES'}</span>
            <h2 class="font-brand text-2xl sm:text-3xl text-[#021B36] mt-1">${ab.capabilities_heading}</h2>
            <p class="text-xs sm:text-sm text-slate-600 mt-2">
              ${ab.capabilities_subheading}
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${(ab.capabilities || []).map((c, idx) => {
              const bgColors = ['bg-emerald-50 text-emerald-600', 'bg-blue-50 text-blue-600', 'bg-purple-50 text-purple-600', 'bg-amber-50 text-amber-600', 'bg-cyan-50 text-cyan-600', 'bg-indigo-50 text-indigo-600'];
              const colorClass = bgColors[idx % bgColors.length];
              return `
                <div class="bento-card p-6 flex flex-col justify-between">
                  <div>
                    <div class="w-10 h-10 rounded-xl ${colorClass} flex items-center justify-center font-bold text-sm mb-4">
                      0${idx + 1}
                    </div>
                    <h3 class="font-bold text-sm text-[#021B36] mb-2">${c.title}</h3>
                    <p class="text-sm text-slate-700 leading-relaxed">${c.desc}</p>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>

      <!-- 4. BUILT FOR INDONESIAN PT & PT PMA WORKFLOWS -->
      <section class="py-14 bg-white border-y border-slate-200">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div class="lg:col-span-7 space-y-4">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${ab.local_badge || 'LOCAL FOCUS'}</span>
            <h2 class="font-brand text-2xl sm:text-3xl text-[#021B36]">${ab.local_heading}</h2>
            <p class="text-xs sm:text-sm text-slate-700 leading-relaxed">
              ${ab.local_p1}
            </p>
            <p class="text-xs sm:text-sm text-slate-700 leading-relaxed">
              ${ab.local_p2}
            </p>
            <div class="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-slate-700 leading-relaxed">
              ${ab.local_boundary}
            </div>
          </div>

          <div class="lg:col-span-5">
            <div class="browser-frame shadow-sm cursor-zoom-in" onclick="openLightbox('/assets/screens/CompanyProfile.png', 'Company Profile Configuration', 'PT & PT PMA corporate profile configuration with 16-digit NPWP in CFO AI', 'VERIFIED V2 UI')">
              <div class="bg-slate-100 px-3 py-1.5 border-b border-slate-200 text-xs font-mono text-slate-600 flex items-center justify-between">
                <span>CFO AI &bull; Company Profile</span>
                <span class="text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded text-[10px] font-bold">PT PMA READY</span>
              </div>
              <img src="/assets/screens/CompanyProfile.png" alt="CFO AI Company Profile Configuration" class="w-full h-auto object-cover">
            </div>
          </div>
        </div>
      </section>

      <!-- 5. SECURITY & PRIVACY SAFEGUARDS -->
      <section class="py-16">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <div class="text-center max-w-2xl mx-auto mb-10">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${ab.security_badge || 'TRUST & GOVERNANCE'}</span>
            <h2 class="font-brand text-2xl sm:text-3xl text-[#021B36] mt-1">${ab.security_heading}</h2>
            <p class="text-xs sm:text-sm text-slate-600 mt-2">
              ${ab.security_subheading}
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            ${(ab.security_items || []).map(s => `
              <div class="bento-card p-5">
                <div class="font-bold text-xs text-[#06366B] mb-2">${s.title}</div>
                <p class="text-sm text-slate-700 leading-relaxed">
                  ${s.desc}
                </p>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- 6. CONTACT INQUIRIES & SUPPORT (RESOLVES #contact ANCHOR) -->
      <section id="contact" class="py-14 bg-white border-y border-slate-200 scroll-mt-20">
        <div class="max-w-4xl mx-auto px-4 sm:px-6">
          <div class="text-center mb-8">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${ab.contact_badge || 'GET IN TOUCH'}</span>
            <h2 class="font-brand text-2xl sm:text-3xl text-[#021B36] mt-1">${ab.contact_heading}</h2>
            <p class="text-xs sm:text-sm text-slate-600 mt-2">
              ${ab.contact_subheading}
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="bento-card p-6 space-y-2">
              <div class="font-bold text-sm text-[#06366B]">${ab.contact_support_title}</div>
              <p class="text-sm text-slate-700 leading-relaxed">${ab.contact_support_desc}</p>
              <div class="text-xs font-bold text-blue-700 font-mono select-all">
                <a href="mailto:${ab.contact_support_email}">${ab.contact_support_email}</a>
              </div>
              <p class="text-[11px] text-slate-500">${ab.contact_support_time}</p>
            </div>

            <div class="bento-card p-6 space-y-2">
              <div class="font-bold text-sm text-[#06366B]">${ab.contact_sales_title}</div>
              <p class="text-sm text-slate-700 leading-relaxed">${ab.contact_sales_desc}</p>
              <div class="text-xs font-bold text-blue-700 font-mono select-all">
                <a href="mailto:${ab.contact_sales_email}">${ab.contact_sales_email}</a>
              </div>
              <p class="text-[11px] text-slate-500">${ab.contact_sales_time}</p>
            </div>

            <div class="bento-card p-6 space-y-2">
              <div class="font-bold text-sm text-[#06366B]">${ab.contact_admin_title}</div>
              <p class="text-sm text-slate-700 leading-relaxed">${ab.contact_admin_desc}</p>
              <div class="text-xs font-bold text-blue-700 font-mono select-all">
                <a href="mailto:${ab.contact_admin_email}">${ab.contact_admin_email}</a>
              </div>
              <p class="text-[11px] text-slate-500">${ab.contact_admin_time}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 7. FINAL CTA -->
      <section class="py-16 text-center max-w-4xl mx-auto px-4 sm:px-6">
        <h2 class="font-brand text-2xl sm:text-3xl text-[#021B36] mb-3">Ready for Financial Clarity?</h2>
        <p class="text-xs sm:text-sm text-slate-600 mb-8 max-w-xl mx-auto">
          Start your 7-day free trial today. Organize your cash flow, review transactions, and streamline document management in one unified workspace.
        </p>
        <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a href="https://app.cfo-ai.site/login" class="w-full sm:w-auto px-6 py-3 bg-[#1768C9] hover:bg-[#06366B] text-white font-bold text-xs sm:text-sm rounded-xl shadow transition-colors min-h-[44px] flex items-center justify-center">
            ${t.nav.trial_cta}
          </a>
          <a href="/${locale}/platform" class="w-full sm:w-auto px-6 py-3 bg-white border border-slate-300 hover:border-blue-400 text-[#06366B] font-bold text-xs sm:text-sm rounded-xl transition-colors min-h-[44px] flex items-center justify-center">
            ${t.nav.platform}
          </a>
          <a href="/${locale}/help" class="w-full sm:w-auto px-6 py-3 text-slate-600 hover:text-blue-600 font-semibold text-xs sm:text-sm transition-colors">
            ${t.footer.link_help_center || 'Browse Help Center'} &rarr;
          </a>
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

  // --- HELP CENTER HUB (/:locale/help) ---
  router.get('/:locale/help', (req, res) => {
    const locale = req.params.locale;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect('/id/help');

    const t = getT(locale);
    const categories = contentStore.getHelpCategories ? contentStore.getHelpCategories() : [];
    const allArticles = contentStore.getHelpArticles ? contentStore.getHelpArticles() : [];
    const publishedArticles = allArticles.filter(a => a.review_status === 'published');

    const localizedArticles = publishedArticles.map(a => {
      const trans = (a.translations && (a.translations[locale] || a.translations['en'])) || {};
      const cat = categories.find(c => c.id === a.category_id);
      const catName = (cat && cat.translations && (cat.translations[locale]?.name || cat.translations['en']?.name)) || a.category_id;
      return {
        id: a.id,
        slug: a.slug,
        title: trans.title || a.slug,
        desc: trans.summary || '',
        category: catName,
        categoryId: a.category_id,
        featured: a.featured,
        readTime: a.read_time,
        keywords: trans.keywords || '',
        url: `/${locale}/help/${a.slug}`
      };
    });

    const featuredGuides = localizedArticles.filter(a => a.featured).slice(0, 3);

    const title = locale === 'id' ? 'Pusat Bantuan & Panduan Pengguna — CFO AI' :
                  locale === 'ru' ? 'База знаний и инструкции пользователя — CFO AI' :
                  'Help Center & User Guides — CFO AI';
    const description = locale === 'id' ? 'Cari panduan langkah demi langkah, instruksi impor bank, verifikasi dokumen OCR, dan pengaturan ruang kerja CFO AI.' :
                        locale === 'ru' ? 'Поиск пошаговых инструкций, загрузка банковских выписок, проверка чеков в OCR и настройка компании в CFO AI.' :
                        'Search step-by-step guides, documentation, and tutorials for CFO AI. Learn how to import bank statements, scan receipts, configure PT/PT PMA profiles, and review cash flow.';
    const canonical = `https://cfo-ai.site/${locale}/help`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/help`
    }));

    const contentHtml = `
      <!-- HERO SEARCH SECTION -->
      <section class="pt-16 pb-12 px-4 sm:px-6 text-center max-w-4xl mx-auto relative overflow-hidden">
        ${renderWatermark({ color: '#06366B', opacity: '0.04', size: 'w-96 h-96', className: 'absolute -right-20 -top-10 pointer-events-none select-none z-0' })}
        <div class="relative z-10">
          <span class="px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-bold uppercase tracking-wider mb-3 inline-block">
            ${locale === 'id' ? 'DOKUMENTASI CFO AI' : locale === 'ru' ? 'ДОКУМЕНТАЦИЯ CFO AI' : 'CFO AI DOCUMENTATION'}
          </span>
          <h1 class="font-brand text-3xl sm:text-5xl text-[#021B36] tracking-tight mb-4">
            ${locale === 'id' ? 'Bagaimana Kami Dapat Membantu Anda?' : locale === 'ru' ? 'Чем мы можем вам помочь?' : 'How Can We Help You Today?'}
          </h1>
          <p class="text-sm sm:text-base text-slate-600 mb-8 max-w-2xl mx-auto">
            ${locale === 'id' ? 'Cari panduan langkah demi langkah, petunjuk rekonsiliasi bank, alur verifikasi dokumen, dan pengaturan sistem.' :
              locale === 'ru' ? 'Ищите пошаговые инструкции по банковской сверке, загрузке чеков, расчету зарплат и настройкам компании.' :
              'Search step-by-step guides, bank import instructions, document review workflows, and workspace settings.'}
          </p>

          <!-- LIVE SEARCH INPUT -->
          <div class="relative max-w-2xl mx-auto">
            <div class="relative">
              <svg class="w-5 h-5 text-slate-400 absolute left-4 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              <input 
                id="help-search-input" 
                type="text" 
                oninput="handleSearch(this.value)" 
                placeholder="${locale === 'id' ? 'Cari kata kunci, misal: bank import, NPWP, OCR, payroll...' : locale === 'ru' ? 'Поиск по ключевым словам: bank import, NPWP, OCR, payroll...' : 'Search by keyword, e.g. bank import, NPWP, OCR, payroll...'}" 
                class="w-full pl-12 pr-10 py-3.5 rounded-2xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#318FF4] bg-white shadow-sm"
                autocomplete="off"
              >
              <button id="search-clear-btn" onclick="clearSearch()" class="hidden absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
            </div>

            <!-- POPULAR SEARCH TAGS -->
            <div class="flex flex-wrap items-center justify-center gap-2 mt-3 text-xs text-slate-500">
              <span>${locale === 'id' ? 'Populer:' : locale === 'ru' ? 'Популярное:' : 'Popular:'}</span>
              <button onclick="applySearchTag('bank import')" class="px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-blue-400 text-slate-700">Bank Import</button>
              <button onclick="applySearchTag('NPWP')" class="px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-blue-400 text-slate-700">16-Digit NPWP</button>
              <button onclick="applySearchTag('OCR')" class="px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-blue-400 text-slate-700">Receipt OCR</button>
              <button onclick="applySearchTag('Accountant')" class="px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-blue-400 text-slate-700">Accountant Package</button>
              <button onclick="applySearchTag('Payroll')" class="px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-blue-400 text-slate-700">Payroll Runs</button>
            </div>
          </div>
        </div>
      </section>

      <!-- SEARCH RESULTS CONTAINER -->
      <section id="search-results-section" class="hidden py-8 max-w-4xl mx-auto px-4 sm:px-6 w-full">
        <div class="flex items-center justify-between mb-4 border-b border-slate-200 pb-2">
          <h2 class="font-brand text-lg text-[#021B36]" id="results-count-heading">Search Results</h2>
          <button onclick="clearSearch()" class="text-xs font-bold text-blue-600 hover:underline">${locale === 'id' ? 'Lihat Semua Kategori' : locale === 'ru' ? 'Показать все категории' : 'View All Categories'}</button>
        </div>
        <div id="search-results-list" class="space-y-3"></div>
      </section>

      <!-- MAIN HELP CENTER CONTENT -->
      <div id="main-categories-section" class="py-8 max-w-6xl mx-auto px-4 sm:px-6 flex-1 space-y-12">
        <!-- POPULAR GUIDES -->
        <div>
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-brand text-xl text-[#021B36]">${locale === 'id' ? 'Panduan Populer & Memulai' : locale === 'ru' ? 'Популярные инструкции' : 'Getting Started & Popular Guides'}</h2>
            <span class="text-xs text-slate-500">${locale === 'id' ? 'Pengaturan inti operasional' : locale === 'ru' ? 'Базовая настройка' : 'Core operational setup'}</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            ${featuredGuides.map(g => `
              <a href="${g.url}" class="bento-card p-5 hover:border-blue-400 block group transition-all">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[10px] font-bold text-blue-600 uppercase tracking-wide">${g.category}</span>
                  <span class="text-[10px] text-slate-400 font-mono">${g.readTime}</span>
                </div>
                <h3 class="font-bold text-sm text-[#021B36] group-hover:text-blue-600 mt-1 mb-1 transition-colors leading-snug">
                  ${g.title}
                </h3>
                <p class="text-xs text-slate-500 leading-relaxed mb-3 line-clamp-2">
                  ${g.desc}
                </p>
                <span class="text-xs font-semibold text-blue-600 flex items-center gap-1">${locale === 'id' ? 'Baca Panduan' : locale === 'ru' ? 'Читать' : 'Read Guide'} &rarr;</span>
              </a>
            `).join('')}
          </div>
        </div>

        <!-- 8 CATEGORIES GRID -->
        <div>
          <div class="mb-6">
            <h2 class="font-brand text-2xl text-[#021B36]">${locale === 'id' ? 'Jelajahi Berdasarkan Kategori' : locale === 'ru' ? 'Категории базы знаний' : 'Browse by Category'}</h2>
            <p class="text-xs sm:text-sm text-slate-600 mt-1">${locale === 'id' ? 'Seluruh dokumentasi terorganisir rapi menurut domain operasional.' : locale === 'ru' ? 'Все инструкции сгруппированы по функциональным разделам.' : 'Explore all documentation organized across operational domains.'}</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            ${categories.sort((a, b) => (a.order || 0) - (b.order || 0)).map((cat, idx) => {
              const trans = (cat.translations && (cat.translations[locale] || cat.translations['en'])) || {};
              const catArticles = localizedArticles.filter(a => a.categoryId === cat.id);
              return `
                <div class="bento-card p-5 space-y-3">
                  <div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm font-mono">
                    0${idx + 1}
                  </div>
                  <div>
                    <h3 class="font-bold text-sm text-[#021B36]">${trans.name || cat.id}</h3>
                    <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                      ${trans.description || ''}
                    </p>
                  </div>
                  <ul class="text-xs space-y-1.5 text-blue-700 font-medium pt-2 border-t border-slate-100">
                    ${catArticles.map(a => `
                      <li><a href="${a.url}" class="hover:underline block truncate">&bull; ${a.title}</a></li>
                    `).join('')}
                  </ul>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- STILL NEED HELP SECTION -->
        <div class="bento-card p-8 bg-gradient-to-r from-white to-blue-50/50 border border-slate-200">
          <div class="max-w-2xl">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">${locale === 'id' ? 'BUTUH BANTUAN LAIN?' : locale === 'ru' ? 'НУЖНА ПОМОЩЬ?' : 'STILL NEED HELP?'}</span>
            <h3 class="font-brand text-xl text-[#021B36] mt-1 mb-2">
              ${locale === 'id' ? 'Tidak Menemukan yang Anda Cari?' : locale === 'ru' ? 'Не нашли ответ на свой вопрос?' : "Can't Find What You're Looking For?"}
            </h3>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed mb-4">
              ${locale === 'id' ? 'Tim spesialis dukungan teknis dan operasional kami siap membantu Anda.' : locale === 'ru' ? 'Наша служба поддержки готова ответить на ваши вопросы и помочь с настройкой.' : 'Our customer support and engineering teams are available to assist with onboarding and workspace questions.'}
            </p>
            <div class="flex flex-wrap items-center gap-4 text-xs">
              <a href="mailto:support@cfo-ai.site" class="inline-flex items-center gap-2 font-bold bg-[#1768C9] hover:bg-[#06366B] text-white px-4 py-2.5 rounded-xl transition">
                <span>support@cfo-ai.site</span>
              </a>
              <span class="text-slate-400">&bull;</span>
              <a href="/${locale}/about#contact" class="font-bold text-[#1768C9] hover:underline">
                ${locale === 'id' ? 'Lihat Semua Kontak Dukungan' : locale === 'ru' ? 'Все контакты службы поддержки' : 'View Full Contact Inquiries'} &rarr;
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- CLIENT SCRIPT FOR LIVE SEARCH -->
      <script>
        const ARTICLES = ${JSON.stringify(localizedArticles)};

        function handleSearch(query) {
          const q = (query || '').trim().toLowerCase();
          const clearBtn = document.getElementById('search-clear-btn');
          const resultsSection = document.getElementById('search-results-section');
          const categoriesSection = document.getElementById('main-categories-section');
          const list = document.getElementById('search-results-list');
          const heading = document.getElementById('results-count-heading');

          if (!q) {
            if (clearBtn) clearBtn.classList.add('hidden');
            if (resultsSection) resultsSection.classList.add('hidden');
            if (categoriesSection) categoriesSection.classList.remove('hidden');
            return;
          }

          if (clearBtn) clearBtn.classList.remove('hidden');
          if (resultsSection) resultsSection.classList.remove('hidden');
          if (categoriesSection) categoriesSection.classList.add('hidden');

          const matches = ARTICLES.filter(function(a) {
            return a.title.toLowerCase().indexOf(q) !== -1 ||
                   a.desc.toLowerCase().indexOf(q) !== -1 ||
                   a.category.toLowerCase().indexOf(q) !== -1 ||
                   a.keywords.toLowerCase().indexOf(q) !== -1;
          });

          if (heading) heading.innerText = 'Search Results for "' + query + '" (' + matches.length + ')';

          if (matches.length === 0) {
            if (list) list.innerHTML = '<div class="bento-card p-8 text-center space-y-2"><div class="text-xl font-bold text-slate-400">?</div><h4 class="font-bold text-sm text-[#021B36]">No guides matched your query</h4><p class="text-xs text-slate-500">Try searching for broader keywords like bank, invoice, NPWP, or payroll.</p></div>';
          } else {
            if (list) list.innerHTML = matches.map(function(m) {
              return '<a href="' + m.url + '" class="bento-card p-4 block hover:border-blue-400 transition flex items-start justify-between gap-4"><div><div class="text-[10px] font-bold text-blue-600 uppercase mb-1">' + m.category + '</div><h4 class="font-bold text-sm text-[#021B36] mb-1">' + m.title + '</h4><p class="text-xs text-slate-600 line-clamp-2">' + m.desc + '</p></div><span class="text-xs font-bold text-blue-600 shrink-0">&rarr;</span></a>';
            }).join('');
          }
        }

        function applySearchTag(tag) {
          const input = document.getElementById('help-search-input');
          if (input) {
            input.value = tag;
            handleSearch(tag);
          }
        }

        function clearSearch() {
          const input = document.getElementById('help-search-input');
          if (input) input.value = '';
          handleSearch('');
        }
      </script>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'help',
      content: contentHtml,
      hreflangs
    }));
  });

  // --- HELP ARTICLE VIEW (/:locale/help/:slug) ---
  router.get('/:locale/help/:slug', (req, res) => {
    const { locale, slug } = req.params;
    const locales = contentStore.getLocales();
    if (!locales.some(l => l.code === locale)) return res.redirect(`/id/help/${slug}`);

    const t = getT(locale);
    const article = contentStore.getHelpArticle ? contentStore.getHelpArticle(slug) : null;
    if (!article || article.review_status !== 'published') {
      return res.status(404).send(renderLayout({
        locale,
        title: 'Guide Not Found — CFO AI Help Center',
        description: 'The requested guide could not be found.',
        canonical: `https://cfo-ai.site/${locale}/help`,
        activeTab: 'help',
        content: `
          <div class="max-w-2xl mx-auto py-24 px-4 text-center">
            <h1 class="text-3xl font-black text-[#06366B] mb-3">Guide Not Found</h1>
            <p class="text-sm text-slate-600 mb-6">The guide you are looking for may have been moved or updated.</p>
            <a href="/${locale}/help" class="inline-block bg-[#1768C9] text-white px-6 py-2.5 rounded-xl font-bold text-xs">Return to Help Center &rarr;</a>
          </div>
        `
      }));
    }

    const categories = contentStore.getHelpCategories ? contentStore.getHelpCategories() : [];
    const allArticles = contentStore.getHelpArticles ? contentStore.getHelpArticles() : [];
    
    const cat = categories.find(c => c.id === article.category_id);
    const catName = (cat && cat.translations && (cat.translations[locale]?.name || cat.translations['en']?.name)) || article.category_id;
    
    const trans = (article.translations && (article.translations[locale] || article.translations['en'])) || {};
    const relatedArticles = allArticles
      .filter(a => a.category_id === article.category_id && a.id !== article.id && a.review_status === 'published')
      .slice(0, 4);

    const title = `${trans.title || article.slug} — CFO AI Help Center`;
    const description = trans.summary || '';
    const canonical = `https://cfo-ai.site/${locale}/help/${article.slug}`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/help/${article.slug}`
    }));

    const contentHtml = `
      <!-- BREADCRUMB -->
      <div class="bg-white border-b border-slate-200 py-3">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-xs font-semibold text-slate-500 flex items-center gap-2">
          <a href="/${locale}/help" class="hover:text-blue-600">Help Center</a>
          <span>/</span>
          <a href="/${locale}/help" class="hover:text-blue-600">${catName}</a>
          <span>/</span>
          <span class="text-[#06366B] truncate">${trans.title}</span>
        </div>
      </div>

      <!-- MAIN ARTICLE CONTAINER -->
      <main class="py-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          
          <!-- Article Body (8 Cols) -->
          <article class="lg:col-span-8 bento-card p-6 sm:p-10 space-y-8 bg-white">
            <!-- Header -->
            <div class="border-b border-slate-100 pb-6">
              <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="px-2.5 py-0.5 rounded-full bg-blue-100 text-[#06366B] text-xs font-bold uppercase tracking-wider">${catName}</span>
                <span class="text-slate-400 text-xs">&bull;</span>
                <span class="text-xs text-slate-500">${article.read_time || '5 min read'}</span>
                <span class="text-slate-400 text-xs">&bull;</span>
                <span class="text-xs text-slate-500">Verified for CFO OS V2</span>
              </div>
            <!-- Accounting Caveats & Disclaimers -->
            ${article.slug === 'cashflow-radar' ? `
              <div class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-950 leading-relaxed space-y-1">
                <div class="font-bold flex items-center gap-1.5 text-amber-900">
                  <svg class="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                  <span>${locale === 'id' ? 'Catatan Keuangan Penting:' : locale === 'ru' ? 'Важное финансовое примечание:' : 'Important Financial Notice:'}</span>
                </div>
                <p class="text-xs sm:text-sm text-amber-900 leading-relaxed">${locale === 'id' ? 'Proyeksi runway dan prakiraan Cash Radar adalah estimasi analitis yang diturunkan dari histori pengeluaran (burn rate) tercatat dan jadwal kewajiban mendatang. Proyeksi ini bukan jaminan masa depan dan bukan laporan audit keuangan resmi.' : locale === 'ru' ? 'Прогнозы Cash Radar и оценка взлетно-посадочной полосы (runway) представляют собой расчетные аналитические оценки на основе фактического темпа расходов (burn rate) и запланированных обязательств. Они не являются гарантированными прогнозами или официальной аудиторской отчетностью.' : 'Cash flow runway projections and radar forecasts are analytical estimates derived from recorded historical burn rates and scheduled obligations. They do not constitute guaranteed financial projections or statutory audit reports.'}</p>
              </div>
            ` : ''}

            ${article.slug === 'document-upload' ? `
              <div class="p-4 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-950 leading-relaxed space-y-1">
                <div class="font-bold flex items-center gap-1.5 text-blue-900">
                  <svg class="w-4 h-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <span>${locale === 'id' ? 'Prinsip Pembukuan:' : locale === 'ru' ? 'Принцип бухгалтерского учета:' : 'Accounting Safeguard:'}</span>
                </div>
                <p class="text-xs sm:text-sm text-blue-900 leading-relaxed">${locale === 'id' ? 'Ekstraksi dokumen otomatis membuat draf usulan transaksi yang memerlukan verifikasi pengguna, bukan jurnal akuntansi otomatis.' : locale === 'ru' ? 'Автоматическое распознавание документов создает черновики для проверки пользователем, а не автоматические бухгалтерские проводки.' : 'Document capture creates draft proposals requiring user verification, not automatic journal entries.'}</p>
              </div>
            ` : ''}

            ${article.slug === 'accountant-package' ? `
              <div class="p-4 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-950 leading-relaxed space-y-1">
                <div class="font-bold flex items-center gap-1.5 text-blue-900">
                  <svg class="w-4 h-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <span>${locale === 'id' ? 'Kepatuhan Pajak Indonesia:' : locale === 'ru' ? 'Налоговый комплаенс:' : 'Tax Compliance Notice:'}</span>
                </div>
                <p class="text-xs sm:text-sm text-blue-900 leading-relaxed">${locale === 'id' ? 'Ringkasan pajak dan ekspor laporan disiapkan untuk telaah dan persiapan kepatuhan, bukan pelaporan SPT langsung otomatis ke CoreTax DJP.' : locale === 'ru' ? 'Налоговые сводки и отчетные пакеты формируются для проверки и подготовки отчетности, а не для автоматической подачи в систему CoreTax DJP.' : 'Tax summaries and export packages are prepared for review and compliance preparation, not automated CoreTax filing.'}</p>
              </div>
            ` : ''}

              <h1 class="font-brand text-2xl sm:text-4xl text-[#021B36] tracking-tight leading-tight mb-3">
                ${trans.title}
              </h1>
              <p class="text-sm text-slate-600 leading-relaxed">
                ${trans.summary}
              </p>
            </div>

            <!-- Section 1: Accomplish & Prerequisites -->
            <section id="what-you-accomplish" class="space-y-3 scroll-mt-24">
              <h2 class="text-lg font-bold text-[#06366B]">${locale === 'id' ? 'Tujuan & Prasyarat' : locale === 'ru' ? 'Цель и предварительные требования' : 'What You Will Accomplish'}</h2>
              <p class="text-sm text-slate-700 leading-relaxed">
                ${trans.what_you_accomplish}
              </p>
              ${trans.prerequisites && trans.prerequisites.length > 0 ? `
                <div class="p-4 rounded-xl bg-blue-50/80 border border-blue-200 text-xs text-blue-900 leading-relaxed space-y-1">
                  <strong>${locale === 'id' ? 'Prasyarat:' : locale === 'ru' ? 'Необходимые условия:' : 'Prerequisites:'}</strong>
                  <ul class="list-disc list-inside space-y-1 text-slate-700 mt-1">
                    ${trans.prerequisites.map(p => `<li>${p}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}
            </section>

            <!-- Section 2: Step-by-Step Instructions -->
            <section id="step-by-step" class="space-y-6 scroll-mt-24">
              <h2 class="text-lg font-bold text-[#06366B]">${locale === 'id' ? 'Langkah demi Langkah' : locale === 'ru' ? 'Пошаговые действия' : 'Step-by-Step Instructions'}</h2>
              ${(trans.steps || []).map((st, idx) => `
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 font-mono">${st.step || idx + 1}</span>
                    <h3 class="font-bold text-sm text-[#021B36]">${st.title}</h3>
                  </div>
                  <p class="text-sm text-slate-700 pl-8 leading-relaxed">
                    ${st.instruction}
                  </p>
                </div>
              `).join('')}

              <!-- UI Screenshot -->
              ${article.screenshot ? `
                <div class="browser-frame my-6 cursor-zoom-in" onclick="openLightbox('${article.screenshot}', '${(trans.title || '').replace(/'/g, "\\'")}', 'Authentic CFO OS V2 screen capture', 'VERIFIED V2 UI')">
                  <div class="bg-slate-100 px-3 py-1.5 border-b border-slate-200 text-xs font-mono text-slate-600 flex items-center justify-between">
                    <span>app.cfo-ai.site / ${article.slug}</span>
                    <span class="text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded text-[10px] font-bold">VERIFIED V2 UI</span>
                  </div>
                  <img src="${article.screenshot}" alt="${trans.title}" class="w-full h-auto object-cover">
                </div>
              ` : ''}
            </section>

            <!-- Section 3: Expected Result -->
            <section id="expected-result" class="space-y-3 scroll-mt-24">
              <h2 class="text-lg font-bold text-[#06366B]">${locale === 'id' ? 'Hasil yang Diharapkan' : locale === 'ru' ? 'Ожидаемый результат' : 'Expected Result'}</h2>
              <div class="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs sm:text-sm text-emerald-950 leading-relaxed">
                ${trans.expected_result}
              </div>
            </section>

            <!-- Section 4: Troubleshooting -->
            ${trans.troubleshooting && trans.troubleshooting.length > 0 ? `
              <section id="troubleshooting" class="space-y-3 scroll-mt-24">
                <h2 class="text-lg font-bold text-[#06366B]">${locale === 'id' ? 'Kendala Umum & Solusi' : locale === 'ru' ? 'Частые ошибки и решение' : 'Common Errors & Troubleshooting'}</h2>
                <div class="space-y-3 text-xs sm:text-sm text-slate-700">
                  ${trans.troubleshooting.map(tb => `
                    <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <strong class="text-slate-900 block mb-1">&bull; ${tb.error}</strong>
                      <p class="text-sm text-slate-700 leading-relaxed">${tb.solution}</p>
                    </div>
                  `).join('')}
                </div>
              </section>
            ` : ''}

            <!-- Feedback Widget -->
            <div class="border-t border-slate-100 pt-6 mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl">
              <span class="text-xs font-bold text-[#06366B]">${locale === 'id' ? 'Apakah panduan ini membantu Anda?' : locale === 'ru' ? 'Была ли эта инструкция полезна?' : 'Was this guide helpful?'}</span>
              <div class="flex items-center gap-2" id="fb-container">
                <button onclick="handleFeedback(true)" id="fb-yes" class="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:text-emerald-700 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors">
                  <span>👍</span>
                  <span>${locale === 'id' ? 'Ya' : locale === 'ru' ? 'Да' : 'Yes'}</span>
                </button>
                <button onclick="handleFeedback(false)" id="fb-no" class="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-700 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors">
                  <span>👎</span>
                  <span>${locale === 'id' ? 'Tidak' : locale === 'ru' ? 'Нет' : 'No'}</span>
                </button>
              </div>
            </div>
          </article>

          <!-- Sidebar (4 Cols) -->
          <aside class="lg:col-span-4 space-y-6 lg:sticky lg:top-24">
            <!-- Table of Contents -->
            <div class="bento-card p-6">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">${locale === 'id' ? 'Di Halaman Ini' : locale === 'ru' ? 'Содержание' : 'On This Page'}</h3>
              <nav class="space-y-2 text-xs font-semibold text-slate-600">
                <a href="#what-you-accomplish" class="block hover:text-[#1768C9] transition-colors">${locale === 'id' ? 'Tujuan & Prasyarat' : locale === 'ru' ? 'Цель и условия' : 'What You Will Accomplish'}</a>
                <a href="#step-by-step" class="block hover:text-[#1768C9] transition-colors">${locale === 'id' ? 'Langkah Instruksi' : locale === 'ru' ? 'Инструкции' : 'Step-by-Step Instructions'}</a>
                <a href="#expected-result" class="block hover:text-[#1768C9] transition-colors">${locale === 'id' ? 'Hasil yang Diharapkan' : locale === 'ru' ? 'Результат' : 'Expected Result'}</a>
                ${trans.troubleshooting && trans.troubleshooting.length > 0 ? `
                  <a href="#troubleshooting" class="block hover:text-[#1768C9] transition-colors">${locale === 'id' ? 'Kendala & Solusi' : locale === 'ru' ? 'Ошибки и решение' : 'Common Errors & Troubleshooting'}</a>
                ` : ''}
              </nav>
            </div>

            <!-- Related Guides -->
            ${relatedArticles.length > 0 ? `
              <div class="bento-card p-6 space-y-3">
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">${locale === 'id' ? 'Panduan Terkait' : locale === 'ru' ? 'В этом разделе' : 'In This Category'}</h3>
                <ul class="text-xs space-y-2">
                  ${relatedArticles.map(ra => {
                    const rTrans = (ra.translations && (ra.translations[locale] || ra.translations['en'])) || {};
                    return `<li><a href="/${locale}/help/${ra.slug}" class="hover:text-blue-600 font-medium block leading-snug">&bull; ${rTrans.title || ra.slug}</a></li>`;
                  }).join('')}
                </ul>
              </div>
            ` : ''}

            <!-- Support Box -->
            <div class="bento-card p-6 space-y-2 bg-gradient-to-br from-white to-blue-50/40">
              <h4 class="font-bold text-sm text-[#06366B]">${locale === 'id' ? 'Butuh Bantuan Langsung?' : locale === 'ru' ? 'Нужна помощь специалистов?' : 'Need Direct Assistance?'}</h4>
              <p class="text-xs text-slate-600 leading-relaxed">${locale === 'id' ? 'Hubungi meja dukungan kami untuk bantuan konfigurasi ruang kerja.' : locale === 'ru' ? 'Напишите в службу поддержки, если возникли вопросы по настройке.' : 'Our technical support team can answer setup and configuration inquiries.'}</p>
              <div class="pt-1">
                <a href="mailto:support@cfo-ai.site" class="text-xs font-bold text-blue-700 font-mono hover:underline">support@cfo-ai.site</a>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <script>
        function handleFeedback(isPositive) {
          const container = document.getElementById('fb-container');
          if (container) {
            container.innerHTML = '<span class="text-xs font-bold text-emerald-700">✓ Thank you for your feedback!</span>';
          }
        }
      </script>
    `;

    res.send(renderLayout({
      locale,
      title,
      description,
      canonical,
      activeTab: 'help',
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
    const description = 'Official privacy policy for CFO AI Indonesia under Law No. 27/2022 (UU PDP) with strict zero-data-sharing guarantee.';
    const canonical = `https://cfo-ai.site/${locale}/privacy`;

    const hreflangs = locales.filter(l => l.status === 'published').map(l => ({
      lang: l.code,
      url: `https://cfo-ai.site/${l.code}/privacy`
    }));

    const contentHtml = `
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#CBD5E1]">
        <div class="max-w-4xl mx-auto text-left text-xs leading-relaxed text-slate-700 space-y-6">
          <div class="border-b border-slate-200 pb-6 mb-8">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">LEGAL &bull; UU PDP COMPLIANCE</span>
            <h1 class="text-3xl font-black text-[#06366B] mt-2">Privacy Policy &amp; Data Protection</h1>
            <p class="text-slate-500 mt-1">Effective Date: October 2026 &bull; Indonesian Law No. 27/2022 (UU PDP)</p>
          </div>

          <h2 class="text-lg font-black text-[#06366B] pt-2">1. Commitment to Data Sovereignty and Privacy</h2>
          <p>
            CFO AI Indonesia ("we", "our", or "the Platform") respects the privacy and confidentiality of your company's corporate, accounting, and personal data. This Privacy Policy outlines our procedures regarding the collection, processing, encryption, and protection of data processed via https://cfo-ai.site and https://app.cfo-ai.site.
          </p>

          <h2 class="text-lg font-black text-[#06366B] pt-2">2. Zero Data-Sharing Guarantee for AI Models</h2>
          <p class="p-4 rounded-xl bg-blue-50 border border-blue-200 text-[#06366B] font-semibold">
            Strict Zero-Sharing Guarantee: Your financial records, general ledger balances, invoices, vendor contacts, and employee payroll data are never sold, rented, monetized, or shared with third parties. Furthermore, customer financial records are NEVER used to train, retrain, or fine-tune public foundation AI models.
          </p>

          <h2 class="text-lg font-black text-[#06366B] pt-2">3. Data Collection and Processing Purposes</h2>
          <p>We process information exclusively for the provision of operational financial services, including:</p>
          <ul class="list-disc pl-5 space-y-1">
            <li>Ingestion and optical character recognition (OCR) of commercial invoices and receipts.</li>
            <li>Reconciliation of uploaded bank statement rows (BCA, Mandiri, Permata, BRI).</li>
            <li>Computation of statutory withholding and value-added tax estimates (PPh 21 TER, PPh 23, PPN 11%).</li>
            <li>Generation of the downloadable Accountant Readiness Package (ZIP).</li>
          </ul>

          <h2 class="text-lg font-black text-[#06366B] pt-2">4. Security Architecture and Tenant Isolation</h2>
          <p>
            All data in transit is encrypted using Transport Layer Security (TLS 1.3). Data at rest is encrypted using Advanced Encryption Standard (AES-256). Each commercial tenant operates with isolated relational schema partitions to prevent cross-customer data leakage.
          </p>

          <h2 class="text-lg font-black text-[#06366B] pt-2">5. Data Retention and Deletion Rights</h2>
          <p>
            In accordance with Indonesian Law No. 27/2022 (UU PDP), business owners retain the right to request full export or permanent cryptographic deletion of their company tenant data at any time upon cancellation of subscription.
          </p>

          <div class="border-t border-slate-200 pt-6 mt-8">
            <p class="text-slate-500">For privacy or data protection inquiries, contact our Data Protection Officer at <span class="font-mono text-[#1768C9]">privacy@cfo-ai.site</span>.</p>
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
      <section class="py-16 px-4 sm:px-6 lg:px-8 bg-white border-b border-[#CBD5E1]">
        <div class="max-w-4xl mx-auto text-left text-xs leading-relaxed text-slate-700 space-y-6">
          <div class="border-b border-slate-200 pb-6 mb-8">
            <span class="text-xs font-bold text-[#1768C9] uppercase tracking-wider">LEGAL &bull; USER AGREEMENT</span>
            <h1 class="text-3xl font-black text-[#06366B] mt-2">Terms of Service</h1>
            <p class="text-slate-500 mt-1">Effective Date: October 2026 &bull; Indonesian Jurisdiction</p>
          </div>

          <h2 class="text-lg font-black text-[#06366B] pt-2">1. Acceptance of Terms</h2>
          <p>
            By accessing or using CFO AI (https://cfo-ai.site and https://app.cfo-ai.site), you agree to be bound by these Terms of Service. If you are entering into this agreement on behalf of a company or legal entity (e.g. PT or PT PMA), you represent that you have the authority to bind such entity.
          </p>

          <h2 class="text-lg font-black text-[#06366B] pt-2">2. Description of Operational Service</h2>
          <p>
            CFO AI provides an automated financial management operating system featuring document OCR, cash flow tracking, bank statement reconciliation, and statutory tax tracking.
          </p>

          <h2 class="text-lg font-black text-[#06366B] pt-2">3. Not a Statutory Audit or Licensed Tax Firm</h2>
          <p class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-semibold">
            Important Notice: CFO AI is an operational software platform. It does not provide certified public accountant (CPA) statutory audit opinions, and it does not replace a licensed Indonesian Konsultan Pajak. Users remain solely responsible for the accuracy and statutory submission of official tax filings to the Directorate General of Taxes (DGT).
          </p>

          <h2 class="text-lg font-black text-[#06366B] pt-2">4. 7-Day Free Trial and Subscription Billing</h2>
          <p>
            All subscription plans include a 7-day (168-hour) trial period without credit card requirement. Upon subscription activation, fees are billed monthly or annually according to the agreed pricing schedule. Subscriptions may be cancelled at any time prior to the next billing cycle.
          </p>

          <h2 class="text-lg font-black text-[#06366B] pt-2">5. Governing Law and Dispute Resolution</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the Republic of Indonesia. Any disputes arising out of these Terms shall be subject to amicable settlement, failing which they shall be submitted to the jurisdiction of the Indonesian courts.
          </p>

          <div class="border-t border-slate-200 pt-6 mt-8">
            <p class="text-slate-500">For legal or contractual inquiries, contact <span class="font-mono text-[#1768C9]">legal@cfo-ai.site</span>.</p>
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
