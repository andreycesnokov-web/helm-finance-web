# CFO AI — CMS & Knowledge Hub Owner's Operational Manual
## Complete Guide to Managing https://cfo-ai.site Without Writing Code

**System:** CFO AI Content Management System & Knowledge Studio  
**CMS Access:** `https://admin.cfo-ai.site` (Local preview: `http://localhost:3002/admin`)  
**Public Website:** `https://cfo-ai.site` (Local preview: `http://localhost:3002/en`)  
**Audience:** Website Owner, Content Editors, Tax Reviewers  

---

## 1. Quick Start: Logging In

1. Open your browser and navigate to `https://admin.cfo-ai.site` (or local port).
2. Enter your authorized credentials:
   - **Website Owner:** `owner@cfo-ai.site` (Full administrative privileges, publishing, pricing approval, rollback)
   - **Content Editor:** `editor@cfo-ai.site` (Drafting, editing pages and articles)
   - **Tax Reviewer:** `reviewer@cfo-ai.site` (Reviewing articles, approving translations)
3. You will immediately enter the **CMS Operations Command Dashboard**.

---

## 2. Managing Website Pages & Block Content

The public website is built using a structured, non-destructive block system. Editors can update text, headlines, and call-to-actions without risking layout distortion.

1. In the CMS sidebar, click **📄 Pages & Blocks**.
2. Select the page you wish to modify from the left panel:
   - `Home` (Homepage: Hero, 4 Value Pillars, Pulse Showcase, Radar Showcase)
   - `Pricing` (Pricing hero and FAQs)
   - `Platform` (Platform Tour)
   - `Document Intelligence` (OCR Drawer and Ingestion Workflow)
   - `Tax & Compliance` (Statutory Calendar and CoreTax Radar)
3. In the editor view, update any desired field:
   - **Hero Badge:** The top pill badge (e.g., *"DESIGNED FOR INDONESIA • PT & PT PMA"*).
   - **Hero Headline:** The primary H1 message (e.g., *"Know your numbers. Control your business."*).
   - **Subtitle / Value Proposition:** The core explanatory paragraph.
   - **CTA Button Text & URL:** Change button labels or destination URLs.
4. Click **Save Page Changes**. The draft is saved immediately.
5. To promote changes to the live public site, navigate to **Publishing & Rollback** and click **Publish New Release**.

---

## 3. Managing the CFO AI Knowledge Hub

The Knowledge Hub establishes CFO AI's technical and regulatory authority across Indonesian corporate finance.

### Drafting a New Guide
1. In the CMS sidebar, click **📚 Knowledge Hub**.
2. Click **+ Draft New Guide** in the top right.
3. Fill in the article parameters:
   - **Article Title:** The definitive guide headline.
   - **URL Slug:** Clean, search-friendly slug (e.g., `pt-pma-tax-compliance-guide-2026`).
   - **Category:** Select from the 6 predefined categories (*Indonesian Taxes & Regulations, Accounting & Bookkeeping, Cash Flow & Financial Management, Business Operations, AI Automation, Product Guides*).
   - **Jurisdiction:** Set to `ID` for Indonesian statutory guides.
   - **Reading Time:** Estimated minutes to read.
   - **Status:** Set to `draft` while writing, or `in_review` when ready for editorial check.
   - **Excerpt:** 2-3 sentence summary for search results and social cards.
   - **Article Content:** Write your guide using standard Markdown formatting (`# Heading 1`, `## Heading 2`, `**bold**`, tables, callout quotes).
4. Click **Save Guide**.

### Legal Safeguards for Tax & Compliance Content
When publishing tax guides:
- Distinguish statutory requirements (UU HPP, PMK 81/2024, PP 58/2023) from general business advice.
- Always include the standard statutory disclaimer: *"CFO AI prepares operational files; it does not issue statutory audit opinions or replace a licensed Indonesian Konsultan Pajak."*
- Ensure the **Legal Review Date** is updated when tax rules change.

---

## 4. Managing Pricing & The Discrepancy Prevention Guard

To protect commercial integrity, the CMS includes an automated **Pricing Discrepancy Guard** that verifies marketing presentation against the backend billing catalog (`v2.1-commercial`).

