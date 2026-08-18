// AI Accountant — Phase 2 CONTENT-based document classification.
//
// Phase 1 classified on file name + MIME only, so `scan.pdf` was always "needs review".
// This layer reads the text a PDF already carries and matches Indonesian document markers,
// then combines that with the Phase 1 filename signal.
//
// What this is NOT:
//   * not OCR — a scanned image has no embedded text and stays unknown/needs_review;
//   * not legal validation — a marker match says "this looks like an SK Kemenkumham letter",
//     never "this document is officially valid". Compliance-sensitive types always keep a
//     manual-confirmation path.
//
// Confidence never reaches certainty: high | medium | low | unknown. Only `high` is
// auto_classified; everything else is needs_review.
const { classify: classifyFilename } = require('./documentIntake');

// Markers per type. STRONG = a title/issuer/identifier that is close to unique for the type.
// WEAK = supporting vocabulary that alone means little (e.g. "PERSEROAN TERBATAS" appears on
// both an akta and an SK, so it can never be strong for either).
const CONTENT_RULES = {
  sk_kemenkumham: {
    strong: [
      [/keputusan\s+menteri\s+hukum/, 'KEPUTUSAN MENTERI HUKUM'],
      [/pengesahan\s+pendirian\s+badan\s+hukum/, 'PENGESAHAN PENDIRIAN BADAN HUKUM'],
      [/pengesahan\s+badan\s+hukum/, 'PENGESAHAN BADAN HUKUM'],
      [/kementerian\s+hukum/, 'KEMENTERIAN HUKUM'],
      [/\bahu\s*-\s*\d/, 'AHU- reference number'],
      [/kemenkumham/, 'KEMENKUMHAM'],
    ],
    weak: [
      [/perseroan\s+terbatas/, 'PERSEROAN TERBATAS'],
      [/republik\s+indonesia/, 'REPUBLIK INDONESIA'],
      [/direktur\s+jenderal\s+administrasi\s+hukum/, 'Direktorat Jenderal AHU'],
    ],
  },
  akta: {
    strong: [
      [/akta\s+pendirian/, 'AKTA PENDIRIAN'],
      [/akta\s+perubahan/, 'AKTA PERUBAHAN'],
      [/\bnotaris\b/, 'NOTARIS'],
      [/deed\s+of\s+establishment/, 'DEED OF ESTABLISHMENT'],
    ],
    weak: [
      [/perseroan\s+terbatas/, 'PERSEROAN TERBATAS'],
      [/nomor\s+akta/, 'nomor akta'],
      [/berkedudukan\s+di/, 'berkedudukan di'],
    ],
  },
  npwp: {
    strong: [
      [/nomor\s+pokok\s+wajib\s+pajak/, 'NOMOR POKOK WAJIB PAJAK'],
      [/\bnpwp\b/, 'NPWP'],
      [/\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}/, 'NPWP number format'],
    ],
    weak: [
      [/direktorat\s+jenderal\s+pajak/, 'Direktorat Jenderal Pajak'],
      [/terdaftar\s+sejak/, 'terdaftar sejak'],
    ],
  },
  nib: {
    strong: [
      [/nomor\s+induk\s+berusaha/, 'NOMOR INDUK BERUSAHA'],
      [/\bnib\b/, 'NIB'],
      [/perizinan\s+berusaha\s+berbasis\s+risiko/, 'Perizinan Berusaha Berbasis Risiko'],
    ],
    weak: [
      [/\boss\b/, 'OSS'],
      [/lembaga\s+pengelola\s+dan\s+penyelenggara\s+oss/, 'Lembaga OSS'],
      [/\bkbli\b/, 'KBLI'],
    ],
  },
  pkp_certificate: {
    strong: [
      [/pengusaha\s+kena\s+pajak/, 'PENGUSAHA KENA PAJAK'],
      [/\bsppkp\b/, 'SPPKP'],
      [/surat\s+pengukuhan/, 'SURAT PENGUKUHAN'],
    ],
    weak: [[/\bpkp\b/, 'PKP'], [/pajak\s+pertambahan\s+nilai/, 'PPN']],
  },
  kpp_registration: {
    strong: [
      [/kantor\s+pelayanan\s+pajak/, 'KANTOR PELAYANAN PAJAK'],
      [/surat\s+keterangan\s+terdaftar/, 'SURAT KETERANGAN TERDAFTAR'],
    ],
    weak: [[/\bkpp\b/, 'KPP'], [/\bsket\b/, 'SKET']],
  },
  bpjs_document: {
    strong: [
      [/bpjs\s+ketenagakerjaan/, 'BPJS KETENAGAKERJAAN'],
      [/bpjs\s+kesehatan/, 'BPJS KESEHATAN'],
      [/\bbpjs\b/, 'BPJS'],
    ],
    weak: [[/jaminan\s+(sosial|kesehatan|hari\s+tua)/, 'jaminan sosial'], [/\bjamsostek\b/, 'JAMSOSTEK']],
  },
  payroll_document: {
    strong: [
      [/slip\s+gaji/, 'SLIP GAJI'],
      [/daftar\s+gaji/, 'DAFTAR GAJI'],
      [/\bpayslip\b/, 'PAYSLIP'],
      [/payroll\s+(register|report|summary)/, 'payroll report'],
    ],
    weak: [[/\bgaji\b/, 'gaji'], [/net\s+pay\b/, 'net pay'], [/\btunjangan\b/, 'tunjangan']],
  },
  bank_statement: {
    strong: [
      [/rekening\s+koran/, 'REKENING KORAN'],
      [/mutasi\s+rekening/, 'MUTASI REKENING'],
      [/bank\s+statement/, 'BANK STATEMENT'],
      [/account\s+statement/, 'ACCOUNT STATEMENT'],
    ],
    weak: [[/saldo\s+(awal|akhir)/, 'saldo awal/akhir'], [/\bdebit\b.*\bkredit\b/, 'debit/kredit columns']],
  },
  tax_report: {
    strong: [
      [/surat\s+pemberitahuan\s+(tahunan|masa)/, 'SPT'],
      [/\bspt\s+(tahunan|masa)\b/, 'SPT'],
      [/bukti\s+penerimaan\s+elektronik/, 'Bukti Penerimaan Elektronik'],
    ],
    weak: [[/e-?filing/, 'e-filing'], [/\bnpwp\b/, 'NPWP reference']],
  },
  tax_payment_proof: {
    strong: [
      [/\bntpn\b/, 'NTPN'],
      [/bukti\s+penerimaan\s+negara/, 'Bukti Penerimaan Negara'],
      [/kode\s+billing/, 'KODE BILLING'],
    ],
    weak: [[/surat\s+setoran\s+pajak/, 'SSP'], [/\bbank\s+persepsi\b/, 'bank persepsi']],
  },
  oss_license: {
    strong: [
      [/izin\s+usaha\s+industri/, 'IZIN USAHA INDUSTRI'],
      [/sertifikat\s+standar/, 'SERTIFIKAT STANDAR'],
      [/business\s+licen[cs]e/, 'business licence'],
    ],
    weak: [[/\boss\b/, 'OSS'], [/\bkbli\b/, 'KBLI']],
  },
  invoice: {
    strong: [[/\bfaktur\s+pajak\b/, 'FAKTUR PAJAK'], [/\binvoice\s+(no|number|date)\b/, 'invoice header']],
    weak: [[/\binvoice\b/, 'invoice'], [/\btagihan\b/, 'tagihan'], [/jumlah\s+yang\s+harus\s+dibayar/, 'amount due']],
  },
};

