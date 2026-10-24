/**
 * CFO AI — CMS Admin Client Application
 * Powers https://admin.cfo-ai.site
 */

const API_BASE = '/api/cms';
let currentToken = localStorage.getItem('cfo_cms_token') || '';
let currentUser = JSON.parse(localStorage.getItem('cfo_cms_user') || 'null');
let currentTab = 'dashboard';

// --- AUTHENTICATION & INITIALIZATION ---
async function initApp() {
  if (!currentToken || !currentUser) {
    // If no stored credentials, attempt auto-login as Owner or show modal
    const autoSuccess = await loginUser('owner@cfo-ai.site', 'password123');
    if (!autoSuccess) {
      showLoginModal();
      return;
    }
  }

  // Verify current token validity
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      localStorage.setItem('cfo_cms_user', JSON.stringify(currentUser));
      hideLoginModal();
      updateUserHeader();
      const urlParams = new URLSearchParams(window.location.search);
      const initialTab = urlParams.get('tab') || window.location.hash.substring(1) || 'dashboard';
      switchTab(initialTab);
    } else {
      showLoginModal('Session expired. Please sign in to continue.');
    }
  } catch (err) {
    console.warn('Auth verification network issue, falling back to cached profile:', err);
    updateUserHeader();
    switchTab('dashboard');
  }
}

function showLoginModal(msg = '') {
  const modal = document.getElementById('cms-login-modal');
  if (modal) modal.classList.remove('hidden');
  const errEl = document.getElementById('login-error-msg');
  if (errEl) {
    if (msg) {
      errEl.innerText = msg;
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
    }
  }
}

function hideLoginModal() {
  const modal = document.getElementById('cms-login-modal');
  if (modal) modal.classList.add('hidden');
}

function quickFillLogin(email) {
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-password');
  if (emailInput) emailInput.value = email;
  if (passInput) passInput.value = 'password123';
}

async function handleFormLogin(event) {
  if (event) event.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-submit-btn');
  if (btn) btn.innerText = 'Signing In...';

  const ok = await loginUser(email, password);
  if (btn) btn.innerText = 'Sign In to Studio';

  if (ok) {
    hideLoginModal();
    updateUserHeader();
    switchTab(currentTab || 'dashboard');
  } else {
    showLoginModal('Invalid credentials. Please verify your email and password.');
  }
}

async function loginUser(email, password) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (res.ok) {
      const data = await res.json();
      currentToken = data.token;
      currentUser = data.user;
      localStorage.setItem('cfo_cms_token', currentToken);
      localStorage.setItem('cfo_cms_user', JSON.stringify(currentUser));
      updateUserHeader();
      return true;
    }
  } catch (err) {
    console.error('Login error:', err);
  }
  return false;
}

function handleLogout() {
  localStorage.removeItem('cfo_cms_token');
  localStorage.removeItem('cfo_cms_user');
  currentToken = '';
  currentUser = null;
  document.getElementById('top-user-name').innerText = 'Signed Out';
  document.getElementById('top-user-role').innerText = 'NO ACTIVE SESSION';
  showLoginModal('You have been signed out. Please sign in again.');
}

function updateUserHeader() {
  if (currentUser) {
    document.getElementById('top-user-name').innerText = currentUser.name;
    document.getElementById('top-user-role').innerText = `ROLE: ${currentUser.role.toUpperCase()}`;
  }
}

async function apiFetch(endpoint, options = {}) {
  options.headers = options.headers || {};
  options.headers['Authorization'] = `Bearer ${currentToken}`;
  options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
  
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  if (res.status === 401) {
    showLoginModal('Session expired. Please sign in to continue.');
    throw new Error('Session expired');
  }
  return res.json();
}

// --- TAB SWITCHER ---
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('aside nav button').forEach(b => b.classList.remove('nav-item-active'));
  const activeBtn = document.getElementById(`nav-${tabId}`);
  if (activeBtn) activeBtn.classList.add('nav-item-active');

  const view = document.getElementById('main-content-view');
  view.innerHTML = `<div class="py-12 text-center text-xs text-slate-400">Loading ${tabId}...</div>`;

  if (tabId === 'dashboard') renderDashboardView(view);
  else if (tabId === 'pages') renderPagesView(view);
  else if (tabId === 'hub') renderHubView(view);
  else if (tabId === 'help') renderHelpCenterView(view);
  else if (tabId === 'integrations') renderIntegrationsView(view);
  else if (tabId === 'pricing') renderPricingView(view);
  else if (tabId === 'translations') renderTranslationsView(view);
  else if (tabId === 'seo') renderSeoView(view);
  else if (tabId === 'media') renderMediaView(view);
  else if (tabId === 'navigation') renderNavigationView(view);
  else if (tabId === 'releases') renderReleasesView(view);
  else if (tabId === 'audit') renderAuditView(view);
}

