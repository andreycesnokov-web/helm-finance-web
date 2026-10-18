// PT Circleka Indonesia Utama 3-page commercial invoice & tax package fixture.
// Mirrors the real production document (cd850fe1-c214-43e3-8353-23c471dd8567)
// from PT Circleka Indonesia Utama to PT Helm Care Indonesia.
//
// Page 1: Commercial supplier invoice (payable total: IDR 143,856,000).
// Page 2: Trade Activity Confirmation (TAC) / placement agreement (incentive: IDR 10,800,000).
// Page 3: Indonesian Faktur Pajak (DPP: IDR 118,800,000, PPN: IDR 14,256,000).
'use strict';

const CIRCLEKA_PAGE_1_INVOICE = `PT CIRCLEKA INDONESIA UTAMA
Jl. Danau Sunter Barat Blok A-3 No. 37-38, Jakarta Utara 14350
NPWP : 01.234.567.8-091.000

INVOICE
Invoice No.   : X2610001139
Invoice Date  : 31/07/2026
Due Date      : 30/08/2026

Bill To:
PT HELM CARE INDONESIA
NPWP : 09.876.543.2-101.000
Jl. Sunset Road No. 88, Seminyak, Kuta, Bali

Description                                        Amount (IDR)
Rent space / placement of Helm Care machines       129.600.000
in 36 Circle K stores (Periode 15/04/2026 - 14/07/2026)

Sub Total                                          129.600.000
PPN 12% (Pajak Pertambahan Nilai)                   14.256.000
Total Tagihan                                      143.856.000

Payment Instructions:
Mohon transfer pembayaran ke rekening:
Bank BCA
Rekening No : 075-3020192
Atas Nama   : PT CIRCLEKA INDONESIA UTAMA
`;

const CIRCLEKA_PAGE_2_TAC = `TRADE ACTIVITY CONFIRMATION (TAC)
Agreement No. : TAC-2026-CK-0842
Date          : 15/04/2026

Parties:
First Party   : PT Circleka Indonesia Utama
Second Party  : PT Helm Care Indonesia

Activity Details:
Placement of automated helmet cleaning machines in 36 Circle K Bali stores.
Gross Space Fee     : Rp 129.600.000
Listing Incentive   : Rp  10.800.000
Tax Base (DPP)      : Rp 118.800.000
PPN 12%             : Rp  14.256.000
Payable to Supplier : Rp 143.856.000

Signed and agreed by both parties.
`;

const CIRCLEKA_PAGE_3_FAKTUR_PAJAK = `Faktur Pajak
Kode dan Nomor Seri Faktur Pajak: 040.026-00.313616020

Pengusaha Kena Pajak
Nama : PT Circleka Indonesia Utama
Alamat : Jl. Danau Sunter Barat Blok A-3 No. 37-38, Jakarta Utara
NPWP : 01.234.567.8-091.000

Pembeli Barang Kena Pajak / Penerima Jasa Kena Pajak
Nama : PT Helm Care Indonesia
Alamat : Jl. Sunset Road No. 88, Seminyak, Kuta, Bali
NPWP : 09.876.543.2-101.000

No.  Nama Barang Kena Pajak / Jasa Kena Pajak      Harga Jual / Penggantian
1.   Penempatan mesin helm care di 36 gerai Circle K             118.800.000
     Periode 15 April 2026 s/d 14 Juli 2026

Harga Jual / Penggantian                                         118.800.000
Dikurangi Potongan Harga                                                   0
Dikurangi Uang Muka                                                        0
Dasar Pengenaan Pajak                                            118.800.000
Jumlah PPN (Pajak Pertambahan Nilai)                              14.256.000
PPnBM (Pajak Penjualan Barang Mewah)                                       0

Sesuai dengan ketentuan yang berlaku, Direktorat Jenderal Pajak mengatur bahwa
Faktur Pajak ini telah dilaporkan dan sah.
Tanggal Faktur: 31 Juli 2026
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
    issuer_name: 'PT Circleka Indonesia Utama',
    buyer_name: 'PT Helm Care Indonesia',
    counterparty_name: null,
    issuer_npwp: '01.234.567.8-091.000',
    buyer_npwp: '09.876.543.2-101.000',
    date: '2026-07-31',
    invoice_date: '2026-07-31',
    due_date: '2026-08-30',
    currency: 'IDR',
    subtotal: 129600000,
    commercial_base_amount: 129600000,
    tax_base_dpp: 118800000,
    discount_amount: 10800000,
    commercial_tax_amount: 14256000,
    gross_amount: 143856000,
    amount: 143856000,
    payment_method: 'TRANSFER',
    period_start: '2026-04-15',
    period_end: '2026-07-14',
    reference_number: null,
    npwp: '01.234.567.8-091.000',
  },
  supporting_documents: {
    invoice: true,
    tax_invoice: true,
    contract: true,
    payment_proof: false,
  },
  warnings: [],
};

module.exports = {
  CIRCLEKA_PAGE_1_INVOICE,
  CIRCLEKA_PAGE_2_TAC,
  CIRCLEKA_PAGE_3_FAKTUR_PAJAK,
  CIRCLEKA_FULL_PACKAGE_TEXT,
  CIRCLEKA_VISION_MOCK,
};
