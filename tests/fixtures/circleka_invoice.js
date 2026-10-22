// PT Circleka Indonesia Utama 3-page commercial invoice & tax package fixture.
// Mirrors the real production document (cd850fe1-c214-43e3-8353-23c471dd8567)
// from PT Circleka Indonesia Utama to PT Helm Care Indonesia.
//
// Page 1: Commercial supplier invoice (payable total: IDR 143,856,000, Est. Pay: 14/08/2026).
// Page 2: Trade Activity Confirmation (TAC) / placement agreement.
// Page 3: Indonesian Faktur Pajak (DPP: IDR 118,800,000, PPN: IDR 14,256,000, Serial: 04002600313616020).
//
// Real document identifiers:
// Supplier NPWP: 00.207.974.4-507.000 (15-digit) / 002079744507000 (16-digit)
// Buyer NPWP:    1000000002284592 (16-digit NIK/NPWP format)
'use strict';

const CIRCLEKA_PAGE_1_INVOICE = `PT. Circleka Indonesia Utama
NPWP : 00.207.974.4-507.000
Jl. Jatinegara Barat No.124, Bali Mester, Jatinegara, Jakarta Timur, DKI Jakarta 13320

INVOICE
Document Date   : 31/07/2026
Est. Pay Date   : 14/08/2026
Customer Account: X2610001139

Bill To:
PT. HELM CARE INDONESIA
NPWP : 1000000002284592
Jl. Dharmawangsa No. 43, Benoa, Kuta Selatan

Description                                        Amount (IDR)
Rent space / penempatan unit mesin helm care       129.600.000
di 36 toko Circle K (Periode 15/04/2026 - 14/07/2026)

Sub Total                                          129.600.000
PPN 12% (Pajak Pertambahan Nilai)                   14.256.000
Total Tagihan                                      143.856.000

Terbilang: Seratus Empat Puluh Tiga Juta Delapan Ratus Lima Puluh Enam Ribu Rupiah

Payment Instructions:
Mohon transfer pembayaran ke rekening:
Bank Central Asia (BCA) KCP Kuta
Rekening No : 040.184.5111
Atas Nama   : PT CIRCLEKA INDONESIA UTAMA
`;

const CIRCLEKA_PAGE_2_TAC = `TRADE ACTIVITY CONFIRMATION (TAC)
PT. HELM CARE INDONESIA
Rent space 36 Store Circle K
Periode: 15 April 2026 - 14 Juli 2026

Nilai Kegiatan: Rp 129.600.000
Invoice will be issued according to information from TAC & agreed by both parties.
Signed and agreed by both parties.
`;

const CIRCLEKA_PAGE_3_FAKTUR_PAJAK = `Faktur Pajak
Kode dan Nomor Seri Faktur Pajak: 04002600313616020

Pengusaha Kena Pajak:
Nama  : CIRCLEKA INDONESIA UTAMA
Alamat: JL JATINEGARA BARAT NO.124, RT 000, RW 000, KAMPUNG MELAYU, JATINEGARA, KOTA ADM. JAKARTA TIMUR, DKI JAKARTA 13320
NPWP  : 00.207.974.4-507.000

Pembeli Barang Kena Pajak / Penerima Jasa Kena Pajak:
Nama  : HELM CARE INDONESIA
Alamat: Pertokoan Soho Dharmawangsa No. 43, Jl Dharmawangsa RT 000 RW 000, BENOA KUTA SELATAN, KAB. BADUNG, BALI 80363
NPWP  : 1000000002284592

No.  Nama Barang Kena Pajak / Jasa Kena Pajak      Harga Jual / Penggantian
1.   HELM CARE INDONESIA PT - RENT SPACE           129.600.000
     PENEMPATAN UNIT MESIN HELM CARE DI 36 TOKO
     CIRCLE K PERIODE 15 APRIL 2026 - 14 JULI 2026
     Rp 129.600.000,00 x 1,00 Kegiatan
     Potongan Harga = Rp 0,00
     PPnBM (0.00%)  = Rp 0,00

Harga Jual / Penggantian / Uang Muka / Termin      129.600.000
Dikurangi Potongan Harga                                     0
Dikurangi Uang Muka yang telah diterima                      0
Dasar Pengenaan Pajak                              118.800.000
Jumlah PPN (Pajak Pertambahan Nilai)                14.256.000
Jumlah PPnBM (Pajak Penjualan atas Barang Mewah)             0

Sesuai dengan ketentuan yang berlaku, Direktorat Jenderal Pajak mengatur bahwa
Faktur Pajak ini telah ditandatangani secara elektronik sehingga tidak diperlukan tanda tangan basah.
KOTA ADM. JAKARTA TIMUR, 31 Juli 2026
HENDRI WIBOWO
(Referensi: X2610001139)
`;

const CIRCLEKA_FULL_PACKAGE_TEXT = `${CIRCLEKA_PAGE_1_INVOICE}
\f
${CIRCLEKA_PAGE_2_TAC}
\f
${CIRCLEKA_PAGE_3_FAKTUR_PAJAK}
`;

const CIRCLEKA_VISION_MOCK = {
  text: CIRCLEKA_FULL_PACKAGE_TEXT.slice(0, 1500),
  document_type: 'invoice',
  confidence: 'high',
  fields: {
    document_number: 'X2610001139',
    tax_invoice_serial: '04002600313616020',
    issuer_name: 'PT. Circleka Indonesia Utama',
    buyer_name: 'PT. HELM CARE INDONESIA',
    counterparty_name: null,
    issuer_npwp: '00.207.974.4-507.000',
    buyer_npwp: '1000000002284592',
    date: '2026-07-31',
    invoice_date: '2026-07-31',
    due_date: '2026-08-14',
    estimated_payment_date: '2026-08-14',
    currency: 'IDR',
    subtotal: 129600000,
    commercial_base_amount: 129600000,
    tax_base_dpp: 118800000,
    discount_amount: null,
    subtotal_dpp_variance: 10800000,
    commercial_tax_amount: 14256000,
    gross_amount: 143856000,
    amount: 143856000,
    payment_method: 'TRANSFER',
    period_start: '2026-04-15',
    period_end: '2026-07-14',
    reference_number: null,
    npwp: '00.207.974.4-507.000',
  },
  supporting_documents: {
    invoice: true,
    tax_invoice: true,
    contract: true,
    payment_proof: false,
  },
  warnings: [
    'Commercial subtotal (129600000) differs from Faktur Pajak DPP (118800000) by 10800000.',
  ],
};

module.exports = {
  CIRCLEKA_PAGE_1_INVOICE,
  CIRCLEKA_PAGE_2_TAC,
  CIRCLEKA_PAGE_3_FAKTUR_PAJAK,
  CIRCLEKA_FULL_PACKAGE_TEXT,
  CIRCLEKA_VISION_MOCK,
};
