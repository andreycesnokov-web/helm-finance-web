'use strict';

/**
 * Case C — PT Sumber Alfaria Trijaya Tbk (Alfamart) 3-Page Retail Package Fixture
 * Matches real document ad2d46ae-2006-417d-92a3-d33c3b4be013-kwt-tc-2607-0342-pthelm-care-indonesia.pdf
 */

const ALFAMART_PAGE_1_KWITANSI = `PT. SUMBER ALFARIA TRIJAYA TBK
Alfa Tower Lt. 12, Jl. Jalur Sutera Barat Blok 10A, Tangerang, Banten 15143
NPWP: 01.336.238.9-054.000

KWITANSI / BUKTI PEMBAYARAN
No: SAT/Z001/K-P/26/VIII/0133
Tanggal: 04-08-2026

Sudah terima dari : HELM CARE INDONESIA
NPWP              : 1000000002284592
Jumlah Uang       : Rp 11.322.000
Terbilang         : Sebelas Juta Tiga Ratus Dua Puluh Dua Ribu Rupiah

Untuk Pembayaran  : Sewa space tenant mesin helm care gerai Alfamart
                    (Termasuk PPN 12%)
Metode Pembayaran : Transfer Bank BCA
Rekening          : 012.893.1001 a.n PT Sumber Alfaria Trijaya Tbk

Penerima,
[Cap & Tanda Tangan]
PT SUMBER ALFARIA TRIJAYA TBK
`;

const ALFAMART_PAGE_2_FAKTUR_PAJAK = `Faktur Pajak
Kode dan Nomor Seri Faktur Pajak: 04002600300202886

Pengusaha Kena Pajak:
Nama  : SUMBER ALFARIA TRIJAYA TBK
Alamat: ALFA TOWER LT. 12, JL JALUR SUTERA BARAT, TANGERANG, BANTEN 15143
NPWP  : 01.336.238.9-054.000

Pembeli Barang Kena Pajak / Penerima Jasa Kena Pajak:
Nama  : HELM CARE INDONESIA
Alamat: PERTOKOAN SOHO DHARMAWANGSA NO. A3, KUTA SELATAN, BALI
NPWP  : 1000000002284592

No.  Nama Barang Kena Pajak / Jasa Kena Pajak      Harga Jual / Penggantian
1.   SEWA TENANT TC-2607-0342 TERM 1               10.200.000
     Rp 10.200.000,00 x 1,00 Kegiatan

Harga Jual / Penggantian / Uang Muka / Termin      10.200.000
Dikurangi Potongan Harga                                     0
Dasar Pengenaan Pajak (DPP)                         9.350.000
Jumlah PPN (Pajak Pertambahan Nilai 12%)            1.122.000
Jumlah PPnBM                                                 0

Sesuai dengan ketentuan yang berlaku, Direktorat Jenderal Pajak mengatur bahwa
Faktur Pajak ini telah ditandatangani secara elektronik.
TANGERANG, 04 Agustus 2026
`;

const ALFAMART_PAGE_3_LEASE_AGREEMENT = `PERJANJIAN SEWA TENANT / REKAPITULASI
PT SUMBER ALFARIA TRIJAYA TBK & PT HELM CARE INDONESIA
No. Kontrak: TC-2607-0342
Jatuh Tempo: 14-08-2026

Rincian Komitmen Biaya:
1. Biaya Sewa Pokok                               : Rp 10.200.000
2. Biaya Administrasi & Pajak Terkait              : Rp    102.000
Total Nilai Perjanjian                            : Rp 10.302.000

Catatan Pajak:
Sewa tanah/bangunan dikenakan PPh Final Pasal 4(2) sebesar 10% dari Dasar Pengenaan Pajak.
Pajak PPN 12% dipungut oleh Pengusaha Kena Pajak.
`;

const ALFAMART_FULL_PACKAGE_TEXT = `${ALFAMART_PAGE_1_KWITANSI}\n\f\n${ALFAMART_PAGE_2_FAKTUR_PAJAK}\n\f\n${ALFAMART_PAGE_3_LEASE_AGREEMENT}`;

module.exports = {
  ALFAMART_PAGE_1_KWITANSI,
  ALFAMART_PAGE_2_FAKTUR_PAJAK,
  ALFAMART_PAGE_3_LEASE_AGREEMENT,
  ALFAMART_FULL_PACKAGE_TEXT
};
