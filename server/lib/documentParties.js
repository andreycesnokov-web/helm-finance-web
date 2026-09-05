// The parties on a document, kept whole.
//
// Production produced a counterparty profile reading:
//     legal_name: "HELM CARE INDONESIA"        ← the user's own company
//     npwp:       "01.336.238.9-054.000"       ← the OTHER party's tax number
// Two facts, each true of a different party, presented as one company. Acting on it
// would have created the user's own business as its own supplier, carrying somebody
// else's NPWP.
//
// The cause was structural: a name was searched for across the whole document, an NPWP
// was searched for across the whole document, and the two results were paired because
// they arrived together. Nothing tied either value to a party.
//
// So parties are parsed as BLOCKS. A name and an NPWP may only be paired when they
// were found in the same block, and a party with no block of its own is returned with
// a null NPWP rather than borrowing one.
'use strict';

const CPI = require('./counterpartyIntelligence');

/** Digits only, for comparison. The printed form is always preserved separately. */
const normNpwp = (v) => String(v || '').replace(/\D/g, '');
const isNpwp = (v) => {
  const d = normNpwp(v);
  return d.length >= 15 && d.length <= 16;
};

// Labels that open a party block on Indonesian commercial documents. Each entry says
// which side of the transaction the block describes.
const BLOCK_LABELS = [
  // seller / issuer / payee
  { re: /pengusaha\s+kena\s+pajak/i, role: 'issuer_or_receiver' },
  { re: /\bdari\s*:?/i, role: 'issuer_or_receiver' },
  { re: /\bfrom\s*:?/i, role: 'issuer_or_receiver' },
  { re: /\bpenjual\b/i, role: 'issuer_or_receiver' },
  { re: /\bsupplier\b/i, role: 'issuer_or_receiver' },
  { re: /\bvendor\b/i, role: 'issuer_or_receiver' },
  // buyer / payer
  { re: /pembeli\s+barang\s+kena\s+pajak/i, role: 'buyer_or_payer' },
  { re: /\bpembeli\b/i, role: 'buyer_or_payer' },
  { re: /\bkepada\s*:?/i, role: 'buyer_or_payer' },
  { re: /\bbill\s+to\b/i, role: 'buyer_or_payer' },
  { re: /\bto\s*:?/i, role: 'buyer_or_payer' },
  { re: /(?:sudah|telah)\s+terima\s+dari/i, role: 'buyer_or_payer' },
];

// A company named with its legal form is unambiguous, so that is tried first. The
// all-caps fallback exists for letterheads that print the name alone — but it must not
// answer with the document's own TITLE, which is also in capitals.
const LEGAL_FORM = /\b(?:PT|CV|UD|PD|PERUM|PERSERO)\b[.\s]+[A-Z][A-Za-z.&'\- ]{2,70}/;
const CAPS_RUN = /[A-Z][A-Z.&'\- ]{6,70}\b/;
const TITLE_WORDS = /^(?:KWITANSI|KUITANSI|INVOICE|FAKTUR|NOTA|RECEIPT|TAGIHAN|BUKTI|SURAT)\b/i;

/** The company named in this block, or null.
 *
 *  The all-caps fallback is deliberately hard to satisfy. Left loose it answered with
 *  "TRACE-B" — a fragment of the invoice REFERENCE printed in the letterhead — and that
 *  fragment then became the suggested counterparty. A company name printed without a
 *  legal form still reads as a name: at least two words, and no digits. */
function companyIn(section) {
  const legal = LEGAL_FORM.exec(section);
  if (legal) return legal[0];
  const caps = CAPS_RUN.exec(section);
  if (!caps) return null;
  const v = caps[0].trim();
  if (TITLE_WORDS.test(v)) return null;
  if (/\d/.test(v)) return null;               // a reference code, not a company
  if (!/[A-Z]\s+[A-Z]/.test(v)) return null;   // a single token is not a company name
  return caps[0];
}

/** Everything from a label up to the next label — one party's block of text. */
function splitBlocks(text) {
  const t = String(text || '');
  const marks = [];
  for (const { re, role } of BLOCK_LABELS) {
    const m = new RegExp(re.source, 'gi');
    let hit;
    while ((hit = m.exec(t)) !== null) {
      marks.push({ index: hit.index, end: hit.index + hit[0].length, role, label: hit[0].trim() });
      if (m.lastIndex === hit.index) m.lastIndex++;
    }
  }
  // Longest label wins at the same position: "Pembeli Barang Kena Pajak" is the block
  // header, "Pembeli" is only its first word. Taking the short one would start the
  // block mid-header and read "Barang Kena Pajak Nama" as the company.
  marks.sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index));
  const kept = [];
  for (const mk of marks) {
    const prev = kept[kept.length - 1];
    if (prev && mk.index < prev.end) continue;   // overlaps the label we already took
    kept.push(mk);
  }
  marks.length = 0;
  marks.push(...kept);
  const blocks = marks.map((mk, i) => ({
    role: mk.role,
    label: mk.label,
    section: t.slice(mk.end, marks[i + 1] ? marks[i + 1].index : Math.min(t.length, mk.end + 220)),
  })).filter((b) => b.section.trim().length > 0);

  // The letterhead. On a kwitansi the company that RECEIVED the money is printed at
  // the top with no label at all, so a labelled-blocks-only reader sees just the payer
  // — and then every party on the document looks like us. It is still a party block,
  // it simply has no header word.
  const firstMark = marks.length ? marks[0].index : t.length;
  const head = t.slice(0, firstMark);
  if (head.trim()) {
    blocks.unshift({ role: 'issuer_or_receiver', label: 'header', section: head });
  }
  return blocks;
}