// ==========================================
// 1. DASHBOARD VIEW
// ==========================================
async function renderDashboardView(container) {
  const data = await apiFetch('/dashboard');
  const activeRel = data.activeRelease;
  if (activeRel) {
    document.getElementById('top-release-version').innerText = `Active: ${activeRel.version} (${activeRel.hash})`;
  }

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 class="text-2xl font-black text-[#003366]">CMS Operations Command</h1>
        <p class="text-xs text-[#5A6E82]">Real-time management for CFO AI commercial website, 16 locales, and Knowledge Hub.</p>
      </div>

      <!-- KEY STATS ROW -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="admin-card p-5">
          <div class="text-[11px] font-bold text-slate-400 uppercase">Knowledge Hub</div>
          <div class="text-2xl font-black text-[#003366] mt-1">${data.stats.publishedArticlesCount} / ${data.stats.articlesCount}</div>
          <div class="text-[11px] text-emerald-600 font-semibold mt-1">Articles Published</div>
        </div>

        <div class="admin-card p-5">
          <div class="text-[11px] font-bold text-slate-400 uppercase">16 Locales Support</div>
          <div class="text-2xl font-black text-[#003366] mt-1">${data.stats.activeLocalesCount} Active</div>
          <div class="text-[11px] text-[#1565C0] font-semibold mt-1">${data.stats.totalLocalesCount - data.stats.activeLocalesCount} Staged / In Prep</div>
        </div>

        <div class="admin-card p-5">
          <div class="text-[11px] font-bold text-slate-400 uppercase">Active Production Release</div>
          <div class="text-2xl font-black text-[#003366] mt-1 font-mono-num">${activeRel?.version || 'Initial'}</div>
          <div class="text-[11px] text-slate-500 font-mono mt-1">SHA: ${activeRel?.hash || 'c98aaf9'}</div>
        </div>

        <div class="admin-card p-5">
          <div class="text-[11px] font-bold text-slate-400 uppercase">Pricing Discrepancy Guard</div>
          <div class="text-2xl font-black ${data.pricingStatus.isValid ? 'text-emerald-700' : 'text-rose-600'} mt-1">
            ${data.pricingStatus.isValid ? '0 Discrepancies' : `${data.stats.pricingDiscrepanciesCount} Discrepancies`}
          </div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">Catalog: ${data.pricingStatus.catalogVersion}</div>
        </div>
      </div>

      <!-- PRICING DISCREPANCY GUARD CALLOUT -->
      ${!data.pricingStatus.isValid ? `
        <div class="p-4 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-900">
          <div class="font-bold flex items-center gap-2 mb-1">
            <span>⚠️</span><span>CRITICAL PRICING DISCREPANCY DETECTED</span>
          </div>
          <ul class="list-disc pl-5 space-y-1">
            ${data.pricingStatus.discrepancies.map(d => `<li>${d.message}</li>`).join('')}
          </ul>
        </div>
      ` : `
        <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
            <span><strong>Pricing Discrepancy Guard Active:</strong> All 11 commercial limits and 12 feature entitlements match billing catalog <strong>${data.pricingStatus.catalogVersion}</strong> with 100% mathematical fidelity.</span>
          </div>
          <button onclick="switchTab('pricing')" class="text-xs font-bold text-[#1565C0] hover:underline">Inspect Matrix →</button>
        </div>
      `}

      <!-- RECENT AUDIT LOGS -->
      <div class="admin-card p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-black text-sm text-[#003366]">Recent Editorial &amp; Publishing Activity</h3>
          <button onclick="switchTab('audit')" class="text-xs font-bold text-[#1565C0] hover:underline">View All Logs →</button>
        </div>
        <div class="overflow-x-auto text-xs">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-slate-200 text-slate-400 font-bold">
                <th class="pb-2">Timestamp</th>
                <th class="pb-2">Actor</th>
                <th class="pb-2">Action</th>
                <th class="pb-2">Entity</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-[#334155]">
              ${data.recentAudits.map(a => `
                <tr>
                  <td class="py-2.5 font-mono text-slate-400">${new Date(a.timestamp).toLocaleTimeString()}</td>
                  <td class="py-2.5 font-semibold text-[#003366]">${a.actor}</td>
                  <td class="py-2.5"><span class="px-2 py-0.5 rounded bg-slate-100 font-mono text-[11px]">${a.action}</span></td>
                  <td class="py-2.5 font-mono text-slate-500">${a.entity}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// 2. PAGES MANAGEMENT VIEW
// ==========================================
async function renderPagesView(container) {
  const pages = await apiFetch('/pages');

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-black text-[#003366]">Page Content &amp; Block Editor</h1>
          <p class="text-xs text-[#5A6E82]">Edit hero headlines, section headings, block ordering, and CTAs across all marketing surfaces.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
        <!-- Page Selector List -->
        <div class="space-y-2">
          ${pages.map(p => `
            <button onclick="loadPageEdit('${p.slug}')" class="w-full text-left p-3.5 admin-card hover:border-[#1565C0] block transition-all">
              <div class="font-bold text-xs text-[#003366]">${p.title}</div>
              <div class="text-[10px] text-slate-400 font-mono mt-0.5">/${p.slug === 'home' ? '' : p.slug} &bull; ${p.blocks?.length || 0} blocks</div>
            </button>
          `).join('')}
        </div>

        <!-- Page Block Editor Container -->
        <div class="md:col-span-3 admin-card p-6" id="page-editor-container">
          <div class="py-12 text-center text-xs text-slate-400">Select a page on the left to edit blocks.</div>
        </div>
      </div>
    </div>
  `;

  // Auto-load home page editor
  if (pages.length > 0) loadPageEdit(pages[0].slug);
}

async function loadPageEdit(slug) {
  const page = await apiFetch(`/pages/${slug}`);
  const container = document.getElementById('page-editor-container');
  const heroBlock = page.blocks?.find(b => b.type === 'hero') || {};

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between pb-4 border-b border-slate-100">
        <div>
          <h3 class="font-black text-lg text-[#003366]">${page.title}</h3>
          <span class="text-[11px] font-mono text-slate-400">Slug: /${slug === 'home' ? '' : slug}</span>
        </div>
        <button onclick="savePageChanges('${slug}')" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-5 py-2.5 rounded-xl shadow-sm">
          Save Page Changes
        </button>
      </div>

      <!-- EDITABLE HERO BLOCK -->
      <div class="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold uppercase tracking-wider text-[#1565C0]">BLOCK: HERO SECTION</span>
          <span class="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded font-mono">type: hero</span>
        </div>

        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Badge Ribbon Text</label>
          <input type="text" id="edit-hero-badge" value="${heroBlock.badge || ''}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-[#1565C0]" />
        </div>

        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Hero Title (H1 Headline)</label>
          <input type="text" id="edit-hero-title" value="${heroBlock.title || ''}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white font-bold focus:outline-none focus:border-[#1565C0]" />
        </div>

        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Subtitle / Value Proposition</label>
          <textarea id="edit-hero-subtitle" rows="3" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-[#1565C0] leading-relaxed">${heroBlock.subtitle || ''}</textarea>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-[#003366] mb-1">Primary CTA Button Text</label>
            <input type="text" id="edit-hero-cta-text" value="${heroBlock.primary_cta_text || 'Start Free Trial (7 Days)'}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white" />
          </div>
          <div>
            <label class="block text-xs font-bold text-[#003366] mb-1">Primary CTA Destination URL</label>
            <input type="text" id="edit-hero-cta-url" value="${heroBlock.primary_cta_url || 'https://app.cfo-ai.site/login'}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white font-mono" />
          </div>
        </div>
      </div>

      <div class="text-[11px] text-slate-400">
        Changes are saved to working draft. To promote changes to the public website, navigate to <strong>Publishing &amp; Rollback</strong>.
      </div>
    </div>
  `;
}

async function savePageChanges(slug) {
  const page = await apiFetch(`/pages/${slug}`);
  const heroIndex = page.blocks.findIndex(b => b.type === 'hero');

  if (heroIndex >= 0) {
    page.blocks[heroIndex].badge = document.getElementById('edit-hero-badge').value;
    page.blocks[heroIndex].title = document.getElementById('edit-hero-title').value;
    page.blocks[heroIndex].subtitle = document.getElementById('edit-hero-subtitle').value;
    page.blocks[heroIndex].primary_cta_text = document.getElementById('edit-hero-cta-text').value;
    page.blocks[heroIndex].primary_cta_url = document.getElementById('edit-hero-cta-url').value;
  }

  await apiFetch(`/pages/${slug}`, {
    method: 'PUT',
    body: JSON.stringify(page)
  });

  alert(`Page '${slug}' updated successfully!`);
}

// ==========================================
// 3. KNOWLEDGE HUB VIEW & ARTICLE STUDIO
// ==========================================
async function renderHubView(container) {
  const articles = await apiFetch('/hub/articles');
  const categories = await apiFetch('/hub/categories');

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-black text-[#003366]">Knowledge Hub Editorial Studio</h1>
          <p class="text-xs text-[#5A6E82]">Publish authoritative Indonesian tax, accounting, and regulation guides with legal review dates.</p>
        </div>
        <button onclick="openNewArticleModal()" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-5 py-2.5 rounded-xl shadow-sm">
          + Draft New Guide
        </button>
      </div>

      <!-- Articles Table -->
      <div class="admin-card p-6">
        <div class="overflow-x-auto text-xs">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-slate-200 text-slate-400 font-bold">
                <th class="pb-3">Title &amp; Slug</th>
                <th class="pb-3">Category</th>
                <th class="pb-3">Jurisdiction</th>
                <th class="pb-3">Legal Review Date</th>
                <th class="pb-3">Status</th>
                <th class="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-[#334155]">
              ${articles.map(art => {
                const en = art.translations?.en || {};
                return `
                  <tr class="hover:bg-slate-50">
                    <td class="py-3">
                      <div class="font-bold text-[#003366]">${en.title || art.slug}</div>
                      <div class="text-[10px] font-mono text-slate-400">/blog/${art.slug}</div>
                    </td>
                    <td class="py-3"><span class="px-2 py-0.5 rounded bg-blue-50 text-[#1565C0] font-semibold text-[10px]">${art.category_name}</span></td>
                    <td class="py-3 font-mono font-bold text-slate-600">${art.jurisdiction}</td>
                    <td class="py-3 font-mono text-slate-500">${art.last_legal_review ? art.last_legal_review.split('T')[0] : 'Pending'}</td>
                    <td class="py-3">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold ${art.review_status === 'published' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}">
                        ${art.review_status.toUpperCase()}
                      </span>
                    </td>
                    <td class="py-3 text-right space-x-2">
                      <button onclick="editArticle('${art.slug}')" class="text-xs font-bold text-[#1565C0] hover:underline">Edit</button>
                      <button onclick="deleteArticle('${art.slug}')" class="text-xs font-bold text-rose-600 hover:underline">Delete</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function editArticle(slug) {
  const article = await apiFetch(`/hub/articles/${slug}`);
  const categories = await apiFetch('/hub/categories');
  const en = article.translations?.en || {};
  const container = document.getElementById('main-content-view');

  container.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-6">
      <div class="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <button onclick="switchTab('hub')" class="text-xs text-[#1565C0] font-bold hover:underline mb-1">← Back to Articles</button>
          <h2 class="text-2xl font-black text-[#003366]">Edit Guide: ${en.title || slug}</h2>
        </div>
        <div class="flex items-center gap-3">
          <button onclick="saveArticleDraft('${slug}')" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-6 py-2.5 rounded-xl shadow-sm">
            Save Guide
          </button>
        </div>
      </div>

      <div class="admin-card p-6 space-y-4">
        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Article Title (English Master)</label>
          <input type="text" id="art-title" value="${en.title || ''}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 font-bold bg-white" />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-[#003366] mb-1">URL Slug</label>
            <input type="text" id="art-slug" value="${article.slug}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 font-mono bg-white" />
          </div>
          <div>
            <label class="block text-xs font-bold text-[#003366] mb-1">Category</label>
            <select id="art-category" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white">
              ${categories.map(c => `<option value="${c.slug}" ${c.slug === article.category ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-bold text-[#003366] mb-1">Legal Jurisdiction</label>
            <input type="text" id="art-jurisdiction" value="${article.jurisdiction || 'ID'}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 font-mono bg-white font-bold" />
          </div>
          <div>
            <label class="block text-xs font-bold text-[#003366] mb-1">Reading Time (Mins)</label>
            <input type="number" id="art-reading-time" value="${article.reading_time_minutes || 8}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white" />
          </div>
          <div>
            <label class="block text-xs font-bold text-[#003366] mb-1">Publication Status</label>
            <select id="art-status" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white">
              <option value="draft" ${article.review_status === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="in_review" ${article.review_status === 'in_review' ? 'selected' : ''}>In Review</option>
              <option value="published" ${article.review_status === 'published' ? 'selected' : ''}>Published</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Excerpt / Search Snippet</label>
          <textarea id="art-excerpt" rows="2" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white">${en.excerpt || ''}</textarea>
        </div>

        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Article Content (Markdown Format)</label>
          <textarea id="art-content" rows="14" class="w-full text-xs p-3 rounded-lg border border-slate-200 font-mono bg-white leading-relaxed">${en.content_markdown || ''}</textarea>
        </div>
      </div>
    </div>
  `;
}

async function saveArticleDraft(originalSlug) {
  const article = await apiFetch(`/hub/articles/${originalSlug}`);
  const title = document.getElementById('art-title').value;
  const slug = document.getElementById('art-slug').value;
  const category = document.getElementById('art-category').value;
  const jurisdiction = document.getElementById('art-jurisdiction').value;
  const readingTime = parseInt(document.getElementById('art-reading-time').value, 10);
  const status = document.getElementById('art-status').value;
  const excerpt = document.getElementById('art-excerpt').value;
  const content = document.getElementById('art-content').value;

  article.slug = slug;
  article.category = category;
  article.jurisdiction = jurisdiction;
  article.reading_time_minutes = readingTime;
  article.review_status = status;
  article.translations = article.translations || {};
  article.translations.en = article.translations.en || {};
  article.translations.en.title = title;
  article.translations.en.excerpt = excerpt;
  article.translations.en.content_markdown = content;

  await apiFetch('/hub/articles', {
    method: 'POST',
    body: JSON.stringify(article)
  });

  alert('Guide saved successfully!');
  switchTab('hub');
}

async function deleteArticle(slug) {
  if (confirm(`Are you sure you want to delete guide '${slug}'?`)) {
    await apiFetch(`/hub/articles/${slug}`, { method: 'DELETE' });
    renderHubView(document.getElementById('main-content-view'));
  }
}

// ==========================================
// 4. PRICING & DISCREPANCY GUARD VIEW
// ==========================================
async function renderPricingView(container) {
  const data = await apiFetch('/pricing');
  const pricing = data.pricing;
  const validation = data.validation;

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-black text-[#003366]">Pricing Presentation &amp; Discrepancy Guard</h1>
          <p class="text-xs text-[#5A6E82]">Configure commercial marketing presentation while strictly preventing contradictions with backend billing.</p>
        </div>
        <button onclick="savePricingPresentation()" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-5 py-2.5 rounded-xl shadow-sm">
          Save Pricing Presentation
        </button>
      </div>

      <!-- DISCREPANCY GUARD STATUS BANNER -->
      ${validation.isValid ? `
        <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span>✓</span>
            <span><strong>Billing Catalog In Sync:</strong> Marketing presentation matches catalog <strong>${validation.catalogVersion}</strong>. All 11 limits and 12 features verified.</span>
          </div>
          <span class="text-[10px] font-mono text-emerald-700">Verified: ${new Date().toLocaleTimeString()}</span>
        </div>
      ` : `
        <div class="p-4 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-900">
          <div class="font-bold flex items-center gap-2 mb-1">
            <span>⚠️</span><span>DISCREPANCY DETECTED — PUBLICATION BLOCKED</span>
          </div>
          <ul class="list-disc pl-5 space-y-1">
            ${validation.discrepancies.map(d => `<li>${d.message}</li>`).join('')}
          </ul>
        </div>
      `}

      <!-- EDITABLE PLAN TIERS -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        ${pricing.plans.map(p => `
          <div class="admin-card p-6 space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-black uppercase text-[#1565C0]">${p.id.toUpperCase()} PLAN</span>
              <span class="text-[10px] font-mono text-slate-400">id: ${p.id}</span>
            </div>

            <div>
              <label class="block text-xs font-bold text-[#003366] mb-1">Monthly Subscription ($ USD)</label>
              <input type="number" id="price-${p.id}" value="${p.price_monthly}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 font-bold font-mono bg-white" />
            </div>

            <div>
              <label class="block text-xs font-bold text-[#003366] mb-1">Tagline</label>
              <input type="text" id="tagline-${p.id}" value="${p.tagline}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white" />
            </div>

            <div>
              <label class="block text-xs font-bold text-[#003366] mb-1">Description</label>
              <textarea id="desc-${p.id}" rows="2" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white">${p.description}</textarea>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- EDITABLE 11 USAGE LIMITS TABLE -->
      <div class="admin-card p-6">
        <h3 class="font-black text-sm text-[#003366] mb-3">Usage Limits Matrix (11 Limits Reconciled)</h3>
        <div class="overflow-x-auto text-xs">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-slate-200 text-slate-400 font-bold">
                <th class="pb-2">Resource Metric</th>
                <th class="pb-2 text-center">Starter ($59)</th>
                <th class="pb-2 text-center">Control ($149)</th>
                <th class="pb-2 text-center">Pro ($249)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-[#334155]">
              ${pricing.usage_limits_table.map((row, idx) => `
                <tr>
                  <td class="py-2.5 font-bold text-[#003366]">${row.label}</td>
                  <td class="py-2.5 text-center"><input type="text" id="limit-starter-${idx}" value="${row.starter}" class="w-24 text-center font-mono p-1 border rounded" /></td>
                  <td class="py-2.5 text-center"><input type="text" id="limit-control-${idx}" value="${row.control}" class="w-24 text-center font-mono p-1 border rounded font-bold text-[#1565C0]" /></td>
                  <td class="py-2.5 text-center"><input type="text" id="limit-pro-${idx}" value="${row.pro}" class="w-24 text-center font-mono p-1 border rounded" /></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function savePricingPresentation() {
  const data = await apiFetch('/pricing');
  const pricing = data.pricing;

  // Update plan prices and descriptions
  pricing.plans.forEach(p => {
    p.price_monthly = parseInt(document.getElementById(`price-${p.id}`).value, 10);
    p.tagline = document.getElementById(`tagline-${p.id}`).value;
    p.description = document.getElementById(`desc-${p.id}`).value;
  });

  // Update limits
  pricing.usage_limits_table.forEach((row, idx) => {
    row.starter = document.getElementById(`limit-starter-${idx}`).value;
    row.control = document.getElementById(`limit-control-${idx}`).value;
    row.pro = document.getElementById(`limit-pro-${idx}`).value;
  });

  const res = await apiFetch('/pricing', {
    method: 'PUT',
    body: JSON.stringify(pricing)
  });

  if (!res.validation.isValid) {
    alert(`Pricing saved with ${res.validation.discrepancies.length} discrepancy warnings! Check guard alerts.`);
  } else {
    alert('Pricing presentation saved and 100% verified with billing catalog!');
  }

  renderPricingView(document.getElementById('main-content-view'));
}

// ==========================================
// 5. TRANSLATIONS (16 LOCALES) VIEW
// ==========================================
async function renderTranslationsView(container) {
  const matrix = await apiFetch('/translations/matrix');

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 class="text-2xl font-black text-[#003366]">16 Locales Translation Studio</h1>
        <p class="text-xs text-[#5A6E82]">Architectural multi-locale management. Control launch readiness and staging per language.</p>
      </div>

      <div class="admin-card p-6">
        <div class="overflow-x-auto text-xs">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-slate-200 text-slate-400 font-bold">
                <th class="pb-3">Locale</th>
                <th class="pb-3">Language Name</th>
                <th class="pb-3">Native Name</th>
                <th class="pb-3">Completeness</th>
                <th class="pb-3">Status</th>
                <th class="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-[#334155]">
              ${matrix.map(loc => `
                <tr class="hover:bg-slate-50">
                  <td class="py-3 font-mono font-bold text-[#1565C0]">${loc.code}</td>
                  <td class="py-3 font-semibold text-[#003366]">${loc.name} ${loc.isDefault ? '<span class="text-[10px] text-slate-400 font-normal">(Default)</span>' : ''}</td>
                  <td class="py-3">${loc.nativeName}</td>
                  <td class="py-3">
                    <div class="flex items-center gap-2">
                      <div class="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full bg-[#1565C0]" style="width: ${loc.completeness}"></div>
                      </div>
                      <span class="font-mono text-[11px] text-slate-500">${loc.translatedArticles}/${loc.totalArticles} (${loc.completeness})</span>
                    </div>
                  </td>
                  <td class="py-3">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${loc.status === 'published' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                      ${loc.status.toUpperCase()}
                    </span>
                  </td>
                  <td class="py-3 text-right">
                    <button onclick="toggleLocaleStatus('${loc.code}', '${loc.status === 'published' ? 'staged' : 'published'}')" class="text-xs font-bold text-[#1565C0] hover:underline">
                      ${loc.status === 'published' ? 'Stage / Unpublish' : 'Activate / Publish'}
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function toggleLocaleStatus(code, newStatus) {
  await apiFetch(`/locales/${code}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status: newStatus })
  });
  renderTranslationsView(document.getElementById('main-content-view'));
}

// ==========================================
// 6. PUBLISHING & ROLLBACK VIEW
// ==========================================
async function renderReleasesView(container) {
  const data = await apiFetch('/releases');
  const activeId = data.activeReleaseId;

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-black text-[#003366]">Publishing &amp; Versioned Releases</h1>
          <p class="text-xs text-[#5A6E82]">Publish atomic production releases or roll back to any prior snapshot with zero downtime.</p>
        </div>
        <button onclick="publishNewRelease()" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-6 py-3 rounded-xl shadow-md flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
          Publish New Production Release
        </button>
      </div>

      <div class="admin-card p-6">
        <h3 class="font-black text-sm text-[#003366] mb-4">Release Version History &amp; 1-Click Rollback</h3>
        <div class="overflow-x-auto text-xs">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-slate-200 text-slate-400 font-bold">
                <th class="pb-3">Release Version</th>
                <th class="pb-3">Commit Hash</th>
                <th class="pb-3">Author</th>
                <th class="pb-3">Notes</th>
                <th class="pb-3">Date</th>
                <th class="pb-3">Status</th>
                <th class="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-[#334155]">
              ${data.releases.map(rel => `
                <tr class="hover:bg-slate-50 ${rel.is_active ? 'bg-blue-50/40' : ''}">
                  <td class="py-3 font-mono font-bold text-[#003366]">${rel.version}</td>
                  <td class="py-3 font-mono text-slate-500">${rel.hash}</td>
                  <td class="py-3">${rel.author}</td>
                  <td class="py-3 text-slate-600">${rel.notes}</td>
                  <td class="py-3 font-mono text-slate-400">${new Date(rel.created_at).toLocaleString()}</td>
                  <td class="py-3">
                    ${rel.is_active ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">ACTIVE LIVE</span>' : '<span class="text-slate-400 text-[10px]">Archived</span>'}
                  </td>
                  <td class="py-3 text-right">
                    ${!rel.is_active ? `<button onclick="rollbackToRelease('${rel.release_id}')" class="text-xs font-bold text-[#1565C0] hover:underline">Rollback to this</button>` : '<span class="text-xs text-slate-400 font-medium">Currently Live</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function publishNewRelease() {
  const notes = prompt('Enter release notes for this production release:', 'Commercial Website Release Candidate');
  if (!notes) return;

  try {
    const res = await apiFetch('/releases/publish', {
      method: 'POST',
      body: JSON.stringify({ notes })
    });
    alert(res.message);
    renderReleasesView(document.getElementById('main-content-view'));
  } catch (err) {
    alert(`Publication failed: ${err.message}`);
  }
}

async function rollbackToRelease(releaseId) {
  if (confirm(`Are you sure you want to rollback to release ${releaseId}? This will immediately update the live public site.`)) {
    try {
      const res = await apiFetch(`/releases/${releaseId}/rollback`, { method: 'POST' });
      alert(res.message);
      renderReleasesView(document.getElementById('main-content-view'));
    } catch (err) {
      alert(`Rollback failed: ${err.message}`);
    }
  }
}

// ==========================================
// 7. SEO MANAGER VIEW
// ==========================================
async function renderSeoView(container) {
  const seo = await apiFetch('/seo');

  container.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 class="text-2xl font-black text-[#003366]">SEO &amp; Metadata Manager</h1>
        <p class="text-xs text-[#5A6E82]">Configure canonical URLs, open graph tags, robots directives, and 301 redirects.</p>
      </div>

      <div class="admin-card p-6 space-y-4">
        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Site Base URL</label>
          <input type="text" id="seo-base-url" value="${seo.base_url || 'https://cfo-ai.site'}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 font-mono bg-white" />
        </div>

        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Default Site Title</label>
          <input type="text" id="seo-default-title" value="${seo.default_title || ''}" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 font-bold bg-white" />
        </div>

        <div>
          <label class="block text-xs font-bold text-[#003366] mb-1">Default Meta Description</label>
          <textarea id="seo-default-desc" rows="2" class="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white">${seo.default_description || ''}</textarea>
        </div>

        <div class="pt-4 border-t border-slate-100 flex items-center justify-between">
          <a href="/sitemap.xml" target="_blank" class="text-xs font-bold text-[#1565C0] hover:underline">View Live sitemap.xml ↗</a>
          <button onclick="saveSeoSettings()" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-5 py-2.5 rounded-xl shadow-sm">
            Save SEO Directives
          </button>
        </div>
      </div>
    </div>
  `;
}

async function saveSeoSettings() {
  const seo = await apiFetch('/seo');
  seo.base_url = document.getElementById('seo-base-url').value;
  seo.default_title = document.getElementById('seo-default-title').value;
  seo.default_description = document.getElementById('seo-default-desc').value;

  await apiFetch('/seo', {
    method: 'PUT',
    body: JSON.stringify(seo)
  });
  alert('SEO settings updated!');
}

// ==========================================
// 8. NAVIGATION VIEW
// ==========================================
async function renderNavigationView(container) {
  const nav = await apiFetch('/navigation');

  container.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 class="text-2xl font-black text-[#003366]">Navigation &amp; Footer Manager</h1>
        <p class="text-xs text-[#5A6E82]">Manage header menu links, call-to-action buttons, and footer columns.</p>
      </div>

      <div class="admin-card p-6 space-y-4">
        <h3 class="font-bold text-xs uppercase tracking-wider text-[#1565C0]">Header Menu Links</h3>
        <div class="space-y-2">
          ${nav.header.links.map(l => `
            <div class="flex items-center gap-3 p-2 bg-slate-50 rounded-lg text-xs">
              <span class="font-bold text-[#003366] w-36">${l.label}</span>
              <span class="font-mono text-slate-400">${l.url}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// 9. AUDIT VIEW
// ==========================================
async function renderAuditView(container) {
  const logs = await apiFetch('/audit-logs');

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 class="text-2xl font-black text-[#003366]">Administrative Audit Logs</h1>
        <p class="text-xs text-[#5A6E82]">Immutable audit ledger recording all editorial, pricing, and publishing actions.</p>
      </div>

      <div class="admin-card p-6">
        <div class="overflow-x-auto text-xs">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-slate-200 text-slate-400 font-bold">
                <th class="pb-3">Timestamp</th>
                <th class="pb-3">Actor</th>
                <th class="pb-3">Action</th>
                <th class="pb-3">Entity</th>
                <th class="pb-3">Details</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-[#334155]">
              ${logs.map(log => `
                <tr>
                  <td class="py-2.5 font-mono text-slate-400">${new Date(log.timestamp).toLocaleString()}</td>
                  <td class="py-2.5 font-bold text-[#003366]">${log.actor}</td>
                  <td class="py-2.5"><span class="px-2 py-0.5 rounded bg-slate-100 font-mono text-[10px] font-semibold">${log.action}</span></td>
                  <td class="py-2.5 font-mono text-slate-600">${log.entity}</td>
                  <td class="py-2.5 text-slate-500 font-mono text-[11px]">${JSON.stringify(log.details)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}


// ==========================================
// 10. INTEGRATION CARDS VIEW (TASK 4.B)
// ==========================================
async function renderIntegrationsView(container) {
  const cards = await apiFetch('/integrations');
  
  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-black text-[#003366]">Integration Cards &amp; Channels</h1>
          <p class="text-xs text-[#5A6E82]">Manage connected workspace intake channels (WhatsApp, Telegram, ChatGPT, Claude, Web App). Changes update the public Connected Workspace section upon next build or SSR render.</p>
        </div>
      </div>

      <!-- CARDS LIST -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${cards.map(card => {
          const en = card.translations?.en || {};
          let statusBadgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
          let statusLabel = 'Available';
          if (card.status === 'coming_soon') {
            statusBadgeClass = 'bg-amber-50 text-amber-800 border-amber-200';
            statusLabel = 'Coming Soon';
          } else if (card.status === 'temporarily_unavailable') {
            statusBadgeClass = 'bg-slate-100 text-slate-700 border-slate-300';
            statusLabel = 'Unavailable';
          }
          return `
            <div class="admin-card p-6 flex flex-col justify-between hover:shadow-md transition">
              <div>
                <div class="flex items-start justify-between mb-3">
                  <div class="flex items-center gap-3">
                    <span class="text-3xl">${card.icon || '🔌'}</span>
                    <div>
                      <h3 class="font-black text-sm text-[#003366]">${en.name || card.name}</h3>
                      <span class="text-[10px] font-mono text-slate-400">ID: ${card.id} &bull; Order: ${card.display_order}</span>
                    </div>
                  </div>
                  <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${statusBadgeClass}">
                    ${statusLabel}
                  </span>
                </div>
                <div class="text-xs text-slate-600 mb-4 line-clamp-3 leading-relaxed">
                  ${en.description || ''}
                </div>
                <div class="text-[11px] text-slate-400 space-y-1 border-t border-slate-100 pt-3">
                  <div><strong>Subtext:</strong> ${en.badge_subtext || 'N/A'}</div>
                  <div><strong>Visibility:</strong> ${card.is_active !== false ? '<span class="text-emerald-600 font-semibold">Active</span>' : '<span class="text-rose-500 font-semibold">Hidden</span>'}</div>
                </div>
              </div>

              <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span class="text-[10px] text-slate-400 font-mono">EN / ID / RU</span>
                <button onclick="editIntegrationCard('${card.id}')" class="text-xs font-bold bg-[#1565C0] hover:bg-[#0052CC] text-white px-3.5 py-1.5 rounded-lg shadow-sm">
                  Edit Card
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- EDIT MODAL CONTAINER -->
      <div id="integration-edit-modal-wrap"></div>
    </div>
  `;
}

async function editIntegrationCard(id) {
  const cards = await apiFetch('/integrations');
  const card = cards.find(c => c.id === id);
  if (!card) return alert('Card not found');

  const en = card.translations?.en || {};
  const idTrans = card.translations?.id || {};
  const ru = card.translations?.ru || {};

  const modalWrap = document.getElementById('integration-edit-modal-wrap');
  modalWrap.innerHTML = `
    <div class="fixed inset-0 bg-[#001428]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
          <div class="flex items-center gap-2">
            <span class="text-2xl">${card.icon}</span>
            <h3 class="font-black text-lg text-[#003366]">Edit Integration: ${card.name}</h3>
          </div>
          <button onclick="document.getElementById('integration-edit-modal-wrap').innerHTML=''" class="text-slate-400 hover:text-slate-600 text-lg font-bold">&times;</button>
        </div>

        <div class="space-y-4 text-xs">
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="block font-bold text-slate-700 mb-1">Status</label>
              <select id="card-edit-status" class="w-full p-2 border border-slate-200 rounded-lg">
                <option value="available" ${card.status === 'available' ? 'selected' : ''}>Available</option>
                <option value="coming_soon" ${card.status === 'coming_soon' ? 'selected' : ''}>Coming Soon</option>
                <option value="temporarily_unavailable" ${card.status === 'temporarily_unavailable' ? 'selected' : ''}>Temporarily Unavailable</option>
              </select>
            </div>
            <div>
              <label class="block font-bold text-slate-700 mb-1">Display Order</label>
              <input type="number" id="card-edit-order" value="${card.display_order}" class="w-full p-2 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label class="block font-bold text-slate-700 mb-1">Visibility</label>
              <select id="card-edit-active" class="w-full p-2 border border-slate-200 rounded-lg">
                <option value="true" ${card.is_active !== false ? 'selected' : ''}>Active / Visible</option>
                <option value="false" ${card.is_active === false ? 'selected' : ''}>Hidden</option>
              </select>
            </div>
          </div>

          <!-- ENGLISH -->
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span class="font-bold text-[#1565C0] uppercase tracking-wider text-[10px]">English (EN)</span>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[10px] text-slate-500">Status Label</label>
                <input type="text" id="card-en-status" value="${en.status_label || ''}" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs" />
              </div>
              <div>
                <label class="block text-[10px] text-slate-500">Badge Subtext</label>
                <input type="text" id="card-en-subtext" value="${en.badge_subtext || ''}" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs" />
              </div>
            </div>
            <div>
              <label class="block text-[10px] text-slate-500">Description</label>
              <textarea id="card-en-desc" rows="2" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs">${en.description || ''}</textarea>
            </div>
          </div>

          <!-- INDONESIAN -->
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span class="font-bold text-[#1565C0] uppercase tracking-wider text-[10px]">Indonesian (ID)</span>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[10px] text-slate-500">Status Label</label>
                <input type="text" id="card-id-status" value="${idTrans.status_label || ''}" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs" />
              </div>
              <div>
                <label class="block text-[10px] text-slate-500">Badge Subtext</label>
                <input type="text" id="card-id-subtext" value="${idTrans.badge_subtext || ''}" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs" />
              </div>
            </div>
            <div>
              <label class="block text-[10px] text-slate-500">Description</label>
              <textarea id="card-id-desc" rows="2" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs">${idTrans.description || ''}</textarea>
            </div>
          </div>

          <!-- RUSSIAN -->
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span class="font-bold text-[#1565C0] uppercase tracking-wider text-[10px]">Russian (RU)</span>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[10px] text-slate-500">Status Label</label>
                <input type="text" id="card-ru-status" value="${ru.status_label || ''}" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs" />
              </div>
              <div>
                <label class="block text-[10px] text-slate-500">Badge Subtext</label>
                <input type="text" id="card-ru-subtext" value="${ru.badge_subtext || ''}" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs" />
              </div>
            </div>
            <div>
              <label class="block text-[10px] text-slate-500">Description</label>
              <textarea id="card-ru-desc" rows="2" class="w-full p-1.5 border border-slate-200 rounded bg-white text-xs">${ru.description || ''}</textarea>
            </div>
          </div>
        </div>

        <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
          <button onclick="document.getElementById('integration-edit-modal-wrap').innerHTML=''" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button onclick="saveIntegrationCard('${card.id}')" class="px-5 py-2 text-xs font-bold bg-[#1565C0] hover:bg-[#0052CC] text-white rounded-xl shadow">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  `;
}

async function saveIntegrationCard(id) {
  const cards = await apiFetch('/integrations');
  const card = cards.find(c => c.id === id);
  if (!card) return;

  card.status = document.getElementById('card-edit-status').value;
  card.display_order = parseInt(document.getElementById('card-edit-order').value, 10) || 1;
  card.is_active = document.getElementById('card-edit-active').value === 'true';

  card.translations = card.translations || {};
  card.translations.en = {
    ...card.translations.en,
    status_label: document.getElementById('card-en-status').value,
    badge_subtext: document.getElementById('card-en-subtext').value,
    description: document.getElementById('card-en-desc').value
  };
  card.translations.id = {
    ...card.translations.id,
    status_label: document.getElementById('card-id-status').value,
    badge_subtext: document.getElementById('card-id-subtext').value,
    description: document.getElementById('card-id-desc').value
  };
  card.translations.ru = {
    ...card.translations.ru,
    status_label: document.getElementById('card-ru-status').value,
    badge_subtext: document.getElementById('card-ru-subtext').value,
    description: document.getElementById('card-ru-desc').value
  };

  await apiFetch(`/integrations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(card)
  });

  document.getElementById('integration-edit-modal-wrap').innerHTML = '';
  renderIntegrationsView(document.getElementById('main-content-view'));
}

// ==========================================
// 11. HELP CENTER VIEW & EDITORIAL STUDIO (TASK 4.D)
// ==========================================
let currentHelpSubtab = 'articles';

async function renderHelpCenterView(container) {
  const articles = await apiFetch('/help/articles');
  const categories = await apiFetch('/help/categories');

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-black text-[#003366]">Help Center &amp; Guides Studio</h1>
          <p class="text-xs text-[#5A6E82]">Manage customer product documentation, step-by-step launch guides, categories, and screenshot references.</p>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex bg-slate-200/80 p-1 rounded-xl text-xs font-bold">
            <button onclick="switchHelpSubtab('articles')" id="subtab-btn-articles" class="px-3 py-1.5 rounded-lg ${currentHelpSubtab === 'articles' ? 'bg-white shadow text-[#1565C0]' : 'text-slate-600'}">
              Guides &amp; Articles (${articles.length})
            </button>
            <button onclick="switchHelpSubtab('categories')" id="subtab-btn-categories" class="px-3 py-1.5 rounded-lg ${currentHelpSubtab === 'categories' ? 'bg-white shadow text-[#1565C0]' : 'text-slate-600'}">
              Categories (${categories.length})
            </button>
          </div>
          ${currentHelpSubtab === 'articles' ? `
            <button onclick="openNewHelpArticleModal()" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-4 py-2 rounded-xl shadow-sm">
              + New Guide
            </button>
          ` : `
            <button onclick="openNewHelpCategoryModal()" class="text-xs font-bold bg-[#1565C0] hover:bg-[#10529C] text-white px-4 py-2 rounded-xl shadow-sm">
              + New Category
            </button>
          `}
        </div>
      </div>

      <div id="help-subtab-content">
        ${currentHelpSubtab === 'articles' ? renderHelpArticlesTable(articles, categories) : renderHelpCategoriesTable(categories)}
      </div>

      <div id="help-modal-wrap"></div>
    </div>
  `;
}

function switchHelpSubtab(subtab) {
  currentHelpSubtab = subtab;
  renderHelpCenterView(document.getElementById('main-content-view'));
}

function renderHelpArticlesTable(articles, categories) {
  const catMap = Object.fromEntries(categories.map(c => [c.id, c.translations?.en?.name || c.id]));

  return `
    <div class="admin-card p-6">
      <div class="overflow-x-auto text-xs">
        <table class="w-full text-left">
          <thead>
            <tr class="border-b border-slate-200 text-slate-400 font-bold">
              <th class="pb-3">Title &amp; Slug</th>
              <th class="pb-3">Category</th>
              <th class="pb-3">Screenshot</th>
              <th class="pb-3">Read Time</th>
              <th class="pb-3">Status</th>
              <th class="pb-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-[#334155]">
            ${articles.map(art => {
              const en = art.translations?.en || {};
              const catName = catMap[art.category_id] || art.category_id;
              return `
                <tr class="hover:bg-slate-50">
                  <td class="py-3">
                    <div class="font-bold text-[#003366]">${en.title || art.slug}</div>
                    <div class="text-[10px] font-mono text-slate-400">/help/${art.slug}</div>
                  </td>
                  <td class="py-3"><span class="px-2 py-0.5 rounded bg-blue-50 text-[#1565C0] font-semibold text-[10px]">${catName}</span></td>
                  <td class="py-3 font-mono text-[10px] text-slate-500">${art.screenshot ? art.screenshot.split('/').pop() : 'None'}</td>
                  <td class="py-3 font-mono text-slate-500">${art.read_time_minutes || 3} min</td>
                  <td class="py-3">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${art.status === 'published' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}">
                      ${(art.status || 'draft').toUpperCase()}
                    </span>
                  </td>
                  <td class="py-3 text-right space-x-2">
                    <a href="/en/help/${art.slug}" target="_blank" class="text-xs font-bold text-slate-500 hover:text-slate-800">View ↗</a>
                    <button onclick="editHelpArticle('${art.slug}')" class="text-xs font-bold text-[#1565C0] hover:underline">Edit</button>
                    <button onclick="deleteHelpArticle('${art.slug}')" class="text-xs font-bold text-rose-600 hover:underline">Delete</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderHelpCategoriesTable(categories) {
  return `
    <div class="admin-card p-6">
      <div class="overflow-x-auto text-xs">
        <table class="w-full text-left">
          <thead>
            <tr class="border-b border-slate-200 text-slate-400 font-bold">
              <th class="pb-3">Icon &amp; ID</th>
              <th class="pb-3">English (EN)</th>
              <th class="pb-3">Indonesian (ID)</th>
              <th class="pb-3">Russian (RU)</th>
              <th class="pb-3">Order</th>
              <th class="pb-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-[#334155]">
            ${categories.map(cat => {
              return `
                <tr class="hover:bg-slate-50">
                  <td class="py-3 font-mono font-bold text-[#003366]">
                    <span class="mr-2 text-base">${cat.icon || '📁'}</span> ${cat.id}
                  </td>
                  <td class="py-3 font-semibold text-slate-700">${cat.translations?.en?.name || ''}</td>
                  <td class="py-3 text-slate-600">${cat.translations?.id?.name || ''}</td>
                  <td class="py-3 text-slate-600">${cat.translations?.ru?.name || ''}</td>
                  <td class="py-3 font-mono text-slate-500">${cat.order || 1}</td>
                  <td class="py-3 text-right space-x-2">
                    <button onclick="editHelpCategory('${cat.id}')" class="text-xs font-bold text-[#1565C0] hover:underline">Edit</button>
                    <button onclick="deleteHelpCategory('${cat.id}')" class="text-xs font-bold text-rose-600 hover:underline">Delete</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function editHelpArticle(slug) {
  const article = await apiFetch(`/help/articles/${slug}`);
  const categories = await apiFetch('/help/categories');
  const en = article.translations?.en || {};
  const idTrans = article.translations?.id || {};
  const ru = article.translations?.ru || {};

  const modalWrap = document.getElementById('help-modal-wrap');
  modalWrap.innerHTML = `
    <div class="fixed inset-0 bg-[#001428]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
          <div>
            <h3 class="font-black text-lg text-[#003366]">Edit Help Guide</h3>
            <span class="text-[10px] font-mono text-slate-400">Slug: ${slug}</span>
          </div>
          <button onclick="document.getElementById('help-modal-wrap').innerHTML=''" class="text-slate-400 hover:text-slate-600 text-lg font-bold">&times;</button>
        </div>

        <div class="space-y-4 text-xs">
          <div class="grid grid-cols-4 gap-4">
            <div>
              <label class="block font-bold text-slate-700 mb-1">Category</label>
              <select id="guide-edit-cat" class="w-full p-2 border border-slate-200 rounded-lg">
                ${categories.map(c => `<option value="${c.id}" ${c.id === article.category_id ? 'selected' : ''}>${c.translations?.en?.name || c.id}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block font-bold text-slate-700 mb-1">Status</label>
              <select id="guide-edit-status" class="w-full p-2 border border-slate-200 rounded-lg">
                <option value="published" ${article.status === 'published' ? 'selected' : ''}>Published</option>
                <option value="draft" ${article.status === 'draft' ? 'selected' : ''}>Draft</option>
              </select>
            </div>
            <div>
              <label class="block font-bold text-slate-700 mb-1">Read Time (min)</label>
              <input type="number" id="guide-edit-read-time" value="${article.read_time_minutes || 3}" class="w-full p-2 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label class="block font-bold text-slate-700 mb-1">Screenshot Asset</label>
              <input type="text" id="guide-edit-screenshot" value="${article.screenshot || ''}" class="w-full p-2 border border-slate-200 rounded-lg font-mono text-[11px]" />
            </div>
          </div>

          <!-- ENGLISH -->
          <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <span class="font-bold text-[#1565C0] uppercase tracking-wider text-[11px]">English (EN)</span>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Title</label>
              <input type="text" id="guide-en-title" value="${en.title || ''}" class="w-full p-2 border border-slate-200 rounded-lg bg-white" />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Objective / Summary</label>
              <textarea id="guide-en-summary" rows="2" class="w-full p-2 border border-slate-200 rounded-lg bg-white">${en.summary || ''}</textarea>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Expected Result</label>
              <textarea id="guide-en-result" rows="2" class="w-full p-2 border border-slate-200 rounded-lg bg-white">${en.expected_result || ''}</textarea>
            </div>
          </div>

          <!-- INDONESIAN -->
          <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <span class="font-bold text-[#1565C0] uppercase tracking-wider text-[11px]">Indonesian (ID)</span>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Title</label>
              <input type="text" id="guide-id-title" value="${idTrans.title || ''}" class="w-full p-2 border border-slate-200 rounded-lg bg-white" />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Objective / Summary</label>
              <textarea id="guide-id-summary" rows="2" class="w-full p-2 border border-slate-200 rounded-lg bg-white">${idTrans.summary || ''}</textarea>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Expected Result</label>
              <textarea id="guide-id-result" rows="2" class="w-full p-2 border border-slate-200 rounded-lg bg-white">${idTrans.expected_result || ''}</textarea>
            </div>
          </div>

          <!-- RUSSIAN -->
          <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <span class="font-bold text-[#1565C0] uppercase tracking-wider text-[11px]">Russian (RU)</span>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Title</label>
              <input type="text" id="guide-ru-title" value="${ru.title || ''}" class="w-full p-2 border border-slate-200 rounded-lg bg-white" />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Objective / Summary</label>
              <textarea id="guide-ru-summary" rows="2" class="w-full p-2 border border-slate-200 rounded-lg bg-white">${ru.summary || ''}</textarea>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Expected Result</label>
              <textarea id="guide-ru-result" rows="2" class="w-full p-2 border border-slate-200 rounded-lg bg-white">${ru.expected_result || ''}</textarea>
            </div>
          </div>
        </div>

        <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
          <button onclick="document.getElementById('help-modal-wrap').innerHTML=''" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button onclick="saveHelpArticle('${slug}')" class="px-5 py-2 text-xs font-bold bg-[#1565C0] hover:bg-[#0052CC] text-white rounded-xl shadow">
            Save Guide Changes
          </button>
        </div>
      </div>
    </div>
  `;
}

async function saveHelpArticle(slug) {
  const article = await apiFetch(`/help/articles/${slug}`);
  if (!article) return;

  article.category_id = document.getElementById('guide-edit-cat').value;
  article.status = document.getElementById('guide-edit-status').value;
  article.read_time_minutes = parseInt(document.getElementById('guide-edit-read-time').value, 10) || 3;
  article.screenshot = document.getElementById('guide-edit-screenshot').value;

  article.translations = article.translations || {};
  article.translations.en = {
    ...article.translations.en,
    title: document.getElementById('guide-en-title').value,
    summary: document.getElementById('guide-en-summary').value,
    expected_result: document.getElementById('guide-en-result').value
  };
  article.translations.id = {
    ...article.translations.id,
    title: document.getElementById('guide-id-title').value,
    summary: document.getElementById('guide-id-summary').value,
    expected_result: document.getElementById('guide-id-result').value
  };
  article.translations.ru = {
    ...article.translations.ru,
    title: document.getElementById('guide-ru-title').value,
    summary: document.getElementById('guide-ru-summary').value,
    expected_result: document.getElementById('guide-ru-result').value
  };

  await apiFetch('/help/articles', {
    method: 'POST',
    body: JSON.stringify(article)
  });

  document.getElementById('help-modal-wrap').innerHTML = '';
  renderHelpCenterView(document.getElementById('main-content-view'));
}

async function deleteHelpArticle(slug) {
  if (!confirm(`Are you sure you want to delete help guide '${slug}'?`)) return;
  await apiFetch(`/help/articles/${slug}`, { method: 'DELETE' });
  renderHelpCenterView(document.getElementById('main-content-view'));
}

async function openNewHelpArticleModal() {
  const categories = await apiFetch('/help/categories');
  const modalWrap = document.getElementById('help-modal-wrap');
  modalWrap.innerHTML = `
    <div class="fixed inset-0 bg-[#001428]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
        <h3 class="font-black text-lg text-[#003366] mb-4">Create New Help Guide</h3>
        <div class="space-y-3 text-xs">
          <div>
            <label class="block font-bold text-slate-700 mb-1">Slug (URL identifier)</label>
            <input type="text" id="new-guide-slug" placeholder="e.g. multi-currency-transfers" class="w-full p-2 border border-slate-200 rounded-lg font-mono text-xs" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">Category</label>
            <select id="new-guide-cat" class="w-full p-2 border border-slate-200 rounded-lg">
              ${categories.map(c => `<option value="${c.id}">${c.translations?.en?.name || c.id}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">Title (English)</label>
            <input type="text" id="new-guide-title" placeholder="How to Record Transfers..." class="w-full p-2 border border-slate-200 rounded-lg text-xs" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">Summary (English)</label>
            <textarea id="new-guide-summary" rows="2" placeholder="Brief guide overview..." class="w-full p-2 border border-slate-200 rounded-lg text-xs"></textarea>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-3">
          <button onclick="document.getElementById('help-modal-wrap').innerHTML=''" class="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
          <button onclick="submitNewHelpArticle()" class="px-5 py-2 text-xs font-bold bg-[#1565C0] hover:bg-[#0052CC] text-white rounded-xl shadow">Create Draft Guide</button>
        </div>
      </div>
    </div>
  `;
}

async function submitNewHelpArticle() {
  const slug = document.getElementById('new-guide-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!slug) return alert('Please enter a valid slug.');

  const newArt = {
    slug,
    category_id: document.getElementById('new-guide-cat').value,
    status: 'draft',
    screenshot: '/assets/screens/Main.png',
    read_time_minutes: 3,
    translations: {
      en: {
        title: document.getElementById('new-guide-title').value.trim() || slug,
        summary: document.getElementById('new-guide-summary').value.trim() || 'New guide overview',
        prerequisites: ['Active CFO AI account'],
        steps: [{ title: 'Open Settings', instruction: 'Navigate to settings tab.', tip: 'Verify credentials' }],
        expected_result: 'Setup complete.',
        troubleshooting: [{ issue: 'Missing permissions', solution: 'Contact company admin' }]
      },
      id: {
        title: document.getElementById('new-guide-title').value.trim() || slug,
        summary: 'Ringkasan panduan baru',
        prerequisites: ['Akun CFO AI aktif'],
        steps: [{ title: 'Buka Pengaturan', instruction: 'Arahkan ke tab pengaturan.', tip: 'Verifikasi izin' }],
        expected_result: 'Pengaturan selesai.',
        troubleshooting: [{ issue: 'Kurang izin', solution: 'Hubungi admin' }]
      },
      ru: {
        title: document.getElementById('new-guide-title').value.trim() || slug,
        summary: 'Обзор нового руководства',
        prerequisites: ['Активная учетная запись CFO AI'],
        steps: [{ title: 'Открыть настройки', instruction: 'Перейдите в настройки.', tip: 'Проверьте права' }],
        expected_result: 'Настройка завершена.',
        troubleshooting: [{ issue: 'Недостаточно прав', solution: 'Свяжитесь с админом' }]
      }
    }
  };

  await apiFetch('/help/articles', {
    method: 'POST',
    body: JSON.stringify(newArt)
  });

  document.getElementById('help-modal-wrap').innerHTML = '';
  renderHelpCenterView(document.getElementById('main-content-view'));
}

async function editHelpCategory(id) {
  const categories = await apiFetch('/help/categories');
  const cat = categories.find(c => c.id === id);
  if (!cat) return;

  const modalWrap = document.getElementById('help-modal-wrap');
  modalWrap.innerHTML = `
    <div class="fixed inset-0 bg-[#001428]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
        <h3 class="font-black text-lg text-[#003366] mb-4">Edit Category: ${cat.id}</h3>
        <div class="space-y-3 text-xs">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-bold text-slate-700 mb-1">Icon</label>
              <input type="text" id="cat-edit-icon" value="${cat.icon || '📁'}" class="w-full p-2 border border-slate-200 rounded-lg text-xs" />
            </div>
            <div>
              <label class="block font-bold text-slate-700 mb-1">Order</label>
              <input type="number" id="cat-edit-order" value="${cat.order || 1}" class="w-full p-2 border border-slate-200 rounded-lg text-xs" />
            </div>
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">Name (English)</label>
            <input type="text" id="cat-edit-en" value="${cat.translations?.en?.name || ''}" class="w-full p-2 border border-slate-200 rounded-lg text-xs" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">Name (Indonesian)</label>
            <input type="text" id="cat-edit-id" value="${cat.translations?.id?.name || ''}" class="w-full p-2 border border-slate-200 rounded-lg text-xs" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">Name (Russian)</label>
            <input type="text" id="cat-edit-ru" value="${cat.translations?.ru?.name || ''}" class="w-full p-2 border border-slate-200 rounded-lg text-xs" />
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-3">
          <button onclick="document.getElementById('help-modal-wrap').innerHTML=''" class="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
          <button onclick="saveHelpCategorySubmit('${cat.id}')" class="px-5 py-2 text-xs font-bold bg-[#1565C0] hover:bg-[#0052CC] text-white rounded-xl shadow">Save Category</button>
        </div>
      </div>
    </div>
  `;
}

async function saveHelpCategorySubmit(id) {
  const categories = await apiFetch('/help/categories');
  const cat = categories.find(c => c.id === id);
  if (!cat) return;

  cat.icon = document.getElementById('cat-edit-icon').value.trim();
  cat.order = parseInt(document.getElementById('cat-edit-order').value, 10) || 1;
  cat.translations = cat.translations || {};
  cat.translations.en = { ...cat.translations.en, name: document.getElementById('cat-edit-en').value.trim() };
  cat.translations.id = { ...cat.translations.id, name: document.getElementById('cat-edit-id').value.trim() };
  cat.translations.ru = { ...cat.translations.ru, name: document.getElementById('cat-edit-ru').value.trim() };

  await apiFetch('/help/categories', {
    method: 'POST',
    body: JSON.stringify(cat)
  });

  document.getElementById('help-modal-wrap').innerHTML = '';
  renderHelpCenterView(document.getElementById('main-content-view'));
}

async function deleteHelpCategory(id) {
  if (!confirm(`Are you sure you want to delete category '${id}'?`)) return;
  await apiFetch(`/help/categories/${id}`, { method: 'DELETE' });
  renderHelpCenterView(document.getElementById('main-content-view'));
}

// ==========================================
// 12. MEDIA LIBRARY & SECURE UPLOADER (TASK 4.E)
// ==========================================
let currentMediaCategory = 'all';

async function renderMediaView(container) {
  const media = await apiFetch('/media');
  const filtered = currentMediaCategory === 'all' ? media : media.filter(m => m.category.toLowerCase().includes(currentMediaCategory));

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-black text-[#003366]">Media Library &amp; Asset Vault</h1>
          <p class="text-xs text-[#5A6E82]">Inspect verified screenshots, brand assets, and upload new interface captures with secure type validation.</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="setMediaFilter('all')" class="text-xs font-bold px-3 py-1.5 rounded-lg ${currentMediaCategory === 'all' ? 'bg-[#1565C0] text-white' : 'bg-slate-100 text-slate-600'}">
            All Assets (${media.length})
          </button>
          <button onclick="setMediaFilter('screenshot')" class="text-xs font-bold px-3 py-1.5 rounded-lg ${currentMediaCategory === 'screenshot' ? 'bg-[#1565C0] text-white' : 'bg-slate-100 text-slate-600'}">
            Screenshots
          </button>
          <button onclick="setMediaFilter('brand')" class="text-xs font-bold px-3 py-1.5 rounded-lg ${currentMediaCategory === 'brand' ? 'bg-[#1565C0] text-white' : 'bg-slate-100 text-slate-600'}">
            Brand &amp; Logos
          </button>
        </div>
      </div>

      <!-- UPLOAD CARD -->
      <div class="admin-card p-6 bg-slate-50/50 border border-dashed border-blue-200">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-blue-100 text-[#1565C0] flex items-center justify-center font-bold text-lg shrink-0">
              📤
            </div>
            <div>
              <div class="font-black text-sm text-[#003366]">Upload Screenshot or Product Image</div>
              <div class="text-[11px] text-slate-500">Allowed formats: PNG, JPG, WEBP, SVG &bull; Maximum file size: 5 MB</div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <input type="file" id="media-upload-input" accept=".png,.jpg,.jpeg,.webp,.svg" class="text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#1565C0] file:text-white hover:file:bg-[#0052CC] file:cursor-pointer" />
            <button onclick="handleMediaUploadSubmit()" id="media-upload-btn" class="text-xs font-bold bg-[#003366] hover:bg-[#002244] text-white px-4 py-2 rounded-xl shadow">
              Upload
            </button>
          </div>
        </div>
        <div id="media-upload-status" class="mt-2 text-xs font-semibold hidden"></div>
      </div>

      <!-- ASSET GRID -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        ${filtered.map(item => {
          const isSvg = item.name.endsWith('.svg');
          const sizeKb = (item.size / 1024).toFixed(1);
          return `
            <div class="admin-card p-3 flex flex-col justify-between group hover:shadow-md transition">
              <div class="h-32 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center relative p-2">
                <img src="${item.path}" alt="${item.name}" class="max-h-full max-w-full object-contain group-hover:scale-105 transition" loading="lazy" />
                <span class="absolute top-2 right-2 text-[9px] bg-slate-900/70 text-white font-mono px-1.5 py-0.5 rounded">
                  ${sizeKb} KB
                </span>
              </div>
              <div class="mt-3">
                <div class="font-bold text-xs text-[#003366] truncate" title="${item.name}">${item.name}</div>
                <div class="text-[10px] text-slate-400 font-mono truncate mb-3">${item.path}</div>
                <div class="flex items-center justify-between">
                  <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">${item.category}</span>
                  <button onclick="copyMediaAssetUrl('${item.path}', this)" class="text-[10px] font-bold text-[#1565C0] hover:text-[#0052CC] bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded">
                    Copy URL
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function setMediaFilter(cat) {
  currentMediaCategory = cat;
  renderMediaView(document.getElementById('main-content-view'));
}

async function handleMediaUploadSubmit() {
  const input = document.getElementById('media-upload-input');
  const statusEl = document.getElementById('media-upload-status');
  const btn = document.getElementById('media-upload-btn');

  if (!input.files || input.files.length === 0) {
    statusEl.innerText = 'Please select a file to upload.';
    statusEl.className = 'mt-2 text-xs font-semibold text-rose-600 block';
    return;
  }

  const file = input.files[0];
  const formData = new FormData();
  formData.append('file', file);

  btn.innerText = 'Uploading...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/media/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}`
      },
      body: formData
    });

    const data = await res.json();
    if (res.ok) {
      statusEl.innerText = `Asset '${data.filename}' uploaded successfully!`;
      statusEl.className = 'mt-2 text-xs font-semibold text-emerald-600 block';
      input.value = '';
      setTimeout(() => {
        renderMediaView(document.getElementById('main-content-view'));
      }, 1000);
    } else {
      statusEl.innerText = data.error || 'Upload failed.';
      statusEl.className = 'mt-2 text-xs font-semibold text-rose-600 block';
    }
  } catch (err) {
    statusEl.innerText = 'Upload failed: ' + err.message;
    statusEl.className = 'mt-2 text-xs font-semibold text-rose-600 block';
  } finally {
    btn.innerText = 'Upload';
    btn.disabled = false;
  }
}

function copyMediaAssetUrl(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.innerText;
    btn.innerText = 'Copied!';
    setTimeout(() => { btn.innerText = orig; }, 1500);
  }).catch(() => {
    prompt('Copy asset path:', url);
  });
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', initApp);
