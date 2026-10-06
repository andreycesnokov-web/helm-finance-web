// CODEX KNOWLEDGE BASE BASELINE:
// - Pinned Codex PR #133 commit SHA: 63feda16f678ab4e6830098289f8f87d0987745a
// - Synchronization protocol for future changes:
//   1. Pull upstream changes into knowledge/indonesia_tax_kb and server/lib/indonesiaTaxKnowledge*.cjs.
//   2. Run `node -e "const { getCard } = require('./server/lib/indonesiaTaxKnowledgeCards.cjs'); console.log(getCard({ topic_id: 'pph21', language: 'ru', intent: 'explanation' }));"`
//   3. Export fresh snapshot via `node tools/indonesia_tax_kb/export_cards.cjs` if updating offline fallback.
//   4. Frontend contract adapter dynamically parses card structure: what_is, how_it_works, main_condition, abbreviation,
//      what_to_check, and claim_evidence according to schema_version: 2 (indonesia_tax_tooltip_v2).

export const CODEX_KB_BASE_SHA = '63feda16f678ab4e6830098289f8f87d0987745a';

import rawCardsData from './taxKnowledgeCardsData.json';
import { apiFetch } from './api';

export const TAX_TOPIC_ORDER = [
  'pph21',
  'pph26',
  'pph23',
  'pph_final_rent',
  'pph25',
  'pph29',
  'ppn',
  'pkp',
  'npwp_nik'
];

/**
 * Get tax card synchronously by topic_id and language from reviewed fixture snapshot.
 */
export function getTaxCard(topicId, lang = 'ru') {
  const normLang = ['ru', 'en', 'id'].includes(lang) ? lang : 'en';
  let card = rawCardsData.find(c => c.topic_id === topicId && c.language === normLang);
  if (!card) card = rawCardsData.find(c => c.topic_id === topicId && c.language === 'en');
  if (!card) card = rawCardsData.find(c => c.topic_id === topicId);
  return card || null;
}

/**
 * List all 9 canonical tax cards synchronously for a given language.
 */
export function listTaxCards(lang = 'ru') {
  return TAX_TOPIC_ORDER.map(topicId => getTaxCard(topicId, lang)).filter(Boolean);
}

/**
 * Maps a tax code or title (e.g. 'pph21', 'PPh 21', 'id_pph21_monthly') to canonical topic_id.
 */
export function matchTopicId(codeOrTitle) {
  if (!codeOrTitle) return null;
  const s = String(codeOrTitle).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('pph21')) return 'pph21';
  if (s.includes('pph26')) return 'pph26';
  if (s.includes('pph23')) return 'pph23';
  if (s.includes('rent') || s.includes('42') || s.includes('finalrent')) return 'pph_final_rent';
  if (s.includes('pph25')) return 'pph25';
  if (s.includes('pph29')) return 'pph29';
  if (s.includes('ppn') || s.includes('vat')) return 'ppn';
  if (s.includes('pkp')) return 'pkp';
  if (s.includes('npwp') || s.includes('nik')) return 'npwp_nik';
  return null;
}

/**
 * Fetch live getCard() data from backend /api/accountant/tax-knowledge/cards.
 * Directly calls Codex PR #133 getCard() on server without text duplication.
 */
export async function fetchLiveTaxCards(token, lang = 'ru') {
  try {
    const res = await apiFetch(`/accountant/tax-knowledge/cards?lang=${encodeURIComponent(lang)}`, token);
    if (res && Array.isArray(res.cards) && res.cards.length > 0) {
      return res.cards;
    }
  } catch (e) {
    console.warn('Could not fetch live getCard() from backend, using reviewed fixture snapshot:', e.message);
  }
  return listTaxCards(lang);
}
