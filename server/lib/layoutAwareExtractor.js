'use strict';
/**
 * CFO AI — Layout-Aware Accounting Extractor V2
 * 
 * Extracts high-precision financial & identity fields from OCR structured output
 * (pages, lines, bounding boxes) or fallback plain text.
 * 
 * Specialized handlers for 5 Indonesian accounting document types:
 * 1. commercial_invoice
 * 2. receipt (thermal store struk)
 * 3. kwitansi (traditional cash payment receipt)
 * 4. faktur_pajak (DJP electronic tax invoice)
 * 5. bank_statement (rekening koran with structured transaction rows)
 * 
 * HARD INVARIANTS:
 * - Zero auto-posting: All fields are SUGGESTIONS for accountant review.
 * - Honest nulls: Never invent numbers or guess missing fields.
 * - Spatial Evidence: Every extracted field preserves bounding box, page, confidence.
 */

const { parseAmount } = require('./invoiceSettlement');

/* ── Number & Date Helpers ─────────────────────────────────────────────────── */

function parseIndonesianAmount(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  const s = String(val).trim();

  // Strip currency prefixes and suffixes
  let clean = s.replace(/^(?:rp\.?|idr)\s*/i, '')
               .replace(/,\s*-\s*$/, '')
               .replace(/[-\s.]+$/, '')
               .trim();

  // If ends with DB or CR
  clean = clean.replace(/\s*(?:db|cr)\b/i, '').trim();

  // "5.550.000,00" -> 5550000
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(clean)) {
    const numStr = clean.replace(/\./g, '').replace(/,/g, '.');
    const n = Number(numStr);
    return isFinite(n) ? n : null;
  }
  // "5,550,000.00"
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(clean)) {
    const numStr = clean.replace(/,/g, '');
    const n = Number(numStr);
    return isFinite(n) ? n : null;
  }
  // Standard digits or parseAmount
  return parseAmount(clean);
}

