/**
 * Dual Staging Preview Server with Cloudflare Quick Tunnels
 * Deploys Public Website Preview (Port 3002) and Password-Protected CMS Studio (Port 3003).
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ContentStore = require('./engine/contentStore');
const createCmsRoutes = require('./server/cmsRoutes');
const createPublicRoutes = require('./server/publicRoutes');

const PUBLIC_PORT = process.env.PUBLIC_PORT || 3002;
const ADMIN_PORT = process.env.ADMIN_PORT || 3003;

const STAGING_BASIC_USER = 'cfo-owner';
const STAGING_BASIC_PASS = 'cfo-preview-2026';

// 1. PUBLIC WEBSITE APP (Port 3002)
function createPublicApp(contentStore) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/healthz', (req, res) => res.json({ status: 'ok', surface: 'public', timestamp: new Date().toISOString() }));
  app.use('/assets', express.static(path.join(__dirname, '../website-design/assets')));
  app.use('/', createPublicRoutes(contentStore));

  return app;
}

// 2. PASSWORD-PROTECTED CMS STUDIO APP (Port 3003)
function createAdminApp(contentStore) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Basic Auth for Staging Protection
  app.use((req, res, next) => {
    if (req.path === '/healthz') return next();
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      res.setHeader('WWW-Authenticate', 'Basic realm="CFO AI Staging Admin"');
      return res.status(401).send('Staging authentication required.');
    }
    const [scheme, credentials] = authHeader.split(' ');
    if (scheme !== 'Basic' || !credentials) {
      res.setHeader('WWW-Authenticate', 'Basic realm="CFO AI Staging Admin"');
      return res.status(401).send('Invalid authentication format.');
    }
    const decoded = Buffer.from(credentials, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');
    if (user === STAGING_BASIC_USER && pass === STAGING_BASIC_PASS) {
      return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="CFO AI Staging Admin"');
    return res.status(401).send('Invalid staging credentials.');
  });

  app.get('/healthz', (req, res) => res.json({ status: 'ok', surface: 'admin', timestamp: new Date().toISOString() }));
  app.get('/', (req, res) => res.redirect('/admin'));
  app.use('/admin', express.static(path.join(__dirname, 'admin')));
  app.use('/assets', express.static(path.join(__dirname, '../website-design/assets')));
  app.use('/api/cms', createCmsRoutes(contentStore));

  return app;
}

// 3. LAUNCH CLOUDFLARE QUICK TUNNEL
function launchTunnel(port, label) {
  return new Promise((resolve, reject) => {
    const cloudflaredPath = path.join(__dirname, 'bin/cloudflared.exe');
    if (!fs.existsSync(cloudflaredPath)) {
      return reject(new Error(`cloudflared binary not found at ${cloudflaredPath}`));
    }

    console.log(`[Cloudflare] Spawning tunnel for ${label} on port ${port}...`);
    const proc = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`]);
    let assignedUrl = null;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Tunnel creation timed out for ${label} (Port ${port})`));
      }
    }, 45000);

    function checkChunk(chunk) {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !assignedUrl) {
        assignedUrl = match[0];
        console.log(`[Cloudflare] ✓ ${label} Live URL: ${assignedUrl}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ assignedUrl, proc });
        }
      }
    }

    proc.stdout.on('data', checkChunk);
    proc.stderr.on('data', checkChunk);

    proc.on('error', (err) => {
      console.error(`[Cloudflare] Error in ${label} process:`, err.message);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    proc.on('close', (code) => {
      console.log(`[Cloudflare] Tunnel process ${label} exited with code ${code}`);
    });
  });
}

async function startStagingPreview() {
  console.log('====================================================');
  console.log('  STARTING CFO AI DUAL STAGING PREVIEW SURFACES     ');
  console.log('====================================================');

  const contentStore = new ContentStore(path.join(__dirname, 'data'));

  // 1. Start Public App
  const publicApp = createPublicApp(contentStore);
  const publicServer = publicApp.listen(PUBLIC_PORT, () => {
    console.log(`[Local] Public Website listening on http://localhost:${PUBLIC_PORT}`);
  });

  // 2. Start Admin App
  const adminApp = createAdminApp(contentStore);
  const adminServer = adminApp.listen(ADMIN_PORT, () => {
    console.log(`[Local] Password-Protected CMS Studio listening on http://localhost:${ADMIN_PORT}`);
  });

  // 3. Launch Cloudflare Tunnels
  console.log('\n[Tunnels] Connecting to Cloudflare global network edge...');
  const [publicTunnel, adminTunnel] = await Promise.all([
    launchTunnel(PUBLIC_PORT, 'Public Website Surface'),
    launchTunnel(ADMIN_PORT, 'CMS Studio Surface')
  ]);

  // 4. Verify Both Over HTTPS
  console.log('\n[Verification] Probing preview surfaces over HTTPS...');
  
  // Public probe
  let publicVerified = false;
  try {
    const pubRes = await fetch(`${publicTunnel.assignedUrl}/en`);
    if (pubRes.status === 200) {
      publicVerified = true;
      console.log(`[Verification] ✓ Public Website responded HTTP 200 over HTTPS`);
    } else {
      console.warn(`[Verification] ⚠ Public Website returned status ${pubRes.status}`);
    }
  } catch (err) {
    console.error(`[Verification] ✗ Public Website HTTPS probe failed:`, err.message);
  }

  // Admin probe (with basic auth)
  let adminVerified = false;
  try {
    const authHeader = 'Basic ' + Buffer.from(`${STAGING_BASIC_USER}:${STAGING_BASIC_PASS}`).toString('base64');
    const admRes = await fetch(`${adminTunnel.assignedUrl}/admin/`, {
      headers: { 'Authorization': authHeader }
    });
    if (admRes.status === 200) {
      adminVerified = true;
      console.log(`[Verification] ✓ Password-Protected CMS Studio responded HTTP 200 over HTTPS`);
    } else {
      console.warn(`[Verification] ⚠ CMS Studio returned status ${admRes.status}`);
    }
  } catch (err) {
    console.error(`[Verification] ✗ CMS Studio HTTPS probe failed:`, err.message);
  }

  // 5. Write status file
  const previewInfo = {
    generated_at: new Date().toISOString(),
    status: 'ONLINE',
    surfaces: {
      public_website: {
        https_url: publicTunnel.assignedUrl,
        english_homepage: `${publicTunnel.assignedUrl}/en`,
        indonesian_homepage: `${publicTunnel.assignedUrl}/id`,
        pricing_url: `${publicTunnel.assignedUrl}/en/pricing`,
        hub_url: `${publicTunnel.assignedUrl}/en/blog`,
        verified_https: publicVerified,
        local_port: PUBLIC_PORT
      },
      cms_studio: {
        https_url: adminTunnel.assignedUrl,
        admin_login_url: `${adminTunnel.assignedUrl}/admin/`,
        staging_gateway_protection: {
          auth_type: 'HTTP Basic Auth',
          username: STAGING_BASIC_USER,
          password: STAGING_BASIC_PASS
        },
        cms_application_accounts: [
          { role: 'Owner', email: 'owner@cfo-ai.site', permissions: 'Full publishing & rollback, pricing edit, SEO, block editor' },
          { role: 'Editor', email: 'editor@cfo-ai.site', permissions: 'Content & article draft/edit, block editing' },
          { role: 'Reviewer', email: 'reviewer@cfo-ai.site', permissions: 'Read-only preview, audit inspect' }
        ],
        verified_https: adminVerified,
        local_port: ADMIN_PORT
      }
    }
  };

  fs.writeFileSync(path.join(__dirname, 'staging_preview_info.json'), JSON.stringify(previewInfo, null, 2));
  console.log('\n[Preview Info] Written to cms/staging_preview_info.json');

  console.log('\n====================================================');
  console.log('       CFO AI STAGING PREVIEW SURFACES READY        ');
  console.log('====================================================');
  console.log(`PUBLIC WEBSITE : ${publicTunnel.assignedUrl}/en`);
  console.log(`CMS STUDIO     : ${adminTunnel.assignedUrl}/admin/`);
  console.log(`GATEWAY USER   : ${STAGING_BASIC_USER}`);
  console.log(`GATEWAY PASS   : ${STAGING_BASIC_PASS}`);
  console.log('====================================================\n');
}

if (require.main === module) {
  startStagingPreview().catch(err => {
    console.error('Failed to start staging preview:', err);
    process.exit(1);
  });
}

module.exports = { startStagingPreview };
