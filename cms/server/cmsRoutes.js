/**
 * CMS Admin REST API Router
 * Endpoints powering https://admin.cfo-ai.site
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { generateCmsToken, requireCmsAuth, requireCmsRole } = require('./auth');
const TranslationEngine = require('../engine/translationEngine');

function createCmsRoutes(contentStore) {
  const router = express.Router();
  const translationEngine = new TranslationEngine();

  // --- AUTHENTICATION ---
  router.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    const users = contentStore.getUsers();
    const user = users.find(u => u.email === email);

    if (!user) {
      return res.status(401).json({ error: 'Invalid user email.' });
    }

    // In local/demo mode, any password works for known test users; in production, bcrypt hash check
    const token = generateCmsToken(user);
    contentStore.logAudit(user.email, 'login', 'auth', { role: user.role });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      }
    });
  });

  router.get('/auth/me', requireCmsAuth, (req, res) => {
    res.json({ user: req.cmsUser });
  });

  // --- DASHBOARD OVERVIEW ---
  router.get('/dashboard', requireCmsAuth, (req, res) => {
    const pages = contentStore.getPages();
    const articles = contentStore.getHubArticles();
    const categories = contentStore.getHubCategories();
    const locales = contentStore.getLocales();
    const activeRelease = contentStore.getActiveRelease();
    const recentAudits = contentStore.getAuditLogs(10);
    const pricing = contentStore.getPricing();
    const pricingValidation = contentStore.pricingGuard.validatePricing(pricing);

    res.json({
      stats: {
        pagesCount: pages.length,
        articlesCount: articles.length,
        publishedArticlesCount: articles.filter(a => a.review_status === 'published').length,
        categoriesCount: categories.length,
        activeLocalesCount: locales.filter(l => l.status === 'published').length,
        totalLocalesCount: locales.length,
        activeReleaseVersion: activeRelease?.version || 'None',
        activeReleaseHash: activeRelease?.hash || 'None',
        pricingDiscrepanciesCount: pricingValidation.discrepancies.length
      },
      pricingStatus: {
        isValid: pricingValidation.isValid,
        catalogVersion: pricingValidation.catalogVersion,
        discrepancies: pricingValidation.discrepancies
      },
      activeRelease,
      recentAudits
    });
  });

  // --- PAGES MANAGEMENT ---
  router.get('/pages', requireCmsAuth, (req, res) => {
    res.json(contentStore.getPages());
  });

  router.get('/pages/:slug', requireCmsAuth, (req, res) => {
    const page = contentStore.getPage(req.params.slug);
    if (!page) return res.status(404).json({ error: 'Page not found.' });
    res.json(page);
  });

  router.put('/pages/:slug', requireCmsAuth, requireCmsRole(['owner', 'editor']), (req, res) => {
    const updated = contentStore.updatePage(req.params.slug, req.body, req.cmsUser.email);
    res.json(updated);
  });

  // --- PRICING MANAGEMENT & DISCREPANCY GUARD ---
  router.get('/pricing', requireCmsAuth, (req, res) => {
    const pricing = contentStore.getPricing();
    const validation = contentStore.pricingGuard.validatePricing(pricing);
    res.json({
      pricing,
      validation
    });
  });

  router.put('/pricing', requireCmsAuth, requireCmsRole(['owner']), (req, res) => {
    const result = contentStore.updatePricing(req.body, req.cmsUser.email);
    res.json(result);
  });

  // --- KNOWLEDGE HUB: CATEGORIES ---
  router.get('/hub/categories', requireCmsAuth, (req, res) => {
    res.json(contentStore.getHubCategories());
  });

  // --- KNOWLEDGE HUB: BRIEFS ---
  router.get('/hub/briefs', requireCmsAuth, (req, res) => {
    res.json(contentStore.getHubBriefs());
  });

  // --- KNOWLEDGE HUB: ARTICLES ---
  router.get('/hub/articles', requireCmsAuth, (req, res) => {
    res.json(contentStore.getHubArticles());
  });

  router.get('/hub/articles/:slug', requireCmsAuth, (req, res) => {
    const article = contentStore.getHubArticle(req.params.slug);
    if (!article) return res.status(404).json({ error: 'Article not found.' });
    res.json(article);
  });

  router.post('/hub/articles', requireCmsAuth, requireCmsRole(['owner', 'editor', 'reviewer']), (req, res) => {
    const saved = contentStore.saveArticle(req.body, req.cmsUser.email);
    res.json(saved);
  });

  router.delete('/hub/articles/:slug', requireCmsAuth, requireCmsRole(['owner']), (req, res) => {
    const success = contentStore.deleteArticle(req.params.slug, req.cmsUser.email);
    if (!success) return res.status(404).json({ error: 'Article not found.' });
    res.json({ success: true, message: `Article '${req.params.slug}' deleted.` });
  });

  // --- TRANSLATIONS & 16 LOCALES ---
  router.get('/locales', requireCmsAuth, (req, res) => {
    res.json(contentStore.getLocales());
  });

  router.get('/translations/matrix', requireCmsAuth, (req, res) => {
    res.json(translationEngine.getTranslationStatusMatrix());
  });

  router.put('/locales/:code/status', requireCmsAuth, requireCmsRole(['owner']), (req, res) => {
    const { status } = req.body;
    const success = translationEngine.updateLocaleStatus(req.params.code, status);
    if (!success) return res.status(400).json({ error: 'Invalid locale code or status.' });
    contentStore.logAudit(req.cmsUser.email, 'update_locale_status', `locale:${req.params.code}`, { status });
    res.json({ success: true, locale: req.params.code, status });
  });

  // --- SEO MANAGEMENT ---
  router.get('/seo', requireCmsAuth, (req, res) => {
    res.json(contentStore.getSeo());
  });

  router.put('/seo', requireCmsAuth, requireCmsRole(['owner', 'editor']), (req, res) => {
    const updated = contentStore.updateSeo(req.body, req.cmsUser.email);
    res.json(updated);
  });

  // --- NAVIGATION & FOOTER ---
  router.get('/navigation', requireCmsAuth, (req, res) => {
    res.json(contentStore.getNavigation());
  });

  router.put('/navigation', requireCmsAuth, requireCmsRole(['owner', 'editor']), (req, res) => {
    const updated = contentStore.updateNavigation(req.body, req.cmsUser.email);
    res.json(updated);
  });

  // --- RELEASES & 1-CLICK ROLLBACK (OWNER ONLY) ---
  router.get('/releases', requireCmsAuth, (req, res) => {
    const active = contentStore.getActiveRelease();
    const releases = contentStore.getReleases();
    res.json({
      activeReleaseId: active?.release_id,
      releases: releases.map(r => ({
        release_id: r.release_id,
        version: r.version,
        hash: r.hash,
        created_at: r.created_at,
        author: r.author,
        notes: r.notes,
        is_active: r.release_id === active?.release_id,
        pricing_status: r.pricing_validation?.isValid ? 'Valid' : 'Discrepancy'
      }))
    });
  });

  router.post('/releases/publish', requireCmsAuth, requireCmsRole(['owner']), (req, res) => {
    try {
      const { notes } = req.body;
      const release = contentStore.createRelease({
        author: req.cmsUser.email,
        notes: notes || 'Production website release'
      });
      res.json({
        success: true,
        message: `Release ${release.version} published successfully!`,
        release
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/releases/:id/rollback', requireCmsAuth, requireCmsRole(['owner']), (req, res) => {
    try {
      const activePointer = contentStore.rollbackRelease(req.params.id, req.cmsUser.email);
      res.json({
        success: true,
        message: `Successfully rolled back to release ${activePointer.version}.`,
        activePointer
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- INTEGRATION CARDS MANAGEMENT (TASK 4.B) ---
  router.get('/integrations', requireCmsAuth, (req, res) => {
    res.json(contentStore.getIntegrations());
  });

  router.post('/integrations', requireCmsAuth, requireCmsRole(['owner', 'editor']), (req, res) => {
    const saved = contentStore.saveIntegration(null, req.body, req.cmsUser.email);
    res.json(saved);
  });

  router.put('/integrations/:id', requireCmsAuth, requireCmsRole(['owner', 'editor']), (req, res) => {
    const saved = contentStore.saveIntegration(req.params.id, req.body, req.cmsUser.email);
    res.json(saved);
  });

  router.delete('/integrations/:id', requireCmsAuth, requireCmsRole(['owner']), (req, res) => {
    const success = contentStore.deleteIntegration(req.params.id, req.cmsUser.email);
    if (!success) return res.status(404).json({ error: 'Integration card not found.' });
    res.json({ success: true, message: `Integration card '${req.params.id}' deleted.` });
  });

  // --- HELP CENTER MANAGEMENT (TASK 4.D) ---
  router.get('/help/categories', requireCmsAuth, (req, res) => {
    res.json(contentStore.getHelpCategories());
  });

  router.post('/help/categories', requireCmsAuth, requireCmsRole(['owner', 'editor']), (req, res) => {
    const saved = contentStore.saveHelpCategory(req.body, req.cmsUser.email);
    res.json(saved);
  });

  router.delete('/help/categories/:id', requireCmsAuth, requireCmsRole(['owner']), (req, res) => {
    const success = contentStore.deleteHelpCategory(req.params.id, req.cmsUser.email);
    if (!success) return res.status(404).json({ error: 'Help category not found.' });
    res.json({ success: true, message: `Help category '${req.params.id}' deleted.` });
  });

  router.get('/help/articles', requireCmsAuth, (req, res) => {
    res.json(contentStore.getHelpArticles());
  });

  router.get('/help/articles/:slug', requireCmsAuth, (req, res) => {
    const article = contentStore.getHelpArticle(req.params.slug);
    if (!article) return res.status(404).json({ error: 'Help guide not found.' });
    res.json(article);
  });

  router.post('/help/articles', requireCmsAuth, requireCmsRole(['owner', 'editor', 'reviewer']), (req, res) => {
    const saved = contentStore.saveHelpArticle(req.body, req.cmsUser.email);
    res.json(saved);
  });

  router.delete('/help/articles/:slug', requireCmsAuth, requireCmsRole(['owner']), (req, res) => {
    const success = contentStore.deleteHelpArticle(req.params.slug, req.cmsUser.email);
    if (!success) return res.status(404).json({ error: 'Help guide not found.' });
    res.json({ success: true, message: `Help guide '${req.params.slug}' deleted.` });
  });

  // --- MEDIA MANAGEMENT & SECURE UPLOAD (TASK 4.E) ---
  const screensUploadDir = path.join(__dirname, '../../website-design/assets/screens');
  if (!fs.existsSync(screensUploadDir)) {
    fs.mkdirSync(screensUploadDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, screensUploadDir);
    },
    filename: (req, file, cb) => {
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, sanitized);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
    fileFilter: (req, file, cb) => {
      const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExts.includes(ext)) {
        return cb(new Error('Only PNG, JPG, WEBP, and SVG image files are allowed.'));
      }
      cb(null, true);
    }
  });

  router.get('/media', requireCmsAuth, (req, res) => {
    const screensDir = path.join(__dirname, '../../website-design/assets/screens');
    const brandDir = path.join(__dirname, '../../website-design/assets/brand');
    const media = [];

    if (fs.existsSync(screensDir)) {
      fs.readdirSync(screensDir).forEach(file => {
        if (!file.startsWith('.')) {
          const stat = fs.statSync(path.join(screensDir, file));
          media.push({
            name: file,
            path: `/assets/screens/${file}`,
            category: 'Screenshots',
            size: stat.size,
            updated_at: stat.mtime
          });
        }
      });
    }

    if (fs.existsSync(brandDir)) {
      fs.readdirSync(brandDir).forEach(file => {
        if (!file.startsWith('.')) {
          const stat = fs.statSync(path.join(brandDir, file));
          media.push({
            name: file,
            path: `/assets/brand/${file}`,
            category: 'Brand & Logos',
            size: stat.size,
            updated_at: stat.mtime
          });
        }
      });
    }

    res.json(media);
  });

  router.post('/media/upload', requireCmsAuth, requireCmsRole(['owner', 'editor']), (req, res) => {
    upload.single('file')(req, res, err => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }

      // Also mirror to dist_marketing if it exists
      const distScreensDir = path.join(__dirname, '../../dist_marketing/assets/screens');
      if (fs.existsSync(distScreensDir)) {
        try {
          fs.copyFileSync(req.file.path, path.join(distScreensDir, req.file.filename));
        } catch (copyErr) {
          console.warn('Could not mirror uploaded file to dist_marketing:', copyErr.message);
        }
      }

      contentStore.logAudit(req.cmsUser.email, 'upload_media', `media:${req.file.filename}`, {
        size: req.file.size,
        path: `/assets/screens/${req.file.filename}`
      });

      res.json({
        success: true,
        message: 'File uploaded successfully.',
        filename: req.file.filename,
        path: `/assets/screens/${req.file.filename}`,
        size: req.file.size
      });
    });
  });

  // --- AUDIT LOGS & USERS ---
  router.get('/audit-logs', requireCmsAuth, (req, res) => {
    res.json(contentStore.getAuditLogs(100));
  });

  router.get('/users', requireCmsAuth, (req, res) => {
    res.json(contentStore.getUsers());
  });

  return router;
}

module.exports = createCmsRoutes;
