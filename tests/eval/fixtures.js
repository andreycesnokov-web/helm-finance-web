// Evaluation corpus — ten document categories, all values fictional.
//
// Every fixture is generated as a REAL pdf with real page geometry, because the thing
// under evaluation is visual understanding: a fixture that is only a text blob would
// score the wrong system.
//
// Several fixtures deliberately set the text stream against the layout — columns drawn
// out of order, the due date printed before the document date, the total before the
// base. A reader working from extracted text gets those wrong; a reader that looks at
// the page does not. That contrast is the point of the corpus.
'use strict';

const zlib = require('zlib');

const esc = (s) => String(s).replace(/([()\\])/g, '\\$1');

/** Build a one- or multi-page PDF from [page][ [x, y, text] ] instructions. */
function makePdf(pages) {
  const streams = pages.map((items) => zlib.deflateSync(Buffer.from(
    items.map(([x, y, t]) => `BT /F1 11 Tf ${x} ${y} Td (${esc(t)}) Tj ET`).join('\n'), 'latin1')));

  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  const at = () => parts.reduce((a, b) => a + b.length, 0);
  const obj = (n, body) => { offsets[n] = at(); parts.push(Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, 'latin1')); };

  const pageIds = pages.map((_, i) => 3 + i * 2);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const fontId = 3 + pages.length * 2;
  pages.forEach((_, i) => {
    const pid = pageIds[i]; const cid = pid + 1;
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] `
      + `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`);
    offsets[cid] = at();
    parts.push(Buffer.from(`${cid} 0 obj\n<< /Length ${streams[i].length} /Filter /FlateDecode >>\nstream\n`, 'latin1'));
    parts.push(streams[i]);
    parts.push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
  });
  obj(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xrefAt = at();
  const maxId = fontId;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) xref += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

const US = {
  legal_name: 'PT HELM CARE INDONESIA',
  display_name: 'Helm Care Indonesia',
  npwp: '09.876.543.2-101.000',
  aliases: ['HELM CARE'],
};

const L = 60, R = 330;

/* ── the corpus ────────────────────────────────────────────────────────────── */

const CASES = [
  {
    id: 'supplier_invoice',
    label: 'Supplier invoice (we owe)',
    mime: 'application/pdf',
    pages: [[
      [L, 780, 'INVOICE'],
      [L, 762, 'No. Invoice : INV-2026-0042'],
      [L, 730, 'Dari :'], [L, 712, 'PT SUMBER MAKMUR SENTOSA'],
      [L, 694, 'NPWP : 01.222.333.4-555.666'],
      [R, 730, 'Kepada :'], [R, 712, 'PT HELM CARE INDONESIA'],
      [R, 694, 'NPWP : 09.876.543.2-101.000'],
      [L, 640, 'Tanggal : 12 Agustus 2026'],
      [L, 622, 'Jatuh Tempo : 11 September 2026'],
      [L, 580, 'Dasar Pengenaan Pajak : 25.000.000'],
      [L, 562, 'Jumlah PPN : 2.750.000'],
      [L, 544, 'Total : 27.750.000'],
    ]],
    expect: {
      document_type: ['invoice'], document_number: 'INV-2026-0042',
      counterparty_name: 'PT SUMBER MAKMUR SENTOSA', counterparty_npwp: '012223334555666',
      document_date: '2026-08-12', due_date: '2026-09-11',
      dpp: 25000000, ppn: 2750000, total: 27750000,
      direction: 'payable', current_business_is_buyer: true,
    },
  },
  {
    id: 'customer_invoice',
    label: 'Customer invoice (we are owed)',
    mime: 'application/pdf',
    pages: [[
      [L, 780, 'INVOICE'],
      [L, 762, 'No. Invoice : OUT-2026-0007'],
      [L, 730, 'Dari :'], [L, 712, 'PT HELM CARE INDONESIA'],
      [L, 694, 'NPWP : 09.876.543.2-101.000'],
      [R, 730, 'Kepada :'], [R, 712, 'PT RITEL NUSANTARA JAYA'],
      [R, 694, 'NPWP : 02.444.555.6-077.000'],
      [L, 640, 'Tanggal : 01 September 2026'],
      [L, 580, 'Total : 8.500.000'],
    ]],
    expect: {
      document_type: ['invoice'], document_number: 'OUT-2026-0007',
      counterparty_name: 'PT RITEL NUSANTARA JAYA', counterparty_npwp: '024445556077000',
      document_date: '2026-09-01', due_date: null,
      dpp: null, ppn: null, total: 8500000,
      direction: 'receivable', current_business_is_buyer: false,
    },
  },
  {
    id: 'faktur_pajak_scrambled',
    label: 'Faktur pajak — columns drawn out of order',
    mime: 'application/pdf',
    // The adversarial case: text order pairs each name with the OTHER party's NPWP.
    pages: [[
      [L, 780, 'FAKTUR PAJAK'],
      [L, 762, 'Kode dan Nomor Seri : 010.004-26.00000123'],
      [L, 730, 'Pengusaha Kena Pajak'], [R, 730, 'Pembeli Barang Kena Pajak'],
      [R, 712, 'Nama : PT HELM CARE INDONESIA'],
      [L, 694, 'NPWP : 01.111.222.3-041.000'],
      [L, 712, 'Nama : PT ALPHA SENTOSA NUSANTARA'],
      [R, 694, 'NPWP : 09.876.543.2-101.000'],
      [L, 640, 'Jatuh Tempo : 03 September 2026'],
      [L, 622, 'Tanggal : 04 Agustus 2026'],
      [L, 580, 'Jumlah Harga Jual / Netto : 11.322.000'],
      [L, 562, 'Dasar Pengenaan Pajak : 10.200.000'],
      [L, 544, 'Jumlah PPN : 1.122.000'],
    ]],
    expect: {
      document_type: ['faktur_pajak'], document_number: '010.004-26.00000123',
      counterparty_name: 'PT ALPHA SENTOSA NUSANTARA', counterparty_npwp: '011112223041000',
      document_date: '2026-08-04', due_date: '2026-09-03',
      dpp: 10200000, ppn: 1122000, total: 11322000,
      direction: 'payable', current_business_is_buyer: true,
    },
  },
  {
    id: 'kwitansi',
    label: 'Kwitansi (money already moved)',
    mime: 'application/pdf',
    pages: [[
      [L, 780, 'KWITANSI'],
      [L, 750, 'PT SUMBER ALFARIA TRIJAYA TBK'],
      [L, 720, 'Sudah terima dari : PT HELM CARE INDONESIA'],
      [L, 700, 'Berupa : TRANSFER'],
      [L, 680, 'Untuk pembayaran : Sewa lokasi Agustus 2026'],
      [L, 650, 'Jumlah : Rp 11.322.000'],
      [L, 630, 'Terbilang : sebelas juta tiga ratus dua puluh dua ribu rupiah'],
      [L, 600, 'Tanggal : 04-08-2026'],
    ]],
    expect: {
      document_type: ['receipt', 'kwitansi'], document_number: null,
      counterparty_name: 'PT SUMBER ALFARIA TRIJAYA TBK', counterparty_npwp: null,
      document_date: '2026-08-04', due_date: null,
      dpp: null, ppn: null, total: 11322000,
      direction: 'not_payable', must_not_create_record: true,
    },
  },
  {
    id: 'payment_proof',
    label: 'Bank transfer proof',
    mime: 'application/pdf',
    pages: [[
      [L, 780, 'BUKTI TRANSFER'],
      [L, 750, 'Bank Central Asia'],
      [L, 720, 'Dari : 772-1538064 / PT HELM CARE INDONESIA'],
      [L, 700, 'Ke : 075-3020192 / PT CIRCLEKA INDONESIA UTAMA'],
      [L, 670, 'Jumlah : Rp 29.600.000'],
      [L, 650, 'Tanggal : 04/09/2026 09:35'],
      [L, 630, 'Status : Berhasil'],
      [L, 610, 'No. Referensi : 26090400308936'],
    ]],
    expect: {
      document_type: ['payment_proof'], document_number: '26090400308936',
      counterparty_name: 'PT CIRCLEKA INDONESIA UTAMA', counterparty_npwp: null,
      document_date: '2026-09-04', due_date: null,
      dpp: null, ppn: null, total: 29600000,
      direction: 'not_payable', must_not_create_record: true,
    },
  },
  {
    id: 'multi_party_npwp',
    label: 'Three companies, three NPWP values',
    mime: 'application/pdf',
    // A third party (the shipper) exists only to be ignored as the counterparty.
    pages: [[
      [L, 780, 'INVOICE'],
      [L, 762, 'No. Invoice : MP-2026-3001'],
      [L, 730, 'Dari :'], [L, 712, 'PT TIGA PILAR LOGISTIK'],
      [L, 694, 'NPWP : 03.555.666.7-088.000'],
      [R, 730, 'Kepada :'], [R, 712, 'PT HELM CARE INDONESIA'],
      [R, 694, 'NPWP : 09.876.543.2-101.000'],
      [L, 650, 'Pengirim : PT GUDANG SENTRAL ABADI'],
      [L, 632, 'NPWP Pengirim : 04.999.888.7-066.000'],
      [L, 600, 'Tanggal : 20 Agustus 2026'],
      [L, 560, 'Total : 4.400.000'],
    ]],
    expect: {
      document_type: ['invoice'], document_number: 'MP-2026-3001',
      counterparty_name: 'PT TIGA PILAR LOGISTIK', counterparty_npwp: '035556667088000',
      document_date: '2026-08-20', due_date: null,
      dpp: null, ppn: null, total: 4400000,
      direction: 'payable', current_business_is_buyer: true,
    },
  },
  {
    id: 'multi_page',
    label: 'Two-page invoice (totals on page 2)',
    mime: 'application/pdf',
    pages: [
      [
        [L, 780, 'INVOICE'],
        [L, 762, 'No. Invoice : MP2-2026-0002'],
        [L, 730, 'Dari :'], [L, 712, 'PT DUA HALAMAN SEJAHTERA'],
        [L, 694, 'NPWP : 05.123.456.7-011.000'],
        [R, 730, 'Kepada :'], [R, 712, 'PT HELM CARE INDONESIA'],
        [L, 640, 'Tanggal : 05 Agustus 2026'],
        [L, 600, 'Rincian pekerjaan — lihat halaman 2'],
      ],
      [
        [L, 780, 'Halaman 2'],
        [L, 740, 'Dasar Pengenaan Pajak : 7.000.000'],
        [L, 722, 'Jumlah PPN : 770.000'],
        [L, 704, 'Total : 7.770.000'],
      ],
    ],
    expect: {
      document_type: ['invoice'], document_number: 'MP2-2026-0002',
      counterparty_name: 'PT DUA HALAMAN SEJAHTERA', counterparty_npwp: '051234567011000',
      document_date: '2026-08-05', due_date: null,
      dpp: 7000000, ppn: 770000, total: 7770000,
      direction: 'payable', current_business_is_buyer: true, pages: 2,
    },
  },
  {
    id: 'no_tax_no_due',
    label: 'Invoice with no tax and no due date (nothing to fabricate)',
    mime: 'application/pdf',
    pages: [[
      [L, 780, 'INVOICE'],
      [L, 762, 'No. Invoice : NT-2026-0009'],
      [L, 730, 'Dari :'], [L, 712, 'PT SEDERHANA JAYA'],
      [R, 730, 'Kepada :'], [R, 712, 'PT HELM CARE INDONESIA'],
      [L, 660, 'Tanggal : 18 Agustus 2026'],
      [L, 620, 'Total : 1.500.000'],
    ]],
    expect: {
      document_type: ['invoice'], document_number: 'NT-2026-0009',
      counterparty_name: 'PT SEDERHANA JAYA', counterparty_npwp: null,
      document_date: '2026-08-18', due_date: null,
      dpp: null, ppn: null, total: 1500000,
      direction: 'payable', current_business_is_buyer: true,
      // The whole point of this case: no PPN and no due date exist.
      must_not_fabricate: ['ppn', 'due_date'],
    },
  },
  {
    id: 'self_only',
    label: 'Only our own company appears',
    mime: 'application/pdf',
    pages: [[
      [L, 780, 'INVOICE'],
      [L, 762, 'No. Invoice : SELF-2026-1'],
      [L, 730, 'Kepada :'], [L, 712, 'PT HELM CARE INDONESIA'],
      [L, 694, 'NPWP : 09.876.543.2-101.000'],
      [L, 650, 'Tanggal : 09 Agustus 2026'],
      [L, 620, 'Total : 2.000.000'],
    ]],
    expect: {
      document_type: ['invoice'], document_number: 'SELF-2026-1',
      counterparty_name: null, counterparty_npwp: null,
      document_date: '2026-08-09', due_date: null,
      dpp: null, ppn: null, total: 2000000,
      direction: 'blocked', must_self_match: true,
    },
  },
  {
    id: 'scanned_no_text',
    label: 'Scanned page with no text layer',
    mime: 'application/pdf',
    // Rendered as an image-only page: geometry exists, characters do not.
    raw: Buffer.from('%PDF-1.4\n% image-only scan, no text operators\n%%EOF\n', 'latin1'),
    expect: { unreadable: true },
  },
];

function buildCase(c) {
  return { ...c, bytes: c.raw || makePdf(c.pages) };
}

module.exports = { CASES: CASES.map(buildCase), US, makePdf };
