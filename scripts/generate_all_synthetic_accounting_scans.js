'use strict';
/**
 * CFO AI — Synthetic Scan Generator for All 5 Indonesian Accounting Document Types
 * Generates pixel-perfect raster PNG and PDF documents for rigorous OCR benchmarking:
 * 1. invoice (already generated, validated)
 * 2. receipt (thermal store receipt)
 * 3. kwitansi (traditional cash kwitansi)
 * 4. faktur_pajak (DJP e-Faktur Pajak 2026)
 * 5. bank_statement (BCA corporate account statement)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const FIXTURES_DIR = path.resolve(__dirname, '..', 'tests', 'fixtures');

const RECEIPT_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: 'Courier New', Courier, monospace;
      width: 380px;
      margin: 0;
      padding: 20px;
      background: #fdfdfd;
      color: #111;
      font-size: 13px;
      line-height: 1.35;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-bottom: 1px dashed #444; margin: 8px 0; }
    .d-divider { border-bottom: 2px dashed #222; margin: 10px 0; }
    .flex { display: flex; justify-content: space-between; }
    .item-row { margin: 4px 0; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size: 16px;">CIRCLE K SUNSET ROAD</div>
  <div class="center">PT CIRCLEKA INDONESIA UTAMA</div>
  <div class="center">NPWP: 01.324.567.8-061.000</div>
  <div class="center">JL. SUNSET ROAD NO. 101 KUTA BALI</div>
  <div class="d-divider"></div>
  <div class="center bold">STRUK PENJUALAN</div>
  <div class="flex"><span>No:</span><span>CK-DPS-20261018-0912</span></div>
  <div class="flex"><span>Tanggal:</span><span>18/10/2026 14:22:10</span></div>
  <div class="flex"><span>Kasir:</span><span>Wayan</span></div>
  <div class="divider"></div>
  <div class="flex bold"><span>1 KOPI SUSU GULA AREN</span><span>35.000</span></div>
  <div class="flex bold"><span>1 AIR MINERAL 600ML</span><span>15.000</span></div>
  <div class="divider"></div>
  <div class="flex"><span>Subtotal:</span><span>50.000</span></div>
  <div class="flex"><span>DPP:</span><span>45.045</span></div>
  <div class="flex"><span>PPN 11%:</span><span>4.955</span></div>
  <div class="flex bold" style="font-size: 15px; margin-top: 4px;"><span>TOTAL:</span><span>Rp 50.000</span></div>
  <div class="flex"><span>BAYAR (QRIS BCA):</span><span>50.000</span></div>
  <div class="flex"><span>KEMBALI:</span><span>0</span></div>
  <div class="d-divider"></div>
  <div class="center">Terima kasih atas kunjungan Anda</div>
  <div class="center">Layanan Konsumen: 1500-CK</div>
</body>
</html>`;

const KWITANSI_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      width: 720px;
      margin: 0;
      padding: 24px;
      background: #faf8f5;
      color: #222;
    }
    .border-box {
      border: 3px double #2b4c7e;
      padding: 24px;
      background: #ffffff;
      position: relative;
    }
    .header-title {
      font-size: 22px;
      font-weight: bold;
      color: #2b4c7e;
      text-align: center;
      letter-spacing: 1.5px;
      border-bottom: 2px solid #2b4c7e;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    .doc-no {
      font-size: 13px;
      font-weight: bold;
      color: #555;
      text-align: right;
      margin-bottom: 16px;
    }
    .field-row {
      display: flex;
      margin: 10px 0;
      font-size: 14px;
    }
    .field-label {
      width: 190px;
      font-weight: 600;
      color: #333;
    }
    .field-value {
      flex: 1;
      border-bottom: 1px dotted #888;
      padding-bottom: 2px;
    }
    .amount-box {
      margin-top: 24px;
      display: inline-block;
      background: #ebf3ff;
      border: 2px solid #2b4c7e;
      padding: 10px 20px;
      font-size: 18px;
      font-weight: bold;
      color: #1a365d;
    }
    .sign-section {
      float: right;
      text-align: center;
      margin-top: 10px;
      width: 220px;
    }
    .meterai-box {
      display: inline-block;
      border: 1px dashed #c53030;
      color: #c53030;
      font-size: 10px;
      font-weight: bold;
      padding: 8px;
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <div class="border-box">
    <div class="header-title">KWITANSI PEMBAYARAN</div>
    <div class="doc-no">Nomor: KWT/2026/X-14</div>

    <div class="field-row">
      <div class="field-label">Sudah Terima Dari :</div>
      <div class="field-value"><strong>PT HELM CARE INDONESIA</strong> (NPWP: 02.987.654.3-987.000)</div>
    </div>
    <div class="field-row">
      <div class="field-label">Uang Sejumlah :</div>
      <div class="field-value"><em>Empat Juta Lima Ratus Ribu Rupiah</em></div>
    </div>
    <div class="field-row">
      <div class="field-label">Untuk Pembayaran :</div>
      <div class="field-value">Pelunasan Sewa Gudang Operasional Canggu Periode Bulan Oktober 2026</div>
    </div>

    <div style="clear: both; overflow: hidden; margin-top: 20px;">
      <div style="float: left;">
        <div class="amount-box">Terbilang : Rp 4.500.000,-</div>
      </div>
      <div class="sign-section">
        <div>Denpasar, 10 Oktober 2026</div>
        <div>Yang Menerima,</div>
        <div class="meterai-box">[METERAI TEMPEL 10000]</div>
        <div style="font-weight: bold; text-decoration: underline;">(I Wayan Sudarta)</div>
      </div>
    </div>
  </div>
</body>
</html>`;

const FAKTUR_PAJAK_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      width: 780px;
      margin: 0;
      padding: 24px;
      background: #ffffff;
      color: #000;
      font-size: 11px;
    }
    .title {
      font-size: 16px;
      font-weight: bold;
      text-align: center;
      margin-bottom: 4px;
    }
    .serial {
      text-align: center;
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    th, td {
      border: 1px solid #444;
      padding: 5px 7px;
      vertical-align: top;
    }
    .section-header {
      background: #f0f0f0;
      font-weight: bold;
    }
    .right { text-align: right; }
  </style>
</head>
<body>
  <div class="title">FAKTUR PAJAK</div>
  <div class="serial">Kode dan Nomor Seri Faktur Pajak: 010.026-26.00000881</div>

  <table>
    <tr class="section-header"><td colspan="2">Pengusaha Kena Pajak</td></tr>
    <tr>
      <td style="width: 20%;">Nama</td>
      <td><strong>PT SOLUSI PRIMA DIGITAL</strong></td>
    </tr>
    <tr>
      <td>Alamat</td>
      <td>Gedung Bursa Efek Indonesia Tower 2 Lt. 17, Jakarta Selatan</td>
    </tr>
    <tr>
      <td>NPWP</td>
      <td><strong>01.234.567.8-012.000</strong></td>
    </tr>
  </table>

  <table>
    <tr class="section-header"><td colspan="2">Pembeli Barang Kena Pajak / Penerima Jasa Kena Pajak</td></tr>
    <tr>
      <td style="width: 20%;">Nama</td>
      <td><strong>PT HELM CARE INDONESIA</strong></td>
    </tr>
    <tr>
      <td>Alamat</td>
      <td>Jl. Sunset Road No. 88 Seminyak, Kuta, Badung, Bali</td>
    </tr>
    <tr>
      <td>NPWP</td>
      <td><strong>02.987.654.3-987.000</strong></td>
    </tr>
  </table>

  <table>
    <thead>
      <tr class="section-header">
        <th style="width: 5%;">No.</th>
        <th>Nama Barang Kena Pajak / Jasa Kena Pajak</th>
        <th style="width: 25%;" class="right">Harga Jual / Penggantian</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="right">1.</td>
        <td>Jasa Integrasi Sistem & Cloud Server Oktober 2026</td>
        <td class="right">Rp 5.000.000</td>
      </tr>
      <tr>
        <td colspan="2">Harga Jual / Penggantian</td>
        <td class="right">Rp 5.000.000</td>
      </tr>
      <tr>
        <td colspan="2">Dikurangi Potongan Harga</td>
        <td class="right">Rp 0</td>
      </tr>
      <tr>
        <td colspan="2"><strong>Dasar Pengenaan Pajak (DPP)</strong></td>
        <td class="right"><strong>Rp 5.000.000</strong></td>
      </tr>
      <tr>
        <td colspan="2"><strong>Jumlah PPN yang Terutang (11%)</strong></td>
        <td class="right"><strong>Rp 550.000</strong></td>
      </tr>
      <tr>
        <td colspan="2">Jumlah PPnBM (Pajak Penjualan Barang Mewah)</td>
        <td class="right">Rp 0</td>
      </tr>
    </tbody>
  </table>

  <div style="display: flex; justify-content: space-between; margin-top: 10px;">
    <div>
      <div>Status: <strong>APPROVAL SUKSES</strong></div>
      <div>DJP Coretax System Version 2026.1</div>
    </div>
    <div style="text-align: right;">
      <div>Jakarta Selatan, 15 Oktober 2026</div>
      <div style="margin-top: 30px; font-weight: bold;">Direktur PT Solusi Prima Digital</div>
    </div>
  </div>
</body>
</html>`;

const BANK_STATEMENT_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      width: 820px;
      margin: 0;
      padding: 24px;
      background: #ffffff;
      color: #222;
      font-size: 11px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #00529c;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .bank-logo {
      font-size: 22px;
      font-weight: bold;
      color: #00529c;
    }
    .statement-title {
      font-size: 14px;
      font-weight: bold;
      color: #333;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 16px;
      background: #f4f8fc;
      padding: 10px 14px;
      border: 1px solid #d3e2f2;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th {
      background: #00529c;
      color: #ffffff;
      padding: 6px 8px;
      text-align: left;
    }
    td {
      padding: 6px 8px;
      border-bottom: 1px solid #e0e0e0;
    }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .summary-box {
      float: right;
      width: 320px;
      border: 1px solid #bbb;
      padding: 8px 12px;
      background: #fafafa;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="bank-logo">BANK CENTRAL ASIA</div>
      <div style="color: #666; font-size: 10px;">PT Bank Central Asia Tbk | NPWP: 01.000.088.5-092.000</div>
    </div>
    <div style="text-align: right;">
      <div class="statement-title">REKENING KORAN / ACCOUNT STATEMENT</div>
      <div>Periode : 01/10/2026 - 31/10/2026</div>
    </div>
  </div>

  <div class="meta-grid">
    <div>Nama Rekening : <strong>PT HELM CARE INDONESIA</strong></div>
    <div>Nomor Rekening : <strong>035-3123456</strong></div>
    <div>NPWP Nasabah   : <strong>02.987.654.3-987.000</strong></div>
    <div>Mata Uang      : <strong>IDR</strong></div>
  </div>

  <div style="margin-bottom: 8px; font-weight: bold;">SALDO AWAL : Rp 125.450.000,00</div>

  <table>
    <thead>
      <tr>
        <th style="width: 10%;">TGL</th>
        <th>KETERANGAN TRANSAKSI</th>
        <th style="width: 8%;">CBG</th>
        <th style="width: 22%;" class="right">MUTASI (DB/CR)</th>
        <th style="width: 22%;" class="right">SALDO</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>15/10</td>
        <td>TRSF E-BANKING DB INV/2026/SPD-0881<br><span style="color:#666;">PT SOLUSI PRIMA DIGITAL</span></td>
        <td>0010</td>
        <td class="right bold" style="color: #c53030;">5.550.000,00 DB</td>
        <td class="right">119.900.000,00</td>
      </tr>
      <tr>
        <td>20/10</td>
        <td>TRSF E-BANKING CR PAYMENT CLIENT<br><span style="color:#666;">BALI CLINIC CARE</span></td>
        <td>0010</td>
        <td class="right bold" style="color: #2f855a;">60.000.000,00 CR</td>
        <td class="right">179.900.000,00</td>
      </tr>
      <tr>
        <td>25/10</td>
        <td>BIAYA ADM REKENING</td>
        <td>0010</td>
        <td class="right bold" style="color: #c53030;">50.000,00 DB</td>
        <td class="right">179.850.000,00</td>
      </tr>
      <tr>
        <td>31/10</td>
        <td>PAJAK BUNGA</td>
        <td>0010</td>
        <td class="right bold" style="color: #c53030;">5.000,00 DB</td>
        <td class="right">174.900.000,00</td>
      </tr>
    </tbody>
  </table>

  <div class="summary-box">
    <div style="display:flex; justify-content:space-between;"><span>TOTAL MUTASI DEBET:</span><span class="bold">Rp 5.605.000,00</span></div>
    <div style="display:flex; justify-content:space-between; margin: 4px 0;"><span>TOTAL MUTASI KREDIT:</span><span class="bold">Rp 60.000.000,00</span></div>
    <div style="display:flex; justify-content:space-between; border-top: 1px solid #444; padding-top: 4px;" class="bold"><span>SALDO AKHIR:</span><span>Rp 174.900.000,00</span></div>
  </div>
</body>
</html>`;

const SPECS = [
  { id: 'doc-synth-02-receipt', html: RECEIPT_HTML, width: 420, height: 750 },
  { id: 'doc-synth-03-kwitansi', html: KWITANSI_HTML, width: 780, height: 500 },
  { id: 'doc-synth-04-faktur-pajak', html: FAKTUR_PAJAK_HTML, width: 840, height: 780 },
  { id: 'doc-synth-05-bank-statement', html: BANK_STATEMENT_HTML, width: 880, height: 720 },
];

async function main() {
  if (!fs.existsSync(FIXTURES_DIR)) fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  console.log('[1/2] Launching browser to render synthetic scans...');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
  }

  for (const doc of SPECS) {
    const pngPath = path.join(FIXTURES_DIR, `${doc.id}.png`);
    const pdfPath = path.join(FIXTURES_DIR, `${doc.id}.pdf`);

    const context = await browser.newContext({ viewport: { width: doc.width, height: doc.height } });
    const page = await context.newPage();
    await page.setContent(doc.html, { waitUntil: 'load' });

    await page.screenshot({ path: pngPath, fullPage: true });

    // Generate pure raster image PDF
    const pngBase64 = fs.readFileSync(pngPath).toString('base64');
    const imgPage = await context.newPage();
    await imgPage.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;"><img src="data:image/png;base64,${pngBase64}" style="width:100%;height:auto;display:block;" /></body></html>`, { waitUntil: 'load' });
    await imgPage.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });

    await context.close();
    console.log(`  [OK] Rendered ${doc.id} -> PNG (${fs.statSync(pngPath).size} B) & PDF (${fs.statSync(pdfPath).size} B)`);
  }

  await browser.close();
  console.log('[2/2] All synthetic scans generated successfully.');
}

main().catch(err => {
  console.error('Fixture generation failed:', err);
  process.exit(1);
});
