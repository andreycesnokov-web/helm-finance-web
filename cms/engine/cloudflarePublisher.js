/**
 * CFO AI CMS — Automated Cloudflare Pages Publisher
 * Handles SSG building, Cloudflare edge deployment, and live page verification.
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class CloudflarePublisher {
  constructor(options = {}) {
    this.distDir = options.distDir || path.join(__dirname, '../../dist_marketing');
    this.projectRoot = path.join(__dirname, '../..');
  }

  /**
   * Compiles the static marketing build to dist_marketing/
   */
  async buildMarketingSite() {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../build_marketing.js');
      exec(`node "${scriptPath}"`, { cwd: this.projectRoot }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Marketing SSG build failed: ${stderr || err.message}`));
        }
        resolve({
          success: true,
          output: stdout,
          timestamp: new Date().toISOString()
        });
      });
    });
  }

  /**
   * Deploys dist_marketing/ to Cloudflare Pages
   */
  async deployToCloudflare(branch = 'main') {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || 'acaf2dcdb56ee1f7b39f950507822757';
    const projectName = process.env.CLOUDFLARE_PROJECT_NAME || 'cfo-ai-marketing';

    if (!apiToken) {
      return {
        success: false,
        deployed: false,
        reason: 'CLOUDFLARE_API_TOKEN is not configured in CMS runtime environment. Build compiled locally in dist_marketing/.'
      };
    }

    return new Promise((resolve, reject) => {
      const cmd = `npx wrangler pages deploy "${this.distDir}" --project-name=${projectName} --branch=${branch}`;
      const env = {
        ...process.env,
        CLOUDFLARE_API_TOKEN: apiToken,
        CLOUDFLARE_ACCOUNT_ID: accountId
      };

      exec(cmd, { cwd: this.projectRoot, env }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Cloudflare Pages deployment failed: ${stderr || err.message}`));
        }

        // Extract deployment URL if present in wrangler output
        const urlMatch = stdout.match(/https:\/\/[a-zA-Z0-9-]+\.cfo-ai-marketing\.pages\.dev/) ||
                         stdout.match(/https:\/\/cfo-ai-marketing\.pages\.dev/);
        const deployUrl = urlMatch ? urlMatch[0] : 'https://cfo-ai.site';

        resolve({
          success: true,
          deployed: true,
          projectName,
          deployUrl,
          productionUrl: 'https://cfo-ai.site',
          output: stdout,
          deployedAt: new Date().toISOString()
        });
      });
    });
  }

  /**
   * Verifies live HTTP 200 response on production surfaces
   */
  async verifyLiveUrls() {
    const urls = [
      'https://cfo-ai.site/en',
      'https://cfo-ai.site/id',
      'https://cfo-ai.site/ru',
      'https://cfo-ai.site/en/pricing',
      'https://cfo-ai.site/en/help',
      'https://cfo-ai.site/en/about'
    ];

    const results = {};
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        results[url] = { status: res.status, ok: res.ok };
      } catch (err) {
        results[url] = { status: 0, ok: false, error: err.message };
      }
    }
    return results;
  }
}

module.exports = CloudflarePublisher;
