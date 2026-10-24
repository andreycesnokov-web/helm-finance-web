/**
 * Versioned Content Store & Atomic Release Engine
 * Manages drafts, revisions, publishing manifests, and instant 1-click rollback.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PricingGuard = require('./pricingGuard');

class ContentStore {
  constructor(dataDir) {
    this.defaultBaselineDir = path.join(__dirname, '../data');
    this.dataDir = dataDir || process.env.CMS_DATA_DIR || this.defaultBaselineDir;
    this.releasesDir = path.join(this.dataDir, 'releases');
    this.auditLogPath = path.join(this.dataDir, 'audit_logs.json');
    this.activeReleasePath = path.join(this.dataDir, 'active_release.json');
    this.mediaDir = process.env.CMS_MEDIA_DIR || path.join(this.dataDir, 'media');
    this.mediaMetaPath = path.join(this.dataDir, 'media_metadata.json');

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (!fs.existsSync(this.releasesDir)) {
      fs.mkdirSync(this.releasesDir, { recursive: true });
    }

    if (!fs.existsSync(this.mediaDir)) {
      fs.mkdirSync(this.mediaDir, { recursive: true });
    }

    // Auto-seed persistent volume if custom mounted volume is empty
    this.seedFromBaseline();

    this.pricingGuard = new PricingGuard(path.join(this.dataDir, 'billing_catalog_reference.json'));

    this.ensureInitialized();
  }

  seedFromBaseline() {
    if (path.resolve(this.dataDir) === path.resolve(this.defaultBaselineDir)) {
      return; // Already using repository baseline data directory
    }

    if (!fs.existsSync(this.defaultBaselineDir)) {
      return;
    }

    const baselineFiles = fs.readdirSync(this.defaultBaselineDir);
    for (const file of baselineFiles) {
      if (file.endsWith('.json')) {
        const destPath = path.join(this.dataDir, file);
        if (!fs.existsSync(destPath)) {
          const srcPath = path.join(this.defaultBaselineDir, file);
          try {
            fs.copyFileSync(srcPath, destPath);
            console.log(`[ContentStore] Seeded persistent volume with baseline: ${file}`);
          } catch (err) {
            console.error(`[ContentStore] Failed to seed ${file}:`, err.message);
          }
        }
      }
    }

    // Seed baseline releases if releases directory is empty
    const baselineReleasesDir = path.join(this.defaultBaselineDir, 'releases');
    if (fs.existsSync(baselineReleasesDir)) {
      const releaseFiles = fs.readdirSync(baselineReleasesDir);
      for (const rf of releaseFiles) {
        const destRf = path.join(this.releasesDir, rf);
        if (!fs.existsSync(destRf)) {
          try {
            fs.copyFileSync(path.join(baselineReleasesDir, rf), destRf);
          } catch (e) {}
        }
      }
    }
  }

  readJson(filename) {
    const fullPath = path.join(this.dataDir, filename);
    if (!fs.existsSync(fullPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (err) {
      console.error(`[ContentStore] Error reading JSON from ${filename}:`, err.message);
      return null;
    }
  }

  writeJson(filename, data) {
    const fullPath = path.join(this.dataDir, filename);
    const tmpPath = `${fullPath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 6)}`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, fullPath);
    } catch (err) {
      // Fallback if atomic rename fails on certain network file systems
      try {
        fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
      } finally {
        if (fs.existsSync(tmpPath)) {
          try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
      }
    }
  }

  ensureInitialized() {
    if (!fs.existsSync(this.auditLogPath)) {
      this.writeJson('audit_logs.json', []);
    }

    if (!fs.existsSync(this.activeReleasePath)) {
      // Create initial baseline release
      this.createRelease({
        author: 'system',
        notes: 'Initial Baseline Release Candidate v1.0.0'
      });
    }
  }

  logAudit(actor, action, entity, details) {
    const logs = this.readJson('audit_logs.json') || [];
    const entry = {
      id: `aud-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      actor,
      action,
      entity,
      details
    };
    logs.unshift(entry);
    // Keep last 1,000 logs
    if (logs.length > 1000) logs.pop();
    this.writeJson('audit_logs.json', logs);
    return entry;
  }

  getAuditLogs(limit = 50) {
    const logs = this.readJson('audit_logs.json') || [];
    return logs.slice(0, limit);
  }

  // --- ENTITY GETTERS ---

  getPages() {
    return this.readJson('pages.json') || [];
  }

  getPage(slug) {
    const pages = this.getPages();
    return pages.find(p => p.slug === slug) || null;
  }

  getPricing() {
    return this.readJson('pricing.json') || {};
  }

  getIntegrations() {
    return this.readJson('integrations.json') || [];
  }

  getHelpCategories() {
    return this.readJson('help_categories.json') || [];
  }

  getHelpArticles() {
    return this.readJson('help_articles.json') || [];
  }

  getHelpArticle(slug) {
    const articles = this.getHelpArticles();
    return articles.find(a => a.slug === slug || a.id === slug) || null;
  }

  getHubCategories() {
    return this.readJson('hub_categories.json') || [];
  }

  getHubArticles() {
    return this.readJson('hub_articles.json') || [];
  }

  getHubArticle(slug) {
    const articles = this.getHubArticles();
    return articles.find(a => a.slug === slug) || null;
  }

  getHubBriefs() {
    return this.readJson('hub_briefs.json') || [];
  }

  getSeo() {
    return this.readJson('seo.json') || {};
  }

  getNavigation() {
    return this.readJson('navigation.json') || {};
  }

  getLocales() {
    return this.readJson('locales.json') || [];
  }

  getUsers() {
    return this.readJson('users.json') || [];
  }

  saveUser(userData, user = 'system') {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === userData.id || (userData.email && u.email && u.email.toLowerCase() === userData.email.toLowerCase()));
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...userData, updated_at: new Date().toISOString() };
    } else {
      users.push({
        ...userData,
        id: userData.id || `usr-${Date.now()}`,
        created_at: new Date().toISOString()
      });
    }
    this.writeJson('users.json', users);
    this.logAudit(user, 'save_user', `user:${userData.email}`);
    return users.find(u => u.email && userData.email && u.email.toLowerCase() === userData.email.toLowerCase());
  }

  getUserByEmail(email) {
    if (!email) return null;
    const users = this.getUsers();
    const cleanEmail = email.trim().toLowerCase();
    let user = users.find(u => u.email && u.email.toLowerCase() === cleanEmail);
    if (!user && (cleanEmail === 'owner@cfo-ai.site' || cleanEmail === 'admin@cfo-ai.site')) {
      user = users.find(u => u.role === 'owner');
    }
    return user || null;
  }

  getUserByResetToken(token) {
    if (!token) return null;
    const users = this.getUsers();
    return users.find(u => u.reset_token === token && u.reset_token_expires && new Date(u.reset_token_expires) > new Date()) || null;
  }

  // --- ENTITY MUTATIONS (DRAFT / EDIT) ---

  updatePage(slug, pageData, user = 'editor') {
    const pages = this.getPages();
    const index = pages.findIndex(p => p.slug === slug);
    if (index === -1) {
      pageData.slug = slug;
      pageData.updated_at = new Date().toISOString();
      pages.push(pageData);
    } else {
      pages[index] = { ...pages[index], ...pageData, updated_at: new Date().toISOString() };
    }
    this.writeJson('pages.json', pages);
    this.logAudit(user, 'update_page', `page:${slug}`, { title: pageData.title });
    return pages[index >= 0 ? index : pages.length - 1];
  }

  updatePricing(pricingData, user = 'owner') {
    // Validate against Pricing Guard
    const validation = this.pricingGuard.validatePricing(pricingData);
    pricingData.updated_at = new Date().toISOString();
    pricingData.updated_by = user;

    this.writeJson('pricing.json', pricingData);
    this.logAudit(user, 'update_pricing', 'pricing', { 
      isValid: validation.isValid, 
      discrepancyCount: validation.discrepancies.length 
    });

    return {
      pricing: pricingData,
      validation
    };
  }

  saveArticle(articleData, user = 'editor') {
    const articles = this.getHubArticles();
    let isNew = false;
    let targetIndex = articles.findIndex(a => a.id === articleData.id || a.slug === articleData.slug);

    if (targetIndex === -1) {
      isNew = true;
      articleData.id = articleData.id || `art-${Date.now()}`;
      articleData.publication_date = articleData.publication_date || new Date().toISOString();
      articleData.last_updated = new Date().toISOString();
      articles.push(articleData);
      targetIndex = articles.length - 1;
    } else {
      articles[targetIndex] = {
        ...articles[targetIndex],
        ...articleData,
        last_updated: new Date().toISOString()
      };
    }

    this.writeJson('hub_articles.json', articles);
    this.logAudit(user, isNew ? 'create_article' : 'update_article', `article:${articles[targetIndex].slug}`, {
      title: articles[targetIndex].translations?.en?.title || articles[targetIndex].slug,
      status: articles[targetIndex].review_status
    });

    return articles[targetIndex];
  }

  deleteArticle(slug, user = 'owner') {
    const articles = this.getHubArticles();
    const filtered = articles.filter(a => a.slug !== slug);
    if (filtered.length !== articles.length) {
      this.writeJson('hub_articles.json', filtered);
      this.logAudit(user, 'delete_article', `article:${slug}`, {});
      return true;
    }
    return false;
  }

  updateSeo(seoData, user = 'owner') {
    this.writeJson('seo.json', seoData);
    this.logAudit(user, 'update_seo', 'seo', {});
    return seoData;
  }

  updateNavigation(navData, user = 'owner') {
    this.writeJson('navigation.json', navData);
    this.logAudit(user, 'update_navigation', 'navigation', {});
    return navData;
  }

  // --- MEDIA METADATA MANAGEMENT ---
  getMediaMetadata() {
    return this.readJson('media_metadata.json') || {};
  }

  saveMediaMetadata(metadata, user = 'editor') {
    this.writeJson('media_metadata.json', metadata);
    this.logAudit(user, 'update_media_metadata', 'media', {});
    return metadata;
  }

  updateMediaItemMetadata(filename, itemData, user = 'editor') {
    const meta = this.getMediaMetadata();
    meta[filename] = {
      ...(meta[filename] || {}),
      ...itemData,
      updated_at: new Date().toISOString()
    };
    this.writeJson('media_metadata.json', meta);
    this.logAudit(user, 'update_media_item', `media:${filename}`, { alt: itemData.alt });
    return meta[filename];
  }

  // --- INTEGRATIONS MANAGEMENT ---
  saveIntegration(id, data, user = 'editor') {
    const list = this.getIntegrations();
    const index = list.findIndex(item => item.id === (id || data.id));
    if (index === -1) {
      data.id = id || data.id || `integ-${Date.now()}`;
      list.push(data);
    } else {
      list[index] = { ...list[index], ...data };
    }
    this.writeJson('integrations.json', list);
    this.logAudit(user, index === -1 ? 'create_integration' : 'update_integration', `integration:${data.id}`, { name: data.name, status: data.status });
    return list[index >= 0 ? index : list.length - 1];
  }

  deleteIntegration(id, user = 'owner') {
    const list = this.getIntegrations();
    const filtered = list.filter(item => item.id !== id);
    if (filtered.length !== list.length) {
      this.writeJson('integrations.json', filtered);
      this.logAudit(user, 'delete_integration', `integration:${id}`, {});
      return true;
    }
    return false;
  }

  // --- HELP CENTER MANAGEMENT ---
  saveHelpCategory(catData, user = 'editor') {
    const categories = this.getHelpCategories();
    const index = categories.findIndex(c => c.id === catData.id);
    if (index === -1) {
      catData.id = catData.id || `cat-${Date.now()}`;
      categories.push(catData);
    } else {
      categories[index] = { ...categories[index], ...catData };
    }
    this.writeJson('help_categories.json', categories);
    this.logAudit(user, index === -1 ? 'create_help_category' : 'update_help_category', `help_category:${catData.id}`, { name: catData.translations?.en?.name });
    return categories[index >= 0 ? index : categories.length - 1];
  }

  deleteHelpCategory(id, user = 'owner') {
    const categories = this.getHelpCategories();
    const filtered = categories.filter(c => c.id !== id);
    if (filtered.length !== categories.length) {
      this.writeJson('help_categories.json', filtered);
      this.logAudit(user, 'delete_help_category', `help_category:${id}`, {});
      return true;
    }
    return false;
  }

  saveHelpArticle(articleData, user = 'editor') {
    const articles = this.getHelpArticles();
    let isNew = false;
    let targetIndex = articles.findIndex(a => a.id === articleData.id || a.slug === articleData.slug);

    if (targetIndex === -1) {
      isNew = true;
      articleData.id = articleData.id || `art-help-${Date.now()}`;
      articleData.last_updated = new Date().toISOString();
      articles.push(articleData);
      targetIndex = articles.length - 1;
    } else {
      articles[targetIndex] = {
        ...articles[targetIndex],
        ...articleData,
        last_updated: new Date().toISOString()
      };
    }

    this.writeJson('help_articles.json', articles);
    this.logAudit(user, isNew ? 'create_help_article' : 'update_help_article', `help_article:${articles[targetIndex].slug}`, {
      title: articles[targetIndex].translations?.en?.title || articles[targetIndex].slug,
      status: articles[targetIndex].review_status
    });

    return articles[targetIndex];
  }

  deleteHelpArticle(slug, user = 'owner') {
    const articles = this.getHelpArticles();
    const filtered = articles.filter(a => a.slug !== slug && a.id !== slug);
    if (filtered.length !== articles.length) {
      this.writeJson('help_articles.json', filtered);
      this.logAudit(user, 'delete_help_article', `help_article:${slug}`, {});
      return true;
    }
    return false;
  }

  // --- PUBLISHING & ROLLBACK (ATOMIC RELEASES) ---

  getActiveRelease() {
    return this.readJson('active_release.json');
  }

  getReleases() {
    const files = fs.readdirSync(this.releasesDir).filter(f => f.endsWith('.json'));
    const releases = [];
    files.forEach(f => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(this.releasesDir, f), 'utf8'));
        releases.push(r);
      } catch (err) {
        console.error(`Error reading release ${f}:`, err);
      }
    });

    // Sort descending by timestamp
    return releases.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  createRelease({ author = 'owner', notes = 'Commercial Website Release' }) {
    // 1. Mandatory Guard check on pricing (cannot be bypassed)
    const pricing = this.getPricing();
    const pricingValidation = this.pricingGuard.validatePricing(pricing);

    if (!pricingValidation.isValid) {
      throw new Error(`Atomic publish blocked by Pricing Discrepancy Guard. Discrepancies found: ${pricingValidation.discrepancies.map(d => d.message).join('; ')}`);
    }

    // 2. Snapshot current state
    const snapshot = {
      pages: this.getPages(),
      pricing: this.getPricing(),
      integrations: this.getIntegrations(),
      hub_categories: this.getHubCategories(),
      hub_articles: this.getHubArticles(),
      help_categories: this.getHelpCategories(),
      help_articles: this.getHelpArticles(),
      navigation: this.getNavigation(),
      seo: this.getSeo(),
      locales: this.getLocales()
    };

    const snapshotString = JSON.stringify(snapshot);
    const hash = crypto.createHash('sha256').update(snapshotString).digest('hex').substring(0, 8);
    const timestamp = new Date().toISOString();
    const releaseId = `rel-${Date.now()}-${hash}`;

    const releaseManifest = {
      release_id: releaseId,
      version: `v${new Date().toISOString().replace(/\D/g, '').substring(0, 12)}`,
      hash,
      created_at: timestamp,
      author,
      notes,
      pricing_validation: pricingValidation,
      snapshot
    };

    // 3. Write immutable release manifest
    const releaseFile = path.join(this.releasesDir, `${releaseId}.json`);
    fs.writeFileSync(releaseFile, JSON.stringify(releaseManifest, null, 2), 'utf8');

    // 4. Atomically point active release to this new release
    const activePointer = {
      release_id: releaseId,
      version: releaseManifest.version,
      hash,
      activated_at: timestamp,
      activated_by: author,
      notes
    };
    this.writeJson('active_release.json', activePointer);

    this.logAudit(author, 'publish_release', `release:${releaseId}`, { version: releaseManifest.version, hash, notes });

    return releaseManifest;
  }

  saveReleaseManifest(release) {
    if (!release || !release.release_id) return null;
    const releaseFile = path.join(this.releasesDir, `${release.release_id}.json`);
    fs.writeFileSync(releaseFile, JSON.stringify(release, null, 2), 'utf8');
    return release;
  }

  rollbackRelease(targetReleaseId, author = 'owner') {
    const targetFile = path.join(this.releasesDir, `${targetReleaseId}.json`);
    if (!fs.existsSync(targetFile)) {
      throw new Error(`Target release '${targetReleaseId}' does not exist.`);
    }

    const targetManifest = JSON.parse(fs.readFileSync(targetFile, 'utf8'));

    // Restore snapshot into working data
    this.writeJson('pages.json', targetManifest.snapshot.pages);
    this.writeJson('pricing.json', targetManifest.snapshot.pricing);
    if (targetManifest.snapshot.integrations) {
      this.writeJson('integrations.json', targetManifest.snapshot.integrations);
    }
    this.writeJson('hub_categories.json', targetManifest.snapshot.hub_categories);
    this.writeJson('hub_articles.json', targetManifest.snapshot.hub_articles);
    if (targetManifest.snapshot.help_categories) {
      this.writeJson('help_categories.json', targetManifest.snapshot.help_categories);
    }
    if (targetManifest.snapshot.help_articles) {
      this.writeJson('help_articles.json', targetManifest.snapshot.help_articles);
    }
    this.writeJson('navigation.json', targetManifest.snapshot.navigation);
    this.writeJson('seo.json', targetManifest.snapshot.seo);
    this.writeJson('locales.json', targetManifest.snapshot.locales);

    // Atomically swap active pointer
    const timestamp = new Date().toISOString();
    const activePointer = {
      release_id: targetManifest.release_id,
      version: targetManifest.version,
      hash: targetManifest.hash,
      activated_at: timestamp,
      activated_by: author,
      notes: `Rolled back to ${targetManifest.version} (${targetManifest.notes})`
    };
    this.writeJson('active_release.json', activePointer);

    this.logAudit(author, 'rollback_release', `release:${targetReleaseId}`, {
      version: targetManifest.version,
      hash: targetManifest.hash
    });

    return activePointer;
  }
}

module.exports = ContentStore;
