/**
 * CFO AI Commercial Website & CMS Server
 * Dual-surface engine serving https://cfo-ai.site and https://admin.cfo-ai.site
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const ContentStore = require('../engine/contentStore');
const createCmsRoutes = require('./cmsRoutes');
const createPublicRoutes = require('./publicRoutes');

function createApp() {
  const app = express();
  const dataDirectory = process.env.CMS_DATA_DIR || path.join(__dirname, '../data');
  const contentStore = new ContentStore(dataDirectory);

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoints for Railway / container orchestrators
  app.get('/health', (req, res) => {
    const release = contentStore.getActiveRelease();
    res.json({
      status: 'ok',
      service: 'cfo-marketing-staging',
      commit: 'ee3a4e5',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      activeReleaseId: release ? release.id : null,
      dataDirectory: dataDirectory
    });
  });

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Optional HTTP Basic Auth gateway for /admin if CMS_BASIC_AUTH_PASS is set
  const basicPass = process.env.CMS_BASIC_AUTH_PASS;
  if (basicPass) {
    const basicUser = process.env.CMS_BASIC_AUTH_USER || 'admin';
    const crypto = require('crypto');
    app.use('/admin', (req, res, next) => {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Basic ')) {
        const credentials = authHeader.split(' ')[1];
        if (credentials) {
          const decoded = Buffer.from(credentials, 'base64').toString('utf8');
          const [u, p] = decoded.split(':');
          if (u === basicUser && p) {
            const bufP = Buffer.from(p);
            const bufExpected = Buffer.from(basicPass);
            if (bufP.length === bufExpected.length && crypto.timingSafeEqual(bufP, bufExpected)) {
              return next();
            }
          }
        }
      }
      res.setHeader('WWW-Authenticate', 'Basic realm="CFO AI Staging Studio"');
      return res.status(401).send('Staging authentication required.');
    });
  }

  // Serve static assets from website-design/assets (SVGs, screenshots, logos)
  app.use('/assets', express.static(path.join(__dirname, '../../website-design/assets')));

  // Serve CMS Admin frontend assets
  app.use('/admin', express.static(path.join(__dirname, '../admin')));

  // Mount CMS REST API
  app.use('/api/cms', createCmsRoutes(contentStore));

  // Mount Public Website & Knowledge Hub SSR Router
  app.use('/', createPublicRoutes(contentStore));

  return { app, contentStore };
}

if (require.main === module) {
  const PORT = process.env.PORT || process.env.CMS_PORT || 3002;
  const { app } = createApp();

  app.listen(PORT, () => {
    console.log(`[CFO AI CMS] Server listening on http://localhost:${PORT}`);
    console.log(`[CFO AI CMS] Public Website: http://localhost:${PORT}/en`);
    console.log(`[CFO AI CMS] CMS Admin Studio: http://localhost:${PORT}/admin`);
    console.log(`[CFO AI CMS] Health check: http://localhost:${PORT}/health`);
  });
}

module.exports = { createApp };