### How It Works:
1. In the CMS sidebar, click **💰 Pricing & Limits**.
2. You will see:
   - **Discrepancy Guard Status Banner:** Shows whether marketing presentation matches the backend catalog.
   - **Plan Cards:** Editable monthly subscription prices, taglines, and descriptions for Starter ($59), Control ($149), and Pro ($249).
   - **Usage Limits Table:** The 11 reconciled commercial limits.
3. If an editor accidentally inputs numbers that contradict the catalog (e.g., promising 100 seats or unlimited bank rows on Starter):
   - The banner immediately turns **RED**: `⚠️ DISCREPANCY DETECTED — PUBLICATION BLOCKED`.
   - The exact mismatch is listed with guidance on how to fix it.
   - **Atomic publication is automatically locked** until the presentation is corrected or the owner publishes an official billing catalog version update.

---

## 5. Managing Translations & Staged Locales (16 Locales Studio)

CFO AI is architected to support 16 international and regional locales:
`en`, `id`, `ru`, `fil`, `en-SG`, `th`, `vi`, `km`, `lo`, `zh-HK`, `ms`, `uk`, `it`, `fr`, `de`, `es`.

### Staged Activation Policy:
- **Active Launch Locales:** English (`en`), Bahasa Indonesia (`id`), Russian (`ru`).
- **Staged Locales:** The remaining 13 locales are configured architecturally but kept in `staged` status until reviewed. Staged locales are **hidden from search engines** and do not generate empty or machine-translated sitemaps.

### Activating a New Language:
1. In the CMS sidebar, click **🌐 16 Locales Studio**.
2. Locate the desired target language (e.g., Thai `th` or Vietnamese `vi`).
3. Verify that article translations are complete and reviewed.
4. Click **Activate / Publish**.
5. The language will immediately become available in the public header dropdown and will be added to the live `sitemap.xml` with `hreflang` tags.

---

## 6. Publishing Releases & 1-Click Atomic Rollback

Publishing in CFO AI is atomic. When you publish, the CMS generates an immutable snapshot manifest (`release_<timestamp>_<hash>.json`).

### Publishing a Release:
1. In the CMS sidebar, click **🚀 Publishing & Rollback**.
2. Click **🚀 Publish New Production Release**.
3. Enter descriptive release notes (e.g., *"Added PMK 81/2024 CoreTax article and updated Q4 hero CTA"*).
4. The system validates the entire content store and pricing guard.
5. Upon confirmation, the live public site updates instantly.

### Executing a 1-Click Rollback:
If an error occurs or an unintended change is published:
1. Navigate to **Publishing & Rollback**.
2. Browse the **Release Version History** table.
3. Find the previous stable release version.
4. Click **Rollback to this**.
5. The system instantly restores the exact prior snapshot and swaps the live pointer in under 50 milliseconds with zero downtime.

---

## 7. SEO Management & Directives

1. In the CMS sidebar, click **🔍 SEO Manager**.
2. Edit site-wide parameters:
   - **Base URL:** `https://cfo-ai.site`
   - **Default Title & Meta Description**
3. Review the **Live XML Sitemap** (`/sitemap.xml`): Automatically includes all published pages, articles, and multi-locale `hreflang` alternate tags.
4. Review **Redirects**: View active 301 redirects (e.g., legacy `/signup` automatically redirecting to `https://app.cfo-ai.site/login`).

---

## 8. Summary of Permissions by Role

| Action | Website Owner | Content Editor | Tax Reviewer |
| :--- | :---: | :---: | :---: |
| Edit Page Headlines & Blocks | Yes | Yes | Read Only |
| Draft Knowledge Hub Guides | Yes | Yes | Yes |
| Approve Tax Guides for Publication | Yes | No | Yes |
| Edit Marketing Pricing Presentation | Yes | Read Only | Read Only |
| Activate / Stage Locales | Yes | Read Only | Read Only |
| Publish Production Release | Yes | No | No |
| Execute 1-Click Rollback | Yes | No | No |
| View Administrative Audit Logs | Yes | Yes | Yes |
