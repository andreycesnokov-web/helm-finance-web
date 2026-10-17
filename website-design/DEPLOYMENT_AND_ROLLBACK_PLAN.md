# CFO AI — Commercial Deployment & Rollback Plan
## Production Launch Runbook for https://cfo-ai.site

**Project:** CFO AI Indonesia Official Marketing Website  
**Marketing Domain:** `https://cfo-ai.site`  
**Application Domain:** `https://app.cfo-ai.site` (Strictly Unmodified)  
**Working Branch:** `feat/cfo-ai-website-commercial-launch`  
**Date:** October 18, 2026  
**Auditor / DevOps Lead:** AntiGravity (Senior Product Designer / B2B SaaS UX Strategist)  
**Governing Rule:** `AGENTS.md` (Deployment NOT authorized without explicit owner sign-off)  

---

## 1. Architecture & Infrastructure Isolation

The CFO AI infrastructure enforces strict physical separation between the public marketing website and the financial SaaS application:

```
[ Prospective Customer ]
          │
          ├───► https://cfo-ai.site (Marketing Website)
          │     ├── Source: repository /website-design/ directory
          │     ├── Runtime: Edge Static CDN (HTML, SVG, Tailwind CSS)
          │     └── Risk Profile: ZERO database/auth impact
          │
          └───► https://app.cfo-ai.site (Financial OS Application)
                ├── Source: /server and /client (React SPA)
                ├── Runtime: Railway PaaS (Node.js 20 + Supabase PostgreSQL)
                └── Risk Profile: Protected financial ledgers & customer PII
```

### Key Guarantees:
- **Zero Application Impact:** Deploying `website-design/` cannot modify database tables, auth tokens, session cookies, or billing records.
- **Zero Shared State:** The marketing website does not execute server-side Node.js code; it is 100% static client-side markup.
- **Safe Link Routing:** All conversion CTAs point directly to the authenticated portal entrypoint `https://app.cfo-ai.site/login`.

---

## 2. Launch Deliverables & Static Manifest

The complete commercial launch bundle is contained in `website-design/`:

| File Path | Purpose | Canonical Target |
| :--- | :--- | :--- |
| `website-design/index.html` | Canonical Homepage (Concept B+ Ice-Blue) | `https://cfo-ai.site/` |
| `website-design/pricing-page.html` | Dedicated Pricing & Limits Matrix | `https://cfo-ai.site/pricing-page.html` |
| `website-design/platform-page.html` | Platform Architecture Deep Tour | `https://cfo-ai.site/platform-page.html` |
| `website-design/document-intelligence-page.html` | Document Intake & Review Drawer | `https://cfo-ai.site/document-intelligence-page.html` |
| `website-design/compliance-page.html` | Indonesian Tax Radar & PMK 81/2024 | `https://cfo-ai.site/compliance-page.html` |
| `website-design/robots.txt` | Search Engine Crawl Directives | `https://cfo-ai.site/robots.txt` |
| `website-design/sitemap.xml` | Search Engine XML Sitemap Index | `https://cfo-ai.site/sitemap.xml` |
| `website-design/assets/product/*.svg` | 5 Mathematical Product SVGs | `https://cfo-ai.site/assets/product/*` |

---

## 3. Pre-Launch Verification Checklist

Execute these verification checks before triggering live deployment:

- [x] **Entrypoint Existence:** `website-design/index.html` exists and mirrors the refined desktop experience.
- [x] **Zero Broken Internal Links:** All relative links (`index.html`, `pricing-page.html`, `platform-page.html`, `document-intelligence-page.html`, `compliance-page.html`) resolve.
- [x] **Zero `/signup` URLs:** Grep check confirms 0 instances of `app.cfo-ai.site/signup`; all CTAs use `app.cfo-ai.site/login`.
- [x] **Zero Emojis:** Grep regex confirms 0 emoji Unicode entities across all production marketing files; all icons use Lucide outline SVGs.
- [x] **Responsive Mobile Navigation:** Hamburger navigation toggle script present on all pages.
- [x] **SEO Directives:** `robots.txt` allows all crawlers and points to `https://cfo-ai.site/sitemap.xml`.
- [x] **Pricing Accuracy:** Starter ($59), Control ($149), Pro ($249) rendered identically across homepage and pricing page.

---

## 4. Recommended Production Hosting Methods

### Method 1: Cloudflare Pages / Vercel (Recommended — 0 Server Cost & Global Edge)
1. In Cloudflare Pages / Vercel dashboard:
   - Select Git repository: `andreycesnokov-web/helm-finance-web`.
   - Branch: `main` (or `public` / dedicated marketing branch).
   - Root directory / Build output directory: `website-design`.
   - Build command: *(leave empty — purely static HTML)*.
2. Custom Domain:
   - Assign `cfo-ai.site` and `www.cfo-ai.site`.
   - Automatic edge SSL/TLS provisioned instantly.

### Method 2: Railway Static Service
1. Create a new service in Railway project `helm-finance-web`.
2. Name: `cfo-marketing-website`.
3. Build command: `npx serve website-design -l $PORT` (or NGINX buildpack).
4. Custom Domain: `cfo-ai.site`.

---

## 5. Step-by-Step Launch Execution Runbook

When the owner grants explicit approval to deploy:

1. **Commit & Push:**
   ```bash
   git add website-design/
   git commit -m "feat(website): commercial launch preparation for cfo-ai.site"
   git push origin feat/cfo-ai-website-commercial-launch
   ```

2. **Pull Request & Code Review:**
   - Create PR: `feat/cfo-ai-website-commercial-launch` → `main`.
   - Reviewer confirms no changes touch `client/`, `server/`, or `migrations/`.
   - Merge PR into `main`.

3. **Deploy & DNS Verification:**
   - Verify deployment trigger in hosting dashboard.
   - Run post-launch smoke test from terminal:
     ```bash
     curl -I https://cfo-ai.site/
     curl -I https://cfo-ai.site/pricing-page.html
     curl -I https://cfo-ai.site/robots.txt
     curl -I https://cfo-ai.site/sitemap.xml
     ```
   - Confirm HTTP 200 OK responses with proper `Content-Type: text/html` and `text/xml`.

---

## 6. Rollback Runbook (Zero-Downtime Reversion)

If any content, visual regression, or business error is detected post-launch:

### Instant Edge Rollback (< 30 seconds):
1. In the hosting provider (Cloudflare Pages / Vercel / Railway):
2. Navigate to **Deployments**.
3. Select the previous stable deployment timestamp.
4. Click **Redeploy** or **Rollback to this deployment**.
5. Edge cache updates instantly worldwide.

### Git Revert Procedure:
```bash
git revert HEAD --no-edit
git push origin main
```

---

## 7. Operational Stop Notice

> [!IMPORTANT]
> **ANTI-GRAVITY WORKFLOW BOUNDARY:**  
> All design refinements, content alignments, SVG illustrations, mobile drawers, and verification reports are complete in the local workspace.  
> **AntiGravity will NOT execute production deployment, git merge to main, or hosting DNS mutation without explicit owner direction.**
