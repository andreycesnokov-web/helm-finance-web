'use strict';
/**
 * CFO AI Integrated Staging Server
 * Powers both:
 * 1. Marketing Website & Pricing V2 (HTTP 55480 and HTTPS 55481)
 *    - Rewrites outbound app CTA links to point directly to the staging app!
 * 2. SaaS Application (HTTP 55470 and HTTPS 55471)
 *    - Proxies /api/* to the CFO AI API server (55460)
 *    - Serves built client SPA with V2 redesign enabled
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');

const CMS_ROOT = 'C:/Users/HUAWEI/Desktop/helm-finance-web';
const ContentStore = require(path.join(CMS_ROOT, 'cms/engine/contentStore'));
const createCmsRoutes = require(path.join(CMS_ROOT, 'cms/server/cmsRoutes'));
const createPublicRoutes = require(path.join(CMS_ROOT, 'cms/server/publicRoutes'));

const CERT_PATH = 'C:/tmp/staging_cert.pem';
const KEY_PATH = 'C:/tmp/staging_key.pem';
const hasSsl = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
const sslOptions = hasSsl ? {
  key: fs.readFileSync(KEY_PATH),
  cert: fs.readFileSync(CERT_PATH)
} : null;

// -----------------------------------------------------------------------------
// 1. Marketing Website (CMS) with CTA link rewrites for Staging
// -----------------------------------------------------------------------------
const cmsApp = express();
const contentStore = new ContentStore(path.join(CMS_ROOT, 'cms/data'));

cmsApp.use(cors());
cmsApp.use(express.json());
cmsApp.use(express.urlencoded({ extended: true }));

// Serve static assets from website-design/assets (SVGs, screenshots, logos)
cmsApp.use('/assets', express.static(path.join(CMS_ROOT, 'website-design/assets')));

// Serve CMS Admin frontend assets
cmsApp.use('/admin', express.static(path.join(CMS_ROOT, 'cms/admin')));

// Mount CMS REST API
cmsApp.use('/api/cms', createCmsRoutes(contentStore));

// Middleware to dynamically intercept and rewrite app links in HTML responses BEFORE router
cmsApp.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (body) {
    if (typeof body === 'string') {
      const isHttps = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
      const host = req.headers.host ? req.headers.host.split(':')[0] : '127.0.0.1';
      const targetAppPort = isHttps ? 55471 : 55470;
      const targetAppScheme = isHttps ? 'https' : 'http';
      const stagingAppBase = `${targetAppScheme}://${host}:${targetAppPort}`;

      // Rewrite https://app.cfo-ai.site to stagingAppBase
      body = body.replace(/https:\/\/app\.cfo-ai\.site/g, stagingAppBase);
    }
    return originalSend.call(this, body);
  };
  next();
});

// Mount Public Website & Knowledge Hub SSR Router
cmsApp.use('/', createPublicRoutes(contentStore));

// Start Website HTTP (55480) & HTTPS (55481)
http.createServer(cmsApp).listen(55480, '0.0.0.0', () => {
  console.log('[WEBSITE STAGING] HTTP listening on http://127.0.0.1:55480');
});
if (sslOptions) {
  https.createServer(sslOptions, cmsApp).listen(55481, '0.0.0.0', () => {
    console.log('[WEBSITE STAGING] HTTPS listening on https://127.0.0.1:55481');
  });
}

// -----------------------------------------------------------------------------
// 2. HTTPS Proxy for SaaS Application (Port 55471 -> 55470)
// -----------------------------------------------------------------------------
if (sslOptions) {
  https.createServer(sslOptions, (req, res) => {
    const proxyReq = http.request({
      host: '127.0.0.1',
      port: 55470,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: req.headers.host,
        'x-forwarded-proto': 'https',
        'x-forwarded-for': req.socket.remoteAddress
      }
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end('Staging app proxy error: ' + err.message);
    });
    req.pipe(proxyReq);
  }).listen(55471, '0.0.0.0', () => {
    console.log('[APP STAGING] HTTPS listening on https://127.0.0.1:55471 (proxying to :55470)');
  });
}
