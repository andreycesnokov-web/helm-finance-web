/**
 * Technical SEO & XML Sitemap Generator
 * Produces multi-locale XML sitemaps with hreflang annotations and robots directives.
 */

class SitemapGenerator {
  constructor(baseUrl, locales, pages, articles) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.locales = locales.filter(l => l.status === 'published');
    this.pages = pages;
    this.articles = articles.filter(a => a.review_status === 'published');
  }

  generateXml() {
    const urls = [];
    const now = new Date().toISOString().split('T')[0];

    // 1. Static/Marketing Pages across all published locales
    const pageRoutes = [
      { path: '', changefreq: 'weekly', priority: '1.0' },
      { path: 'pricing', changefreq: 'weekly', priority: '0.9' },
      { path: 'platform', changefreq: 'monthly', priority: '0.8' },
      { path: 'document-intelligence', changefreq: 'monthly', priority: '0.8' },
      { path: 'compliance', changefreq: 'weekly', priority: '0.8' },
      { path: 'blog', changefreq: 'daily', priority: '0.9' }
    ];

    pageRoutes.forEach(route => {
      const routeSegment = route.path ? `/${route.path}` : '';
      
      this.locales.forEach(loc => {
        const locUrl = `${this.baseUrl}/${loc.code}${routeSegment}`;
        
        // Hreflang alternates
        const alternates = this.locales.map(otherLoc => {
          return `    <xhtml:link rel="alternate" hreflang="${otherLoc.code}" href="${this.baseUrl}/${otherLoc.code}${routeSegment}"/>`;
        });
        alternates.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${this.baseUrl}/en${routeSegment}"/>`);

        urls.push(`  <url>
    <loc>${locUrl}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
${alternates.join('\n')}
  </url>`);
      });
    });

    // 2. Knowledge Hub Articles across available published translations
    this.articles.forEach(art => {
      const availableTranslations = this.locales.filter(loc => art.translations && art.translations[loc.code]);
      
      availableTranslations.forEach(loc => {
        const locUrl = `${this.baseUrl}/${loc.code}/blog/${art.slug}`;
        
        const alternates = availableTranslations.map(otherLoc => {
          return `    <xhtml:link rel="alternate" hreflang="${otherLoc.code}" href="${this.baseUrl}/${otherLoc.code}/blog/${art.slug}"/>`;
        });
        if (art.translations['en']) {
          alternates.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${this.baseUrl}/en/blog/${art.slug}"/>`);
        }

        urls.push(`  <url>
    <loc>${locUrl}</loc>
    <lastmod>${art.last_updated.split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
${alternates.join('\n')}
  </url>`);
      });
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`;
  }
}

module.exports = SitemapGenerator;