function parseIndonesianDate(val) {
  if (!val) return null;
  const s = String(val).trim();

  // Match DD/MM/YYYY or DD-MM-YYYY
  const mNum = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (mNum) {
    let day = mNum[1].padStart(2, '0');
    let month = mNum[2].padStart(2, '0');
    let year = mNum[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }

  // Indonesian month names
  const months = {
    jan: '01', januari: '01', january: '01',
    feb: '02', februari: '02', february: '02',
    mar: '03', maret: '03', march: '03',
    apr: '04', april: '04',
    mei: '05', may: '05',
    jun: '06', juni: '06', june: '06',
    jul: '07', juli: '07', july: '07',
    agu: '08', ags: '08', agustus: '08', august: '08',
    sep: '09', september: '09',
    okt: '10', oktober: '10', october: '10', '0kt': '10', '0ktober': '10',
    nov: '11', nop: '11', november: '11',
    des: '12', desember: '12', december: '12'
  };

  const mWord = /(\d{1,2})\s*([A-Za-z0-9]{3,9})\s*(\d{4})/i.exec(s);
  if (mWord) {
    const day = mWord[1].padStart(2, '0');
    const mStr = mWord[2].toLowerCase();
    const month = months[mStr] || null;
    const year = mWord[3];
    if (month) return `${year}-${month}-${day}`;
  }

  return null;
}

function cleanNpwp(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Do NOT match Faktur Pajak serials (e.g. 010.026-26.00000881)
  if (/faktur|seri|faktur\s*pajak/i.test(s)) return null;

  // Strict 15-digit punctuated NPWP: XX.XXX.XXX.X-XXX.XXX
  const mStrict = /(\d{2}\.\d{3}\.\d{3}\.\d[-.]\d{3}\.\d{3})/.exec(s);
  if (mStrict) return mStrict[1];

  // 15 or 16 unpunctuated digits: must NOT start with 010, 020, 030, etc. (tax codes)
  const digits = s.replace(/[\s.-]/g, '');
  if (/^\d{15,16}$/.test(digits) && !/^(0[1-9]0)/.test(digits)) {
    return digits;
  }
  return null;
}

/* ── Spatial Geometry Engine ───────────────────────────────────────────────── */

function buildSpatialLines(lines = []) {
  return lines.map((item, idx) => {
    const text = String(item.text || '').trim();
    const conf = Number(item.confidence || 0);
    const box = item.box || [];
    let xmin = 0, ymin = 0, xmax = 0, ymax = 0;
    if (box.length >= 4) {
      const xs = box.map(p => Number(p[0]) || 0);
      const ys = box.map(p => Number(p[1]) || 0);
      xmin = Math.min(...xs);
      xmax = Math.max(...xs);
      ymin = Math.min(...ys);
      ymax = Math.max(...ys);
    }
    return {
      id: idx,
      text,
      confidence: conf,
      box,
      xmin,
      xmax,
      ymin,
      ymax,
      cx: (xmin + xmax) / 2,
      cy: (ymin + ymax) / 2,
      height: Math.max(1, ymax - ymin),
      width: Math.max(1, xmax - xmin)
    };
  });
}

function findRightOf(spatialLines, targetLine, maxDistanceX = 650, deltaYRatio = 0.8) {
  const threshold = Math.max(targetLine.height, 20) * deltaYRatio;
  const candidates = spatialLines.filter(l => 
    l.id !== targetLine.id &&
    l.xmin >= (targetLine.xmax - 10) &&
    (l.xmin - targetLine.xmax) <= maxDistanceX &&
    Math.abs(l.cy - targetLine.cy) <= threshold
  );
  return candidates.sort((a, b) => a.xmin - b.xmin)[0] || null;
}

function findBelow(spatialLines, targetLine, maxDistanceY = 80, maxDeltaX = 250) {
  const candidates = spatialLines.filter(l => 
    l.id !== targetLine.id &&
    l.ymin >= (targetLine.ymax - 5) &&
    (l.ymin - targetLine.ymax) <= maxDistanceY &&
    Math.abs(l.xmin - targetLine.xmin) <= maxDeltaX
  );
  return candidates.sort((a, b) => a.ymin - b.ymin)[0] || null;
}

function getAmountFromLineOrNext(spatialLines, idx, labelLine) {
  // 1. Check right of line
  const right = findRightOf(spatialLines, labelLine, 650);
  if (right) {
    const amt = parseIndonesianAmount(right.text);
    if (amt !== null) return { amt, line: right };
  }

  // 2. Check current line remainder
  const selfAmt = parseIndonesianAmount(labelLine.text.replace(/^[A-Za-z\s():%0-9.,-]+?[:=]\s*/, ''));
  if (selfAmt !== null) return { amt: selfAmt, line: labelLine };

  // 3. Check next line (idx + 1)
  const next1 = spatialLines[idx + 1];
  if (next1) {
    if (/^(?:rp\.?|idr)$/i.test(next1.text.trim())) {
      // Currency symbol on its own line: check idx + 2!
      const next2 = spatialLines[idx + 2];
      if (next2) {
        const amt2 = parseIndonesianAmount(next2.text);
        if (amt2 !== null) return { amt: amt2, line: next2 };
      }
    } else {
      const amt1 = parseIndonesianAmount(next1.text);
      if (amt1 !== null) return { amt: amt1, line: next1 };
    }
  }

  return { amt: null, line: null };
}

/* ── Document Type Classifier (V2) ─────────────────────────────────────────── */

function classifyDocumentType(fullText = '') {
  const t = fullText.toLowerCase();

  // 1. Bank Statement
  if (/rekening\s*koran/i.test(t) || /account\s*statement/i.test(t) || /mutasi\s*rekening/i.test(t)) {
    return 'bank_statement';
  }

  // 2. Kwitansi
  const isKwitansi = /\bkwitansi\b/i.test(t) || /\bkuitansi\b/i.test(t) || /sudah\s*terima\s*dari/i.test(t);
  if (isKwitansi) return 'kwitansi';

  // 3. Struk / Thermal Receipt
  const isStruk = /\bstruk\b/i.test(t) || /struk\s*penjualan/i.test(t) || 
                  (/\bkasir\b/i.test(t) && /\btotal\b/i.test(t) && (/\bqris\b/i.test(t) || /\btunai\b/i.test(t)));
  if (isStruk) return 'receipt';

  // 4. Faktur Pajak vs Commercial Invoice Disambiguation
  const hasInvoiceTitle = /\b(?:invoice|tagihan|faktur\s*\/\s*invoice)\b/i.test(t);
  const hasFakturTitle = /faktur\s*pajak/i.test(t);
  const hasFakturSerial = /kode\s*dan\s*nomor\s*seri\s*faktur\s*pajak/i.test(t);

  // If both invoice and faktur are present (e.g. multi-page package), invoice is the primary commercial billing entity
  if (hasInvoiceTitle) {
    return 'invoice';
  }
  if (hasFakturTitle && hasFakturSerial) {
    return 'faktur_pajak';
  }
  if (hasFakturTitle) {
    return 'faktur_pajak';
  }

  return 'unknown';
}

/* ── Specialized Extractor: Invoice ────────────────────────────────────────── */

function extractInvoice(spatialLines, fullText) {
  const fields = {
    document_type: 'invoice',
    document_number: null,
    invoice_date: null,
    due_date: null,
    issuer_name: null,
    issuer_npwp: null,
    buyer_name: null,
    buyer_npwp: null,
    currency: 'IDR',
    tax_base_dpp: null,
    tax_rate: null,
    tax_amount: null,
    gross_amount: null,
    payee_bank: null,
    payee_account_number: null,
    payee_account_name: null,
    tax_invoice_serial: null,
    line_items: []
  };
  const evidence = {};

  // 1. Document Number
  for (let idx = 0; idx < spatialLines.length; idx++) {
    const line = spatialLines[idx];
    const m = /(?:nomor\s*invoice|no\.?\s*invoice|invoice\s*no\.?)\s*[:=]?\s*([A-Z0-9/.\-_]{4,30})/i.exec(line.text)
      || /^(?:no\.?|nomor)\s*[:=]?\s*([A-Z0-9/.\-_]{4,30})/i.exec(line.text);
    if (m) {
      fields.document_number = m[1].trim();
      evidence.document_number = { text: line.text, box: line.box, confidence: line.confidence };
      break;
    }
    if (/^(?:nomor\s*invoice|no\.?\s*invoice|invoice\s*no\.?|no\.?|nomor)\s*[:=]?$/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 300) || spatialLines[idx + 1];
      if (right && /^[A-Z0-9/.\-_]{4,30}$/i.test(right.text.trim())) {
        fields.document_number = right.text.trim();
        evidence.document_number = { text: right.text, box: right.box, confidence: right.confidence };
        break;
      }
    }
  }

  // 2. Dates
  for (const line of spatialLines) {
    if (/tanggal\s*(?:terbit|invoice)?/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 300) || line;
      const d = parseIndonesianDate(right.text);
      if (d) {
        fields.invoice_date = d;
        evidence.invoice_date = { text: right.text, box: right.box, confidence: right.confidence };
      }
    }
    if (/jatuh\s*tempo|due\s*date/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 300) || line;
      const d = parseIndonesianDate(right.text);
      if (d) {
        fields.due_date = d;
        evidence.due_date = { text: right.text, box: right.box, confidence: right.confidence };
      }
    }
  }

  // 3. Parties & NPWPs
  const npwpCandidates = [];
  for (const line of spatialLines) {
    if (/faktur\s*pajak|kode\s*faktur/i.test(line.text)) continue;
    const npwp = cleanNpwp(line.text);
    if (npwp) npwpCandidates.push({ npwp, line });
  }

  if (npwpCandidates.length >= 2) {
    fields.issuer_npwp = npwpCandidates[0].npwp;
    evidence.issuer_npwp = { text: npwpCandidates[0].line.text, box: npwpCandidates[0].line.box, confidence: npwpCandidates[0].line.confidence };
    fields.buyer_npwp = npwpCandidates[1].npwp;
    evidence.buyer_npwp = { text: npwpCandidates[1].line.text, box: npwpCandidates[1].line.box, confidence: npwpCandidates[1].line.confidence };
  } else if (npwpCandidates.length === 1) {
    fields.issuer_npwp = npwpCandidates[0].npwp;
    evidence.issuer_npwp = { text: npwpCandidates[0].line.text, box: npwpCandidates[0].line.box, confidence: npwpCandidates[0].line.confidence };
  }

  // Company names
  for (const line of spatialLines) {
    if (!fields.issuer_name && /^PT\s+[A-Z0-9\s.&'-]{3,60}/i.test(line.text) && line.ymin < 200) {
      fields.issuer_name = line.text.replace(/^PT\s+/i, 'PT ').trim();
      evidence.issuer_name = { text: line.text, box: line.box, confidence: line.confidence };
    }
    if (/ditujukan\s*kepada|customer|bill\s*to/i.test(line.text)) {
      const below = findBelow(spatialLines, line, 60, 200);
      if (below && /^PT\s+[A-Z0-9\s.&'-]{3,60}/i.test(below.text)) {
        fields.buyer_name = below.text.replace(/^PT\s+/i, 'PT ').trim();
        evidence.buyer_name = { text: below.text, box: below.box, confidence: below.confidence };
      }
    }
  }

  // 4. Financial Amounts
  for (let idx = 0; idx < spatialLines.length; idx++) {
    const line = spatialLines[idx];

    // DPP
    if (/dasar\s*pengenaan\s*pajak|\bdpp\b/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) {
        fields.tax_base_dpp = res.amt;
        evidence.tax_base_dpp = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }

    // PPN
    if (/\bppn\b|pajak\s*pertambahan\s*nilai/i.test(line.text)) {
      const mRate = /(\d{1,2}(?:\.\d+)?)\s*%/i.exec(line.text);
      if (mRate) fields.tax_rate = Number(mRate[1]) / 100.0;

      // Check next line in reading order first to prevent skewed horizontal drift
      let candidateAmt = null;
      let candidateLine = null;
      if (spatialLines[idx + 1]) {
        const nextAmt = parseIndonesianAmount(spatialLines[idx + 1].text);
        if (nextAmt !== null && nextAmt > 0 && nextAmt !== fields.tax_base_dpp) {
          candidateAmt = nextAmt;
          candidateLine = spatialLines[idx + 1];
        }
      }
      if (candidateAmt === null) {
        const res = getAmountFromLineOrNext(spatialLines, idx, line);
        if (res.amt !== null && res.amt !== fields.tax_base_dpp) {
          candidateAmt = res.amt;
          candidateLine = res.line;
        }
      }
      if (candidateAmt !== null) {
        fields.tax_amount = candidateAmt;
        evidence.tax_amount = { text: candidateLine?.text || line.text, box: candidateLine?.box || line.box, confidence: candidateLine?.confidence || line.confidence };
      }
    }

    // Gross Total
    if (/total\s*tagihan|grand\s*total|total\s*amount/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) {
        fields.gross_amount = res.amt;
        evidence.gross_amount = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }
  }

  // Arithmetic reconciliation
  if (fields.tax_base_dpp !== null && fields.tax_amount === null && fields.tax_rate !== null) {
    fields.tax_amount = Math.round(fields.tax_base_dpp * fields.tax_rate);
  }
  if (fields.gross_amount === null && fields.tax_base_dpp !== null && fields.tax_amount !== null) {
    fields.gross_amount = fields.tax_base_dpp + fields.tax_amount;
  }

  // Payment Bank Details
  for (const line of spatialLines) {
    const mBank = /nama\s*bank\s*[:=]?\s*([^\n\r]+)/i.exec(line.text);
    if (mBank) fields.payee_bank = mBank[1].trim();

    const mRek = /(?:nomor\s*rekening|no\.?\s*rek)\s*[:=]?\s*([0-9\s\-.]+)/i.exec(line.text);
    if (mRek) fields.payee_account_number = mRek[1].replace(/[\s.-]/g, '');

    const mFakturRef = /kode\s*faktur\s*pajak\s*[:=]?\s*([0-9.\-]+)/i.exec(line.text);
    if (mFakturRef) fields.tax_invoice_serial = mFakturRef[1].trim();
  }

  return { fields, evidence };
}

/* ── Specialized Extractor: Receipt (Thermal Struk) ────────────────────────── */

function extractReceipt(spatialLines, fullText) {
  const fields = {
    document_type: 'receipt',
    merchant_name: null,
    merchant_npwp: null,
    document_number: null,
    date: null,
    time: null,
    cashier: null,
    subtotal: null,
    tax_base_dpp: null,
    tax_rate: null,
    tax_amount: null,
    gross_amount: null,
    payment_method: null,
    currency: 'IDR',
    line_items: []
  };
  const evidence = {};

  if (spatialLines[0]) {
    fields.merchant_name = spatialLines[0].text;
    evidence.merchant_name = { text: spatialLines[0].text, box: spatialLines[0].box, confidence: spatialLines[0].confidence };
  }
  for (const line of spatialLines.slice(0, 5)) {
    const npwp = cleanNpwp(line.text);
    if (npwp) {
      fields.merchant_npwp = npwp;
      evidence.merchant_npwp = { text: line.text, box: line.box, confidence: line.confidence };
      break;
    }
  }

  for (let idx = 0; idx < spatialLines.length; idx++) {
    const line = spatialLines[idx];

    if (/^no\s*[:=]?/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 300) || spatialLines[idx + 1];
      const val = right ? right.text : line.text.replace(/^no\s*[:=]?\s*/i, '');
      fields.document_number = val.trim();
      evidence.document_number = { text: val, box: line.box, confidence: line.confidence };
    }
    if (/^tanggal\s*[:=]?/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 300) || spatialLines[idx + 1];
      const val = right ? right.text : line.text.replace(/^tanggal\s*[:=]?\s*/i, '');
      const d = parseIndonesianDate(val);
      if (d) fields.date = d;
      const mTime = /(\d{2}:\d{2}(?::\d{2})?)/.exec(val);
      if (mTime) fields.time = mTime[1];
    }
    if (/^kasir\s*[:=]?/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 200) || spatialLines[idx + 1];
      fields.cashier = right ? right.text.trim() : line.text.replace(/^kasir\s*[:=]?\s*/i, '').trim();
    }

    // Subtotal
    if (/^subtotal\b/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) {
        fields.subtotal = res.amt;
        evidence.subtotal = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }

    // DPP: handles ":aad", "DPP", "DPP:" or value right after
    if (/^dpp\b|^:aad\b/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) {
        fields.tax_base_dpp = res.amt;
        evidence.tax_base_dpp = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }

    // PPN
    if (/ppn\s*11[%$号]|^ppn\b/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) {
        fields.tax_amount = res.amt;
        fields.tax_rate = 0.11;
        evidence.tax_amount = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }

    // Total
    if (/^total\b/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) {
        fields.gross_amount = res.amt;
        evidence.gross_amount = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }

    if (/bayar\s*\(([^)]+)\)|bayar\s*[:=]?/i.test(line.text)) {
      const m = /bayar\s*\(([^)]+)\)/i.exec(line.text);
      if (m) fields.payment_method = m[1].trim();
    }
  }

  // Reconciliation for receipts
  if (fields.tax_base_dpp === null && fields.gross_amount !== null && fields.tax_amount !== null) {
    fields.tax_base_dpp = fields.gross_amount - fields.tax_amount;
  }
  if (fields.gross_amount === null && fields.subtotal !== null) {
    fields.gross_amount = fields.subtotal;
  }

  return { fields, evidence };
}

