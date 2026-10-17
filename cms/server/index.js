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
  const contentStore = new ContentStore(path.join(__dirname, '../data'));

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
  const PORT = process.env.CMS_PORT || 3002;
  const { app } = createApp();

  app.listen(PORT, () => {
    console.log(`[CFO AI CMS] Server listening on http://localhost:${PORT}`);
    console.log(`[CFO AI CMS] Public Website: http://localhost:${PORT}/en`);
    console.log(`[CFO AI CMS] CMS Admin Studio: http://localhost:${PORT}/admin`);
  });
}

module.exports = { createApp };
