'use strict';
/**
 * CFO AI — Stress Test Generator for Complex Indonesian Documents
 * 1. doc-hard-01: Invoice with Trade Discount, 12% Coretax, 3 Line Items, 3deg Skew
 * 2. doc-hard-02: Multi-Page Package (Page 1: Commercial Invoice, Page 2: DJP e-Faktur Pajak)
 * 3. doc-hard-03: Tax-Exempt e-Faktur (Kode 070, PPN Bebas / 0%, DPP Rp 12,500,000)
 * 4. doc-hard-04: Low-Contrast / Noisy Retail Struk with 5 items
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const FIXTURES_DIR = path.resolve(__dirname, '..', 'tests', 'fixtures');

// 1. Skewed Invoice with Discount and 12% Coretax
const HARD_01_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 30px;
      background: #eef2f5;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .skew-container {
      transform: rotate(2.5deg);
      background: #ffffff;
      padding: 30px 40px;
      width: 700px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
      border: 1px solid #ddd;
    }
    .header { display: flex; justify-content: space-between; margin-bottom: 20px; }
    .company { font-size: 18px; font-weight: bold; color: #1a365d; }
    .title { font-size: 22px; font-weight: bold; color: #2b6cb0; text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
    th { background: #2b6cb0; color: #fff; padding: 8px; text-align: left; }
    td { padding: 8px; border-bottom: 1px solid #eee; }
    .num { text-align: right; }
    .totals { width: 50%; margin-left: auto; margin-top: 15px; font-size: 12px; }
    .totals td { padding: 4px 8px; }
    .grand { font-weight: bold; font-size: 14px; background: #ebf8ff; border-top: 2px solid #2b6cb0; }
  </style>
</head>
<body>
  <div class="skew-container">
    <div class="header">
      <div>
        <div class="company">PT MITRA TEKNOLOGI NUSANTARA</div>
        <div style="font-size: 11px; color: #555;">NPWP: 01.999.888.7-011.000<br>Jl. Gatot Subroto No. 45, Jakarta Selatan</div>
      </div>
      <div>
        <div class="title">INVOICE</div>
        <div style="font-size: 12px; text-align: right;">No: <strong>INV/2026/MTN-9902</strong><br>Tanggal: <strong>20 Oktober 2026</strong><br>Jatuh Tempo: <strong>05 November 2026</strong></div>
      </div>
    </div>

    <div style="font-size: 12px; background: #f8fafc; padding: 10px; border: 1px solid #e2e8f0; margin-bottom: 15px;">
      <strong>Ditagihkan Kepada:</strong><br>
      PT HELM CARE INDONESIA (NPWP: 02.987.654.3-987.000)<br>
      Jl. Sunset Road No. 88, Badung, Bali
    </div>

    <table>
      <thead>
        <tr>
          <th>Deskripsi Barang / Layanan</th>
          <th class="num">Qty</th>
          <th class="num">Harga (IDR)</th>
          <th class="num">Total (IDR)</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Server Maintenance & Monitoring</td><td class="num">1</td><td class="num">4.000.000</td><td class="num">4.000.000</td></tr>
        <tr><td>Security Patching & Audit</td><td class="num">1</td><td class="num">2.000.000</td><td class="num">2.000.000</td></tr>
        <tr><td>Backup Storage 5TB</td><td class="num">2</td><td class="num">1.000.000</td><td class="num">2.000.000</td></tr>
      </tbody>
    </table>

    <table class="totals">
      <tr><td>Subtotal Sebelum Diskon:</td><td class="num">Rp 8.000.000</td></tr>
      <tr><td>Diskon Khusus Mitra (10%):</td><td class="num" style="color: #c53030;">- Rp 800.000</td></tr>
      <tr><td>Dasar Pengenaan Pajak (DPP):</td><td class="num" style="font-weight: bold;">Rp 7.200.000</td></tr>
      <tr><td>PPN (12% Coretax):</td><td class="num">Rp 864.000</td></tr>
      <tr class="grand"><td>TOTAL TAGIHAN:</td><td class="num">Rp 8.064.000</td></tr>
    </table>

    <div style="margin-top: 20px; font-size: 11px; color: #4a5568;">
      Pembayaran ditransfer ke Bank Mandiri KCP Sudirman Rek: <strong>137-00-1928374-1</strong> a/n PT MITRA TEKNOLOGI NUSANTARA
    </div>
  </div>
</body>
</html>`;

// 2. Tax-Exempt e-Faktur (Kode 070, DPP 12,500,000, PPN Bebas 0%)
const HARD_03_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 25px; background: #fff; font-size: 11px; }
    .title { font-size: 16px; font-weight: bold; text-align: center; }
    .serial { font-size: 13px; font-weight: bold; text-align: center; margin: 6px 0 15px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #333; padding: 6px 8px; }
    .sec { background: #f0f0f0; font-weight: bold; }
    .num { text-align: right; }
  </style>
</head>
<body>
  <div class="title">FAKTUR PAJAK</div>
  <div class="serial">Kode dan Nomor Seri Faktur Pajak: 070.026-26.00004551</div>

  <table>
    <tr class="sec"><td colspan="2">Pengusaha Kena Pajak</td></tr>
    <tr><td style="width: 25%;">Nama</td><td><strong>PT LOGISTIK MEDIKA BALI</strong></td></tr>
    <tr><td>NPWP</td><td><strong>01.444.333.2-901.000</strong></td></tr>
  </table>

  <table>
    <tr class="sec"><td colspan="2">Pembeli Barang Kena Pajak</td></tr>
    <tr><td style="width: 25%;">Nama</td><td><strong>PT HELM CARE INDONESIA</strong></td></tr>
    <tr><td>NPWP</td><td><strong>02.987.654.3-987.000</strong></td></tr>
  </table>

  <table>
    <tr class="sec"><th style="width: 5%;">No.</th><th>Uraian Barang / Jasa</th><th class="num" style="width: 25%;">Harga Jual</th></tr>
    <tr><td>1.</td><td>Peralatan Medis Khusus Penanganan Bencana (Kawasan Berikat)</td><td class="num">Rp 12.500.000</td></tr>
    <tr><td colspan="2">Dasar Pengenaan Pajak (DPP)</td><td class="num"><strong>Rp 12.500.000</strong></td></tr>
    <tr><td colspan="2">PPN yang Dibebaskan / Tidak Dipungut (Fasilitas Kawasan Berikat 0%)</td><td class="num"><strong>Rp 0</strong></td></tr>
    <tr><td colspan="2"><strong>Total Tagihan</strong></td><td class="num"><strong>Rp 12.500.000</strong></td></tr>
  </table>

  <div style="margin-top: 15px;">
    <div>Fasilitas: <strong>PPN DIBEBASKAN SESUAI PP NOMOR 49 TAHUN 2022</strong></div>
    <div>Tanggal Faktur: <strong>16 Oktober 2026</strong></div>
    <div>Status: <strong>APPROVAL SUKSES</strong></div>
  </div>
</body>
</html>`;

// 3. Multi-Page Package (Page 1: Invoice, Page 2: Matching e-Faktur)
const MULTIPAGE_P1 = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 25px; background: #fff; font-size: 12px; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #2b6cb0; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { border: 1px solid #ddd; padding: 8px; }
    th { background: #2b6cb0; color: #fff; }
    .num { text-align: right; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size: 18px; font-weight: bold; color: #1a365d;">PT NUSANTARA PHARMA CARE</div>
      <div>NPWP: 01.777.666.5-055.000</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 20px; font-weight: bold; color: #2b6cb0;">INVOICE</div>
      <div>Nomor: <strong>INV/2026/NPC-4100</strong></div>
      <div>Tanggal: <strong>12 Oktober 2026</strong></div>
    </div>
  </div>
  <div style="margin: 15px 0;">
    <strong>Customer:</strong> PT HELM CARE INDONESIA (NPWP: 02.987.654.3-987.000)
  </div>
  <table>
    <thead><tr><th>Nama Produk</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Subtotal</th></tr></thead>
    <tbody>
      <tr><td>First Aid Emergency Kit Type A</td><td class="num">10</td><td class="num">500.000</td><td class="num">5.000.000</td></tr>
      <tr><td>Oxygen Cylinder & Regulator 1m3</td><td class="num">5</td><td class="num">1.000.000</td><td class="num">5.000.000</td></tr>
    </tbody>
  </table>
  <div style="width: 45%; margin-left: auto; margin-top: 15px;">
    <div style="display:flex; justify-content:space-between;"><span>Dasar Pengenaan Pajak (DPP):</span><span>Rp 10.000.000</span></div>
    <div style="display:flex; justify-content:space-between; margin: 4px 0;"><span>PPN (11%):</span><span>Rp 1.100.000</span></div>
    <div style="display:flex; justify-content:space-between; font-weight:bold; font-size: 14px; border-top: 2px solid #2b6cb0; padding-top: 4px;"><span>TOTAL:</span><span>Rp 11.100.000</span></div>
  </div>
  <div style="margin-top: 20px; font-size: 11px;">Halaman 1 dari 2 — Lampiran Faktur Pajak pada Halaman 2</div>
</body>
</html>`;

const MULTIPAGE_P2 = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 25px; background: #fff; font-size: 11px; }
    .title { font-size: 16px; font-weight: bold; text-align: center; }
    .serial { font-size: 13px; font-weight: bold; text-align: center; margin: 6px 0 15px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #333; padding: 6px 8px; }
    .sec { background: #f0f0f0; font-weight: bold; }
    .num { text-align: right; }
  </style>
</head>
<body>
  <div class="title">FAKTUR PAJAK</div>
  <div class="serial">Kode dan Nomor Seri Faktur Pajak: 010.026-26.00004100</div>
  <table>
    <tr class="sec"><td colspan="2">Pengusaha Kena Pajak</td></tr>
    <tr><td style="width: 25%;">Nama</td><td><strong>PT NUSANTARA PHARMA CARE</strong></td></tr>
    <tr><td>NPWP</td><td><strong>01.777.666.5-055.000</strong></td></tr>
  </table>
  <table>
    <tr class="sec"><td colspan="2">Pembeli BKP</td></tr>
    <tr><td style="width: 25%;">Nama</td><td><strong>PT HELM CARE INDONESIA</strong></td></tr>
    <tr><td>NPWP</td><td><strong>02.987.654.3-987.000</strong></td></tr>
  </table>
  <table>
    <tr class="sec"><th style="width: 5%;">No.</th><th>Uraian</th><th class="num">Harga Jual</th></tr>
    <tr><td>1.</td><td>Peralatan Medis & Tabung Oksigen</td><td class="num">Rp 10.000.000</td></tr>
    <tr><td colspan="2">Dasar Pengenaan Pajak (DPP)</td><td class="num"><strong>Rp 10.000.000</strong></td></tr>
    <tr><td colspan="2">Jumlah PPN yang Terutang (11%)</td><td class="num"><strong>Rp 1.100.000</strong></td></tr>
  </table>
  <div>Tanggal Faktur: <strong>12 Oktober 2026</strong> | Status: <strong>APPROVAL SUKSES</strong></div>
  <div style="margin-top: 15px; font-size: 10px;">Halaman 2 dari 2 — Lampiran Faktur Pajak Terverifikasi DJP Coretax</div>
</body>
</html>`;

async function main() {
  console.log('[1/2] Launching headless browser for stress test generation...');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
  }

  // 1. Skewed / Discount Invoice (PNG & PDF)
  const page1 = await browser.newPage({ viewport: { width: 850, height: 950 } });
  await page1.setContent(HARD_01_HTML, { waitUntil: 'load' });
  const p1Png = path.join(FIXTURES_DIR, 'doc-hard-01-skewed-invoice.png');
  const p1Pdf = path.join(FIXTURES_DIR, 'doc-hard-01-skewed-invoice.pdf');
  await page1.screenshot({ path: p1Png });
  await page1.pdf({ path: p1Pdf, format: 'A4', printBackground: true });
  await page1.close();
  console.log('  [OK] Rendered doc-hard-01-skewed-invoice (3deg tilt, 12% Coretax, discount)');

  // 2. Tax-Exempt e-Faktur (PNG & PDF)
  const page2 = await browser.newPage({ viewport: { width: 800, height: 750 } });
  await page2.setContent(HARD_03_HTML, { waitUntil: 'load' });
  const p2Png = path.join(FIXTURES_DIR, 'doc-hard-03-exempt-faktur.png');
  const p2Pdf = path.join(FIXTURES_DIR, 'doc-hard-03-exempt-faktur.pdf');
  await page2.screenshot({ path: p2Png });
  await page2.pdf({ path: p2Pdf, format: 'A4', printBackground: true });
  await page2.close();
  console.log('  [OK] Rendered doc-hard-03-exempt-faktur (0% rate, Kawasan Berikat)');

  // 3. Multi-Page Package (Combined 2-page PDF)
  const context = await browser.newContext();
  const multiPage = await context.newPage();
  const p3Pdf = path.join(FIXTURES_DIR, 'doc-hard-02-multipage-package.pdf');
  
  // Combine HTML pages using print CSS page breaks
  const COMBINED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page { size: A4; margin: 15mm; } .page-break { page-break-after: always; }</style></head><body><div class="page-break">${MULTIPAGE_P1}</div><div>${MULTIPAGE_P2}</div></body></html>`;
  await multiPage.setContent(COMBINED_HTML, { waitUntil: 'load' });
  await multiPage.pdf({ path: p3Pdf, format: 'A4', printBackground: true });
  await multiPage.close();
  console.log('  [OK] Rendered doc-hard-02-multipage-package (2 pages: Invoice + Faktur)');

  await browser.close();
  console.log('[2/2] Stress test fixtures generated successfully.');
}

main().catch(err => {
  console.error('Failed generating hard fixtures:', err);
  process.exit(1);
});
