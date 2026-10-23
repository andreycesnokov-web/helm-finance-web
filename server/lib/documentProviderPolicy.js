'use strict';
// One operator switch for every PAID reading of document content (photos, PDFs, statement files).
// DOCUMENT_OCR_VISION_ENABLED=false (or unset) means no document byte or document-derived text is
// sent to a paid model: receipt recognition, document identification, company-profile reading and the
// statement-reading model fallback all take their existing "no key" path. Request options never
// override it. Nanonets keeps its own opt-in (DOCUMENT_OCR_NANONETS_ENABLED).
// Same interface as the prepared Codex policy, so the two can be reconciled without a second gate.
const paidDocumentAIEnabled = () => process.env.DOCUMENT_OCR_VISION_ENABLED === 'true';
const paidNanonetsEnabled = () => process.env.DOCUMENT_OCR_NANONETS_ENABLED === 'true';

module.exports = { paidDocumentAIEnabled, paidNanonetsEnabled };