/* ── Specialized Extractor: Kwitansi ───────────────────────────────────────── */

function extractKwitansi(spatialLines, fullText) {
  const fields = {
    document_type: 'kwitansi',
    document_number: null,
    date: null,
    issuer_name: null,
    payer_name: null,
    buyer_npwp: null,
    amount_words: null,
    payment_purpose: null,
    gross_amount: null,
    tax_base_dpp: null,
    tax_amount: 0,
    currency: 'IDR',
    has_meterai: false
  };
  const evidence = {};

  for (let idx = 0; idx < spatialLines.length; idx++) {
    const line = spatialLines[idx];

    if (/nomor\s*[:=]?\s*([A-Z0-9/.\-_]+)/i.test(line.text)) {
      const m = /nomor\s*[:=]?\s*([A-Z0-9/.\-_]+)/i.exec(line.text);
      fields.document_number = m[1].trim();
      evidence.document_number = { text: line.text, box: line.box, confidence: line.confidence };
    }
    if (/sudah\s*terima\s*dari/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 500) || spatialLines[idx + 1];
      const textToScan = right ? right.text : line.text;
      const mName = /(?:sudah\s*terima\s*dari\s*[:=]?)?\s*([^(]+)/i.exec(textToScan);
      if (mName) {
        fields.payer_name = mName[1].replace(/^(?:pt|cv)\s+/i, 'PT ').trim();
        evidence.payer_name = { text: textToScan, box: line.box, confidence: line.confidence };
      }
      const npwp = cleanNpwp(textToScan);
      if (npwp) fields.buyer_npwp = npwp;
    }
    if (/uang\s*sejumlah/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 500) || spatialLines[idx + 1];
      fields.amount_words = right ? right.text.trim() : line.text.replace(/uang\s*sejumlah\s*[:=]?\s*/i, '').trim();
    }
    if (/untuk\s*pembayaran/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 500) || spatialLines[idx + 1];
      fields.payment_purpose = right ? right.text.trim() : line.text.replace(/untuk\s*pembayaran\s*[:=]?\s*/i, '').trim();
    }
    if (/terbilang\s*[:=]?\s*(?:rp\.?\s*)?(\d[\d.,]*\d)/i.test(line.text)) {
      const m = /terbilang\s*[:=]?\s*(?:rp\.?\s*)?(\d[\d.,]*\d)/i.exec(line.text);
      const amt = parseIndonesianAmount(m[1]);
      if (amt !== null) {
        fields.gross_amount = amt;
        fields.tax_base_dpp = amt;
        evidence.gross_amount = { text: line.text, box: line.box, confidence: line.confidence };
      }
    }
    const mCityDate = /(?:denpasar|jakarta|surabaya|bandung|kuta|bali)[,\s]+(\d{1,2}\s*[A-Za-z]+\s*\d{4})/i.exec(line.text);
    if (mCityDate) {
      fields.date = parseIndonesianDate(mCityDate[1]);
      evidence.date = { text: line.text, box: line.box, confidence: line.confidence };
    }
    if (/\((?:I\s+)?[A-Z][A-Za-z\s.'-]+\)/.test(line.text) && /yang\s*menerima/i.test(fullText)) {
      fields.issuer_name = line.text.replace(/[()]/g, '').trim();
    }
    if (/meterai/i.test(line.text)) {
      fields.has_meterai = true;
    }
  }

  return { fields, evidence };
}

