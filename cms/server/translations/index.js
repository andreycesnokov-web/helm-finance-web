/**
 * CFO AI Multilingual Translation Aggregator
 * Exports all 11 localized dictionaries.
 * Zero emojis across all languages.
 */

const en = require('./locales/en.js');
const id = require('./locales/id.js');
const ru = require('./locales/ru.js');
const fr = require('./locales/fr.js');
const de = require('./locales/de.js');
const es = require('./locales/es.js');
const it = require('./locales/it.js');
const zhCn = require('./locales/zh-cn.js');
const ja = require('./locales/ja.js');
const th = require('./locales/th.js');
const vi = require('./locales/vi.js');

const translations = {
  en,
  id,
  ru,
  fr,
  de,
  es,
  it,
  'zh-cn': zhCn,
  ja,
  th,
  vi
};

module.exports = translations;