function cleanName(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/^[\s:.\-]+/, '').replace(/\s+/g, ' ').trim();
  // Stop at anything that begins the next field.
  s = s.split(/\b(?:npwp|alamat|address|telp|phone|email|tanggal|jumlah|netto|total|harga|no\.?\s|kode)\b/i)[0];
  s = s.replace(/[\s:,.\-]+$/, '').trim();
  return s.length >= 3 ? s.slice(0, 120) : null;
}

/**
 * Parse the document's parties as whole objects.
 *
 * @returns { parties: [{ legal_name, npwp, npwp_normalized, role, evidence }], warnings }
 *          `evidence` records WHERE each value came from, so a pairing can be audited.
 */
function extractParties(text = '') {
  const blocks = splitBlocks(text);
  const parties = [];
  const warnings = [];
  const seen = new Set();

  for (const b of blocks) {
    // A name and an NPWP are taken from THIS block only. That is the whole point.
    // CASE-SENSITIVE on purpose: the company pattern is built from capitals, and an
    // /i flag would let "Barang Kena Pajak Nama" satisfy an all-caps run.
    const namaAt = /nama\s*:?\s*/i.exec(b.section);
    const searchFrom = namaAt ? b.section.slice(namaAt.index + namaAt[0].length) : b.section;
    const nameM = companyIn(searchFrom);
    const legal_name = cleanName(nameM);
    const npwpM = /npwp\s*:?\s*([\d][\d.\-\s]{12,25}\d)/i.exec(b.section);
    const npwpRaw = npwpM && isNpwp(npwpM[1]) ? npwpM[1].trim() : null;
    if (!legal_name) continue;

    const key = `${b.role}|${legal_name.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    parties.push({
      legal_name,
      npwp: npwpRaw,
      npwp_normalized: npwpRaw ? normNpwp(npwpRaw) : null,
      role: b.role,
      evidence: {
        name_text: nameM ? nameM.trim().slice(0, 120) : null,
        npwp_text: npwpRaw,
        section: b.label,
      },
    });
  }

  // An NPWP printed outside every party block cannot be attributed to anyone. It is
  // reported, never attached — this is exactly the pairing that went wrong.
  const inBlocks = new Set(parties.map((p) => p.npwp_normalized).filter(Boolean));
  const loose = [...String(text || '').matchAll(/npwp\s*:?\s*([\d][\d.\-\s]{12,25}\d)/gi)]
    .map((m) => m[1].trim()).filter((v) => isNpwp(v) && !inBlocks.has(normNpwp(v)));
  if (loose.length && parties.some((p) => !p.npwp)) {
    warnings.push('A tax number appears on this document but not inside a party block, '
      + 'so it was not attached to any party. Confirm which company it belongs to.');
  }

  return { parties, warnings };
}

/* ── who is us, and who is the counterparty ───────────────────────────────── */

/** Does this party look like the business itself? Name, alias or NPWP. */
function matchesBusiness(party, business = {}) {
  if (!party) return { match: false, on: null };
  const npwps = [business.npwp, ...(business.npwps || [])].filter(Boolean).map(normNpwp);
  if (party.npwp_normalized && npwps.includes(party.npwp_normalized)) {
    return { match: true, on: 'npwp' };
  }
  const names = [business.legal_name, business.display_name, business.name,
    ...(business.aliases || [])].filter(Boolean);
  for (const n of names) {
    if (CPI.nameSimilarity(party.legal_name, n) >= 0.85) return { match: true, on: 'name' };
  }
  return { match: false, on: null };
}

/**
 * Choose the counterparty — the party that is NOT this business.
 *
 * @returns { counterparty, status, reason, self_match, parties }
 *          status: 'ok' | 'needs_confirmation' | 'self_match' | 'not_found'
 */
function resolveCounterparty(text = '', business = {}) {
  const { parties, warnings } = extractParties(text);
  const marked = parties.map((p) => ({ ...p, is_business: matchesBusiness(p, business) }));
  const ours = marked.filter((p) => p.is_business.match);
  const others = marked.filter((p) => !p.is_business.match);

  if (!marked.length) {
    return { counterparty: null, status: 'not_found', parties: marked, warnings,
      reason: 'No party block could be read from this document.' };
  }

  // Every party looks like us. Offering one of them as a counterparty would file the
  // business against itself, so nothing is offered.
  if (!others.length) {
    return { counterparty: null, status: 'self_match', parties: marked, warnings,
      reason: 'CFO AI may have identified your own company instead of the counterparty. '
        + 'Review the document parties before continuing.' };
  }

  // We are not on the document at all: we cannot tell which side is ours, so the
  // "other" party is a guess and is offered only for confirmation.
  if (!ours.length) {
    return {
      counterparty: others[0], status: 'needs_confirmation', parties: marked, warnings,
      reason: 'This business could not be matched to either party on the document. '
        + 'Confirm which side is the counterparty.',
    };
  }

  const cp = others[0];
  return {
    counterparty: cp,
    status: cp.npwp ? 'ok' : 'ok',
    parties: marked,
    warnings,
    reason: `${cp.legal_name} is the party that is not this business.`,
  };
}

module.exports = {
  extractParties, resolveCounterparty, matchesBusiness, normNpwp, isNpwp, splitBlocks,
};