/* ── Specialized Extractor: Faktur Pajak ───────────────────────────────────── */

function extractFakturPajak(spatialLines, fullText) {
  const fields = {
    document_type: 'faktur_pajak',
    document_number: null,
    tax_invoice_serial: null,
    invoice_date: null,
    issuer_name: null,
    issuer_npwp: null,
    issuer_address: null,
    buyer_name: null,
    buyer_npwp: null,
    buyer_address: null,
    tax_base_dpp: null,
    tax_rate: null,
    tax_amount: null,
    luxury_tax: 0,
    gross_amount: null,
    approval_status: null
  };
  const evidence = {};

  for (let idx = 0; idx < spatialLines.length; idx++) {
    const line = spatialLines[idx];

    // Serial
    const mSerial = /(?:kode\s*dan\s*nomor\s*seri\s*faktur\s*pajak\s*[:=]?\s*)([\d.\-]+)/i.exec(line.text);
    if (mSerial) {
      fields.tax_invoice_serial = mSerial[1].trim();
      fields.document_number = mSerial[1].trim();
      evidence.tax_invoice_serial = { text: line.text, box: line.box, confidence: line.confidence };
    }

    // Amounts
    if (/dasar\s*pengenaan\s*pajak\s*\(dpp\)/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) {
        fields.tax_base_dpp = res.amt;
        evidence.tax_base_dpp = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }
    if (/jumlah\s*ppn\s*yang\s*terutang/i.test(line.text)) {
      const mRate = /(\d{1,2}(?:\.\d+)?)\s*%/i.exec(line.text);
      if (mRate) fields.tax_rate = Number(mRate[1]) / 100.0;

      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null && res.amt > 100) {
        fields.tax_amount = res.amt;
        evidence.tax_amount = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }
    // Tax-Exempt (Kode 070 / Bebas PPN / 0%)
    if (/ppn\s*yang\s*(?:dibebaskan|tidak\s*dipungut)|fasilitas\s*.*0%/i.test(line.text)) {
      fields.tax_amount = 0;
      fields.tax_rate = 0.0;
      evidence.tax_amount = { text: line.text, box: line.box, confidence: line.confidence };
    }
    if (/approval\s*sukses/i.test(line.text)) {
      fields.approval_status = 'APPROVAL SUKSES';
    }
    if (/tanggal\s*faktur\s*[:=]?\s*(\d{1,2}\s*[A-Za-z]+\s*\d{4})/i.test(line.text)) {
      const m = /tanggal\s*faktur\s*[:=]?\s*(\d{1,2}\s*[A-Za-z]+\s*\d{4})/i.exec(line.text);
      fields.invoice_date = parseIndonesianDate(m[1]);
    }
    if (/(\d{1,2}\s*[A-Za-z]+\s*\d{4})/.test(line.text) && !fields.invoice_date) {
      const m = /(\d{1,2}\s*[A-Za-z]+\s*\d{4})/.exec(line.text);
      fields.invoice_date = parseIndonesianDate(m[1]);
    }
  }

  // Derive gross amount
  if (fields.tax_base_dpp !== null && fields.tax_amount !== null) {
    fields.gross_amount = fields.tax_base_dpp + fields.tax_amount;
    evidence.gross_amount = { text: `Derived: DPP (${fields.tax_base_dpp}) + PPN (${fields.tax_amount})`, confidence: 1.0 };
  }

  // NPWPs strictly punctuated
  const npwps = [];
  for (const line of spatialLines) {
    const npwp = cleanNpwp(line.text);
    if (npwp) npwps.push({ npwp, line });
  }
  if (npwps.length >= 2) {
    fields.issuer_npwp = npwps[0].npwp;
    evidence.issuer_npwp = { text: npwps[0].line.text, box: npwps[0].line.box, confidence: npwps[0].line.confidence };
    fields.buyer_npwp = npwps[1].npwp;
    evidence.buyer_npwp = { text: npwps[1].line.text, box: npwps[1].line.box, confidence: npwps[1].line.confidence };
  } else if (npwps.length === 1) {
    fields.issuer_npwp = npwps[0].npwp;
    evidence.issuer_npwp = { text: npwps[0].line.text, box: npwps[0].line.box, confidence: npwps[0].line.confidence };
  }

  return { fields, evidence };
}

