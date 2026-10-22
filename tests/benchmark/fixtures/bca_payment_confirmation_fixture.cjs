'use strict';

/**
 * Case B2 — BCA Outward Remittance / Payment Confirmation Fixture
 * Matches documented bank payment proof for LMX settlement
 */

const BCA_PAYMENT_CONFIRMATION_TEXT = `PT BANK CENTRAL ASIA TBK
BUKTI TRANSFER / OUTWARD REMITTANCE RECEIPT

Tanggal Transaksi / Date   : 28/09/2026
Jam / Time                 : 09:14:22 WIB
Nomor Referensi            : BCA-REM-20260928-0914
Status                     : BERHASIL / SUCCESS

Rekening Sumber / Sender:
Nomor Rekening             : 040.184.9921
Nama Pengirim              : PT HELM CARE INDONESIA

Rekening Tujuan / Beneficiary:
Bank Penerima              : DBS BANK LTD SINGAPORE
Nomor Rekening Penerima    : 003-902148-1
Nama Penerima              : LOCATION MEDIA XCHANGE PTE LTD

Rincian Transfer:
Mata Uang                  : USD
Jumlah Ditransfer          : 472.00
Biaya Transfer             : USD 5.00
Berita / Description       : Advance payment SaaS Subscription IVLMXS-26-0215

Dokumen ini merupakan bukti sah transaksi transfer Bank Central Asia.
`;

module.exports = {
  BCA_PAYMENT_CONFIRMATION_TEXT
};
