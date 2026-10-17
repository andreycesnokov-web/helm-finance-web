/**
 * Translation & Locale Management Engine
 * Supports 16 locales architecturally, staged activation, and translation sync tracking.
 */

const fs = require('fs');
const path = require('path');

class TranslationEngine {
  constructor(localesPath, articlesPath) {
    this.localesPath = localesPath || path.join(__dirname, '../data/locales.json');
    this.articlesPath = articlesPath || path.join(__dirname, '../data/hub_articles.json');
  }

  getLocales() {
    try {
      return JSON.parse(fs.readFileSync(this.localesPath, 'utf8'));
    } catch {
      return [];
    }
  }

  getPublishedLocales() {
    return this.getLocales().filter(l => l.status === 'published');
  }

  isLocaleSupported(code) {
    return this.getLocales().some(l => l.code === code);
  }

  isLocalePublished(code) {
    return this.getPublishedLocales().some(l => l.code === code);
  }

  getTranslationStatusMatrix() {
    const locales = this.getLocales();
    let articles = [];
    try {
      articles = JSON.parse(fs.readFileSync(this.articlesPath, 'utf8'));
    } catch (e) {
      articles = [];
    }

    const matrix = locales.map(locale => {
      let translatedCount = 0;
      let totalCount = articles.length;

      articles.forEach(art => {
        if (art.translations && art.translations[locale.code]) {
          translatedCount++;
        }
      });

      const percentage = totalCount > 0 ? Math.round((translatedCount / totalCount) * 100) : 0;

      return {
        code: locale.code,
        name: locale.name,
        nativeName: locale.nativeName,
        status: locale.status,
        isDefault: locale.isDefault,
        translatedArticles: translatedCount,
        totalArticles: totalCount,
        completeness: `${percentage}%`
      };
    });

    return matrix;
  }

  updateLocaleStatus(code, newStatus) {
    const locales = this.getLocales();
    const target = locales.find(l => l.code === code);
    if (!target) return false;

    if (['published', 'staged', 'draft'].includes(newStatus)) {
      target.status = newStatus;
      fs.writeFileSync(this.localesPath, JSON.stringify(locales, null, 2), 'utf8');
      return true;
    }
    return false;
  }
}

module.exports = TranslationEngine;
