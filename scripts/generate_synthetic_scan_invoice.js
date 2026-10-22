'use strict';
/**
 * CFO AI — Synthetic Scanned Invoice Generator
 * Generates an authentic Indonesian business invoice for end-to-end OCR testing.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Invoice - PT Solusi Prima Digital</title>
  <style>
    @page {
      size: A4;
      margin: 20mm;
    }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      color: #222;
      background: #fafaf8;
      margin: 0;
      padding: 24px;
      line-height: 1.4;
    }
    .invoice-box {
      background: #ffffff;
      padding: 32px 36px;
      border: 1px solid #e0e0e0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      position: relative;
    }
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
    }
    .header-table td {
      vertical-align: top;
    }
    .company-title {
      font-size: 20px;
      font-weight: 700;
      color: #1a365d;
      margin: 0 0 4px 0;
      letter-spacing: -0.3px;
    }
    .company-sub {
      font-size: 11px;
      color: #555;
      line-height: 1.5;
    }
    .invoice-title-block {
      text-align: right;
    }
    .invoice-word {
      font-size: 26px;
      font-weight: 800;
      color: #2b6cb0;
      margin: 0;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .meta-table {
      margin-top: 8px;
      font-size: 12px;
      float: right;
    }
    .meta-table td {
      padding: 2px 4px;
    }
    .meta-label {
      color: #666;
      font-weight: 600;
    }
    .meta-val {
      font-weight: 700;
      color: #111;
      text-align: right;
    }
    .parties-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      clear: both;
    }
    .parties-table td {
      width: 50%;
      vertical-align: top;
      padding: 12px;
      border: 1px solid #edf2f7;
      background: #f8fafc;
    }
    .party-heading {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #4a5568;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .party-name {
      font-size: 14px;
      font-weight: 700;
      color: #1a202c;
      margin-bottom: 4px;
    }
    .party-detail {
      font-size: 11px;
      color: #4a5568;
      line-height: 1.5;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .items-table th {
      background: #2b6cb0;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 10px 12px;
      text-align: left;
    }
    .items-table th.num-col {
      text-align: right;
    }
    .items-table td {
      padding: 10px 12px;
      font-size: 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    .items-table td.num-col {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .totals-table {
      width: 45%;
      margin-left: auto;
      border-collapse: collapse;
      margin-bottom: 28px;
    }
    .totals-table td {
      padding: 6px 10px;
      font-size: 12px;
    }
    .totals-table tr.grand-total td {
      border-top: 2px solid #2b6cb0;
      border-bottom: 2px solid #2b6cb0;
      font-size: 14px;
      font-weight: 800;
      color: #1a365d;
      padding: 10px;
      background: #ebf8ff;
    }
    .payment-info {
      padding: 14px 18px;
      background: #f7fafc;
      border-left: 4px solid #3182ce;
      font-size: 11px;
      color: #2d3748;
      line-height: 1.6;
    }
    .stamp-badge {
      display: inline-block;
      margin-top: 14px;
      padding: 4px 10px;
      border: 1.5px dashed #38a169;
      color: #276749;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      transform: rotate(-2deg);
    }
  </style>
</head>
<body>
  <div class="invoice-box">
    <table class="header-table">
      <tr>
        <td style="width: 55%;">
          <div class="company-title">PT SOLUSI PRIMA DIGITAL</div>
          <div class="company-sub">
            Gedung Bursa Efek Indonesia Tower 2 Lt. 17<br>
            Jl. Jend. Sudirman Kav. 52-53, Jakarta Selatan 12190<br>
            NPWP: 01.234.567.8-012.000<br>
            Email: billing@solusiprima.co.id | Tel: +62 21 515 9900
          </div>
        </td>
        <td style="width: 45%;">
          <div class="invoice-title-block">
            <div class="invoice-word">FAKTUR / INVOICE</div>
            <table class="meta-table">
              <tr>
                <td class="meta-label">Nomor Invoice:</td>
                <td class="meta-val">INV/2026/SPD-0881</td>
              </tr>
              <tr>
                <td class="meta-label">Tanggal Terbit:</td>
                <td class="meta-val">15 Oktober 2026</td>
              </tr>
              <tr>
                <td class="meta-label">Jatuh Tempo:</td>
                <td class="meta-val">30 Oktober 2026</td>
              </tr>
              <tr>
                <td class="meta-label">Mata Uang:</td>
                <td class="meta-val">IDR (Rupiah)</td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
    </table>

    <table class="parties-table">
      <tr>
        <td>
          <div class="party-heading">Tagihan Ditujukan Kepada (Customer):</div>
          <div class="party-name">PT HELM CARE INDONESIA</div>
          <div class="party-detail">
            Jl. Sunset Road No. 88, Seminyak, Kuta<br>
            Kabupaten Badung, Bali 80361<br>
            NPWP: 02.987.654.3-987.000<br>
            Attn: Finance & Accounting Department
          </div>
        </td>
        <td>
          <div class="party-heading">Informasi Pajak & Transaksi:</div>
          <div class="party-detail">
            <strong>Kategori Transaksi:</strong> Jasa TI & Pemeliharaan Cloud<br>
            <strong>Kode Faktur Pajak:</strong> 010.002-26.19827361<br>
            <strong>Status Faktur Pajak:</strong> Approved DJP Coretax<br>
            <strong>Periode Layanan:</strong> 01 Okt 2026 - 31 Okt 2026
          </div>
        </td>
      </tr>
    </table>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 6%;">No.</th>
          <th style="width: 50%;">Deskripsi Layanan</th>
          <th style="width: 10%;" class="num-col">Qty</th>
          <th style="width: 17%;" class="num-col">Harga Satuan (IDR)</th>
          <th style="width: 17%;" class="num-col">Total (IDR)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <strong>Cloud Infrastructure & Maintenance Hosting</strong><br>
            <span style="font-size: 10px; color: #666;">Dedicated cloud compute, SSL load balancer, database cluster & daily backup support</span>
          </td>
          <td class="num-col">1</td>
          <td class="num-col">5.000.000</td>
          <td class="num-col">5.000.000</td>
        </tr>
      </tbody>
    </table>

    <table class="totals-table">
      <tr>
        <td style="color: #4a5568;">Dasar Pengenaan Pajak (DPP):</td>
        <td style="text-align: right; font-weight: 600;">Rp 5.000.000</td>
      </tr>
      <tr>
        <td style="color: #4a5568;">PPN (11%):</td>
        <td style="text-align: right; font-weight: 600;">Rp 550.000</td>
      </tr>
      <tr class="grand-total">
        <td>TOTAL TAGIHAN:</td>
        <td style="text-align: right;">Rp 5.550.000</td>
      </tr>
    </table>

    <div class="payment-info">
      <strong>Instruksi Pembayaran (Bank Transfer):</strong><br>
      Nama Bank: <strong>Bank Central Asia (BCA) - KCU Sudirman Jakarta</strong><br>
      Nomor Rekening: <strong>123-456-7890</strong><br>
      Atas Nama: <strong>PT SOLUSI PRIMA DIGITAL</strong><br>
      Berita Transfer: <em>INV-2026-SPD-0881 PT HELM CARE</em>
      <div class="stamp-badge">&#10003; SIAP DIVERIFIKASI AKUNTAN</div>
    </div>
  </div>
</body>
</html>`;

async function main() {
  const outputDir = path.resolve(__dirname, '..', 'tests', 'fixtures');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const pdfPath = path.join(outputDir, 'synthetic_invoice_helmcare_scan.pdf');
  const pngPath = path.join(outputDir, 'synthetic_invoice_helmcare_scan.png');

  console.log('[1/3] Launching headless browser to render synthetic scan invoice...');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
  }
  const context = await browser.newContext({ viewport: { width: 1200, height: 1600 } });
  const page = await context.newPage();

  await page.setContent(HTML_CONTENT, { waitUntil: 'load' });

  console.log('[2/3] Generating authentic PDF scan: ' + pdfPath);
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
  });

  console.log('[3/4] Generating raster PNG image scan: ' + pngPath);
  await page.screenshot({ path: pngPath, fullPage: true });

  const pureImagePdfPath = path.join(outputDir, 'synthetic_invoice_pure_image_scan.pdf');
  console.log('[4/4] Generating 100% image-only (non-searchable raster) PDF scan: ' + pureImagePdfPath);
  const pngBase64 = fs.readFileSync(pngPath).toString('base64');
  const imgPage = await context.newPage();
  await imgPage.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;"><img src="data:image/png;base64,${pngBase64}" style="width:100%;height:auto;display:block;" /></body></html>`, { waitUntil: 'load' });
  await imgPage.pdf({
    path: pureImagePdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  });

  await browser.close();

  const pdfStats = fs.statSync(pdfPath);
  const pngStats = fs.statSync(pngPath);
  const purePdfStats = fs.statSync(pureImagePdfPath);

  console.log(`\n[SUCCESS] Generated synthetic scan fixtures:`);
  console.log(`  - Text-layered PDF: ${pdfPath} (${pdfStats.size} bytes)`);
  console.log(`  - Raster PNG image: ${pngPath} (${pngStats.size} bytes)`);
  console.log(`  - Pure Image-only PDF: ${pureImagePdfPath} (${purePdfStats.size} bytes)`);
}

main().catch(err => {
  console.error('Error generating fixture:', err);
  process.exit(1);
});