/* ── Specialized Extractor: Bank Statement ─────────────────────────────────── */

function extractBankStatement(spatialLines, fullText) {
  const fields = {
    document_type: 'bank_statement',
    document_number: null,
    bank_name: null,
    bank_npwp: null,
    account_name: null,
    account_number: null,
    customer_npwp: null,
    currency: 'IDR',
    period_start: null,
    period_end: null,
    opening_balance: null,
    total_debit: null,
    total_credit: null,
    closing_balance: null,
    gross_amount: null,
    tax_base_dpp: null,
    tax_amount: 0,
    transactions: []
  };
  const evidence = {};

  for (let idx = 0; idx < spatialLines.length; idx++) {
    const line = spatialLines[idx];

    if (/bank\s*central\s*asia/i.test(line.text)) fields.bank_name = 'Bank Central Asia (BCA)';
    if (/nama\s*rekening\s*[:=]?/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 400);
      fields.account_name = right ? right.text.trim() : line.text.replace(/nama\s*rekening\s*[:=]?\s*/i, '').trim();
      evidence.account_name = { text: fields.account_name, box: line.box, confidence: line.confidence };
    }
    if (/nomor\s*rekening\s*[:=]?/i.test(line.text)) {
      const right = findRightOf(spatialLines, line, 400);
      const acc = right ? right.text.trim() : line.text.replace(/nomor\s*rekening\s*[:=]?\s*/i, '').trim();
      fields.account_number = acc;
      fields.document_number = acc;
      evidence.account_number = { text: acc, box: line.box, confidence: line.confidence };
    }
    if (/periode\s*[:=]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*-\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i.test(line.text)) {
      const m = /periode\s*[:=]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*-\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i.exec(line.text);
      fields.period_start = parseIndonesianDate(m[1]);
      fields.period_end = parseIndonesianDate(m[2]);
    }
    if (/saldo\s*awal\s*[:=]?/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) fields.opening_balance = res.amt;
    }
    if (/total\s*mutasi\s*debet\s*[:=]?/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) fields.total_debit = res.amt;
    }
    if (/total\s*mutasi\s*kredit\s*[:=]?/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) fields.total_credit = res.amt;
    }
    if (/saldo\s*akhir\s*[:=]?/i.test(line.text)) {
      const res = getAmountFromLineOrNext(spatialLines, idx, line);
      if (res.amt !== null) {
        fields.closing_balance = res.amt;
        fields.gross_amount = res.amt;
        evidence.gross_amount = { text: res.line.text, box: res.line.box, confidence: res.line.confidence };
      }
    }
  }

  // NPWPs
  const npwps = [];
  for (const line of spatialLines) {
    const npwp = cleanNpwp(line.text);
    if (npwp) npwps.push(npwp);
  }
  if (npwps[0]) fields.bank_npwp = npwps[0];
  if (npwps[1]) fields.customer_npwp = npwps[1];

  // Table rows extraction (Spatial Row Grouping + Regex fallback)
  for (let i = 0; i < spatialLines.length; i++) {
    const line = spatialLines[i];
    
    // Single line regex fallback
    const mTx = /^(\d{1,2}\/\d{1,2})\s*([A-Z0-9\s/.\-_]+?)\s*(\d{4})\s*([\d.,]+)\s*(DB|CR)\s*([\d.,]+)$/i.exec(line.text);
    if (mTx) {
      fields.transactions.push({
        date: mTx[1],
        description: mTx[2].trim(),
        branch: mTx[3],
        amount: parseIndonesianAmount(mTx[4]),
        type: mTx[5].toUpperCase(),
        balance: parseIndonesianAmount(mTx[6])
      });
      continue;
    }

    // Spatial row grouping for multi-column OCR lines
    const mDate = /^(\d{1,2}\/\d{1,2})$/.exec(line.text.trim());
    if (mDate) {
      const txDate = mDate[1];
      const sameRow = spatialLines.filter(l => l.id !== line.id && Math.abs(l.cy - line.cy) <= 14);

      let desc = '';
      let amount = null;
      let type = 'DB';
      let balance = null;

      for (const item of sameRow) {
        if (item.xmin >= 80 && item.xmin < 450) {
          desc = (desc ? desc + ' ' : '') + item.text.trim();
        } else if (item.xmin >= 500 && item.xmin <= 680) {
          const amtMatch = /([\d.,]+)\s*(DB|CR)?/i.exec(item.text);
          if (amtMatch) {
            amount = parseIndonesianAmount(amtMatch[1]);
            if (amtMatch[2]) type = amtMatch[2].toUpperCase();
          }
        } else if (item.xmin > 680) {
          balance = parseIndonesianAmount(item.text);
        }
      }

      // Check for multi-line description wrap
      const nextLine = spatialLines[i + 1];
      if (nextLine && Math.abs(nextLine.cy - line.cy) > 14 && Math.abs(nextLine.cy - line.cy) < 28 && nextLine.xmin >= 80 && nextLine.xmin < 450 && !/^\d{1,2}\/\d{1,2}$/.test(nextLine.text)) {
        desc = (desc ? desc + ' ' : '') + nextLine.text.trim();
      }

      if (amount !== null) {
        fields.transactions.push({
          date: txDate,
          description: desc,
          amount,
          type,
          balance
        });
      }
    }
  }

  return { fields, evidence };
}

