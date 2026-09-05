// The dates on a document, told apart.
//
// A document can carry several dates and they mean different things: when it was
// issued, when it must be paid, when money actually moved. Treating them as one
// "date" is how an invoice ends up booked in the wrong period, or a due date is
// recorded as the issue date.
//
// Two rules run through everything here:
//   · the UPLOAD date is never a document date. If the paper does not say it, we
//     do not have it, and `not_found` is the honest answer.
//   · a date that could be read two ways is not a reading. Indonesian documents use
//     dd/mm; some systems emit mm/dd; 04/08/2026 is genuinely ambiguous and is
//     returned as needs_confirmation with the original string kept for review.
'use strict';

const MONTHS = {
  januari: 1, jan: 1, january: 1,
  februari: 2, feb: 2, february: 2, pebruari: 2,
  maret: 3, mar: 3, march: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6, june: 6,
  juli: 7, jul: 7, july: 7,
  agustus: 8, agu: 8, agt: 8, aug: 8, august: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nov: 11, nopember: 11,
  desember: 12, des: 12, dec: 12, december: 12,
};
const MONTH_WORDS = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Is this a real calendar date? Rejects 31 February and friends. */
function validDate(y, m, d) {
  if (!(y >= 1990 && y <= 2100) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const fourDigitYear = (y) => (y >= 100 ? y : y + (y < 70 ? 2000 : 1900));

/**
 * Parse one date string.
 * @returns { value, original, status, note } — value is ISO or null.
 *          status: 'detected' | 'needs_confirmation'
 */
function parseDate(raw) {
  const original = String(raw || '').trim();
  if (!original) return null;

  // 4 Agustus 2026 / 04 Aug 2026 — a named month cannot be ambiguous.
  const named = new RegExp(String.raw`\b(\d{1,2})\s*[-\s/]?\s*(${MONTH_WORDS})\.?\s*[-\s/,]?\s*(\d{2,4})\b`, 'i').exec(original);
  if (named) {
    const d = Number(named[1]); const m = MONTHS[named[2].toLowerCase()]; const y = fourDigitYear(Number(named[3]));
    if (validDate(y, m, d)) return { value: iso(y, m, d), original: named[0].trim(), status: 'detected', note: null };
  }

  // ISO first: 2026-08-04 is unambiguous by construction.
  const isoM = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(original);
  if (isoM) {
    const y = Number(isoM[1]); const m = Number(isoM[2]); const d = Number(isoM[3]);
    if (validDate(y, m, d)) return { value: iso(y, m, d), original: isoM[0].trim(), status: 'detected', note: null };
  }

  // 04/08/2026 or 04-08-2026. Indonesian documents are day-first, but a value that
  // is also valid month-first cannot be settled from the digits alone.
  const numeric = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(original);
  if (numeric) {
    const a = Number(numeric[1]); const b = Number(numeric[2]); const y = fourDigitYear(Number(numeric[3]));
    const dayFirst = validDate(y, b, a);      // a = day,   b = month
    const monthFirst = validDate(y, a, b);    // a = month, b = day
    if (dayFirst && monthFirst && a !== b) {
      return {
        value: iso(y, b, a), original: numeric[0].trim(), status: 'needs_confirmation',
        note: `Could be ${iso(y, b, a)} (day first) or ${iso(y, a, b)} (month first). Confirm the format.`,
      };
    }
    if (dayFirst) return { value: iso(y, b, a), original: numeric[0].trim(), status: 'detected', note: null };
    if (monthFirst) {
      return { value: iso(y, a, b), original: numeric[0].trim(), status: 'detected',
        note: 'Read as month-first; the day-first reading is not a valid date.' };
    }
  }
  return null;
}

/* ── which date is which ───────────────────────────────────────────────────
   Labels decide the role. A bare "Tanggal" is the document's own date; a due date
   always announces itself ("Jatuh Tempo", "Due Date"), and so does a payment. */

const LABELS = {
  due_date: [/jatuh\s*tempo/i, /\bdue\s*date\b/i, /batas\s*(?:waktu\s*)?pembayaran/i,
    /tanggal\s*jatuh\s*tempo/i, /\bpayment\s*due\b/i],
  payment_date: [/tanggal\s*(?:pembayaran|bayar|transfer|setor)/i, /\bpayment\s*date\b/i,
    /\bpaid\s*(?:on|date)\b/i, /tgl\s*transfer/i],
  document_date: [/tanggal\s*(?:faktur|invoice|kwitansi|dokumen|nota)?/i, /\bdate\b/i,
    /\binvoice\s*date\b/i, /\bdated\b/i, /tgl\b/i],
};

// Windows after a label are short: a date sits next to its label, and a longer reach
// would let the NEXT field's date answer for this one.
const WINDOW = 44;

function findLabelled(text, patterns) {
  for (const re of patterns) {
    const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text);
    if (!m) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + WINDOW);
    const parsed = parseDate(after);
    if (parsed) return { ...parsed, label: m[0].trim() };
  }
  return null;
}

const NOT_FOUND = { value: null, original: null, status: 'not_found', note: null };
const notApplicable = (why) => ({ value: null, original: null, status: 'not_applicable', note: why });

/**
 * Every date the document states, separated by role.
 *
 * @param text  the document text (embedded or an OCR transcript)
 * @param opts  { document_type }
 * @returns { document_date, due_date, payment_date } — each
 *          { value, original, status, note }, status one of
 *          detected | needs_confirmation | not_found | not_applicable
 */
function extractDates(text = '', opts = {}) {
  const t = String(text || '');
  const type = opts.document_type || 'unknown';

  const due = findLabelled(t, LABELS.due_date);
  const paid = findLabelled(t, LABELS.payment_date);

  // The document's own date, taken from a label that is NOT one of the others. The
  // due and payment matches are removed from consideration first so a single
  // "Jatuh Tempo: 04-09-2026" cannot also answer as the issue date.
  let docText = t;
  for (const found of [due, paid]) {
    if (found?.original) docText = docText.replace(found.original, ' ');
  }
  let doc = findLabelled(docText, LABELS.document_date);
  // Nothing labelled: a lone date on the page is still the document's date, but only
  // if exactly one candidate exists. Several unlabelled dates are not a reading.
  if (!doc) {
    // Named months count too — a kwitansi often prints "04 September 2026" bare.
    const anyDate = new RegExp(
      String.raw`\b\d{1,2}\s*[-\s/]?\s*(?:${MONTH_WORDS})\.?\s*[-\s/,]?\s*\d{2,4}\b`
      + String.raw`|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b`, 'gi');
    const all = [...docText.matchAll(anyDate)].map((m) => m[0]);
    const unique = [...new Set(all)];
    if (unique.length === 1) {
      const p = parseDate(unique[0]);
      if (p) doc = { ...p, label: null, note: p.note || 'No date label was found; this was the only date on the document.' };
    }
  }

  // A payment date belongs to documents that record a payment. On an invoice there is
  // nothing to record yet, so the honest answer is "not applicable", not "not found".
  const paymentBearing = ['receipt', 'payment_proof', 'bank_statement'].includes(type);

  return {
    document_date: doc || NOT_FOUND,
    due_date: due || NOT_FOUND,
    payment_date: paid || (paymentBearing ? NOT_FOUND
      : notApplicable('This kind of document does not record a payment date.')),
  };
}

module.exports = { extractDates, parseDate, validDate, MONTHS };