const STRONG_MIN_FOR_HIGH = 2;   // one marker is never enough to auto-classify

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ');

// Score every type against the text. Returns ranked candidates.
function scoreContent(text) {
  const t = norm(text);
  if (!t) return [];
  const out = [];
  for (const [type, rules] of Object.entries(CONTENT_RULES)) {
    const strong = rules.strong.filter(([re]) => re.test(t)).map(([, label]) => label);
    const weak = rules.weak.filter(([re]) => re.test(t)).map(([, label]) => label);
    if (!strong.length && !weak.length) continue;
    out.push({ type, strong, weak, score: strong.length * 10 + weak.length });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Look for the company name in the text — a supporting signal, never decisive.
function companyNameMatch(text, companyName) {
  const name = String(companyName || '').trim();
  if (name.length < 4) return null;
  const needle = norm(name).replace(/^(pt|cv)\s+/, '');
  return norm(text).includes(needle) ? name : null;
}

// A short, sanitised sample for the "why" line. Never the whole document, never numbers that
// could be an identifier: digit runs of 4+ are masked.
function safeSample(text, max = 160) {
  return norm(text).slice(0, max).replace(/\d{4,}/g, '####').trim();
}

/**
 * Layered classification: filename/MIME (Phase 1) + document content (Phase 2).
 *
 * @param {object} input
 *   @param {string} input.file_name
 *   @param {string} input.mime_type
 *   @param {string} [input.text]            extracted text ('' when unavailable)
 *   @param {boolean} [input.text_available]
 *   @param {string} [input.method]          'pdf_text' | 'ocr' | 'filename_only'
 *   @param {string} [input.company_name]
 * @returns {{doc_type, confidence, classification_status, matched_on, signals, extraction}}
 */
function classifyDocument({ file_name, mime_type, text = '', text_available = false,
                            method = 'filename_only', company_name = null, extraction_reason = null } = {}) {
  const fromName = classifyFilename({ file_name, mime_type });
  const filenameMatches = fromName.doc_type && fromName.doc_type !== 'unknown' ? [fromName.doc_type] : [];

  const extraction = {
    text_available: !!text_available,
    method: text_available ? method : 'filename_only',
    reason: text_available ? null : extraction_reason,
    text_sample_safe: text_available ? safeSample(text) : null,
  };

  // ── no usable text → Phase 1 result, unchanged ────────────────────────────
  if (!text_available || !text) {
    return {
      ...fromName,
      signals: { filename_matches: filenameMatches, text_matches: [], company_name_match: null, mime_type: mime_type || null },
      extraction,
    };
  }

  const ranked = scoreContent(text);
  const best = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  const company = companyNameMatch(text, company_name);

  // No content signal at all: fall back to the filename verdict, but a filename-only verdict
  // on a document we COULD read is never better than medium — the text carried no marker.
  if (!best) {
    const downgraded = fromName.doc_type && fromName.doc_type !== 'unknown'
      ? { ...fromName, confidence: 'medium', classification_status: 'needs_review', matched_on: 'file_name_only' }
      : { doc_type: 'unknown', confidence: 'unknown', classification_status: 'needs_review', matched_on: 'no_signal' };
    return {
      ...downgraded,
      signals: { filename_matches: filenameMatches, text_matches: [], company_name_match: company, mime_type: mime_type || null },
      extraction,
    };
  }

  const agrees = fromName.doc_type === best.type;
  const filenameConflicts = filenameMatches.length && !agrees;
  // A close second candidate means the markers do not point at one type.
  const ambiguous = !!runnerUp && runnerUp.score >= best.score;

  let confidence, matched_on;
  if (ambiguous) {
    confidence = 'low'; matched_on = 'content_ambiguous';
  } else if (best.strong.length >= STRONG_MIN_FOR_HIGH || (best.strong.length >= 1 && agrees)) {
    // Two independent strong markers, or one strong marker corroborated by the file name.
    confidence = 'high'; matched_on = agrees ? 'content_and_file_name' : 'content';
  } else if (best.strong.length >= 1) {
    confidence = 'medium'; matched_on = 'content';
  } else {
    confidence = 'low'; matched_on = 'content_weak';
  }

  // A file name that claims a DIFFERENT type is a disagreement the user must settle.
  // Content still wins the proposed type — it is the stronger evidence — but never silently.
  if (filenameConflicts && confidence === 'high') { confidence = 'medium'; matched_on = 'content_over_file_name_conflict'; }

  return {
    doc_type: best.type,
    confidence,
    classification_status: confidence === 'high' ? 'auto_classified' : 'needs_review',
    matched_on,
    signals: {
      filename_matches: filenameMatches,
      text_matches: [...best.strong, ...best.weak],
      strong_matches: best.strong,
      company_name_match: company,
      conflict: filenameConflicts ? { file_name_suggests: fromName.doc_type, content_suggests: best.type } : null,
      mime_type: mime_type || null,
    },
    extraction,
  };
}

// Human-readable justification for the UI. Marker labels only — never document text.
function explain(result) {
  const s = result?.signals || {};
  const strong = s.strong_matches || [];
  if (strong.length) {
    const list = strong.slice(0, 3).map(m => `“${m}”`).join(' and ');
    const why = `Detected because the document contains ${list}.`;
    return s.conflict
      ? `${why} The file name suggests a different type, so please confirm.`
      : why;
  }
  if ((s.text_matches || []).length) return `Detected from supporting wording in the document. Please confirm the type.`;
  if ((s.filename_matches || []).length) return `Detected from the file name only — the document text could not be read.`;
  return 'No clear signal found — please choose the document type.';
}

module.exports = { classifyDocument, scoreContent, explain, safeSample, CONTENT_RULES, STRONG_MIN_FOR_HIGH };