/* ── Main Layout-Aware Extractor Entrypoint ────────────────────────────────── */

function extractDocumentV2(ocrResult) {
  let fullText = '';
  let spatialLines = [];

  if (typeof ocrResult === 'string') {
    fullText = ocrResult;
    spatialLines = ocrResult.split(/\r?\n/).map((txt, i) => ({
      id: i,
      text: txt.trim(),
      confidence: 1.0,
      box: [],
      xmin: 0, xmax: 0, ymin: i * 20, ymax: i * 20 + 15,
      cx: 0, cy: i * 20 + 7.5, height: 15, width: 100
    }));
  } else if (ocrResult && typeof ocrResult === 'object') {
    fullText = ocrResult.full_text || '';
    const allLines = [];
    if (Array.isArray(ocrResult.pages)) {
      for (const page of ocrResult.pages) {
        if (Array.isArray(page.lines)) {
          allLines.push(...page.lines);
        }
      }
    }
    spatialLines = buildSpatialLines(allLines);
  }

  // 1. Detect Document Type
  const detectedType = classifyDocumentType(fullText);

  // 2. Dispatch to Specialized Extractor
  let extraction = { fields: {}, evidence: {} };
  switch (detectedType) {
    case 'invoice':
      extraction = extractInvoice(spatialLines, fullText);
      break;
    case 'receipt':
      extraction = extractReceipt(spatialLines, fullText);
      break;
    case 'kwitansi':
      extraction = extractKwitansi(spatialLines, fullText);
      break;
    case 'faktur_pajak':
      extraction = extractFakturPajak(spatialLines, fullText);
      break;
    case 'bank_statement':
      extraction = extractBankStatement(spatialLines, fullText);
      break;
    default:
      extraction = { fields: { document_type: 'unknown' }, evidence: {} };
  }

  // 3. Accounting Guards
  const missing = [];
  if (!extraction.fields.gross_amount && extraction.fields.gross_amount !== 0) missing.push('gross_amount');
  if (!extraction.fields.document_number && !extraction.fields.tax_invoice_serial) missing.push('document_number');

  return {
    document_type: detectedType,
    status: 'needs_accountant_review',
    is_auto_posted: false,
    confidence: missing.length === 0 ? 'high' : (missing.length <= 1 ? 'medium' : 'low'),
    fields: extraction.fields,
    evidence: extraction.evidence,
    missing_fields: missing,
    raw_text_length: fullText.length,
    accounting_notice: 'Zero auto-posting guaranteed. Human accountant confirmation required.'
  };
}

module.exports = {
  extractDocumentV2,
  classifyDocumentType,
  buildSpatialLines,
  findRightOf,
  findBelow,
  getAmountFromLineOrNext,
  parseIndonesianAmount,
  parseIndonesianDate,
  cleanNpwp
};
