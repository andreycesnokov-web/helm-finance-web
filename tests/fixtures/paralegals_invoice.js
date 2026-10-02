// A legal-services invoice laid out the way PT. PARA LEGALS INDONESIA's invoice
// 832/INV/IX/2026 reached CFO in the live MCP test (2026-10-02): supplier only in the
// letterhead and the "Best Regard" signature block, buyer after "To :", the number after
// "Nomor :", the date written "Denpasar, September 25th 2026", and the bank details at the
// bottom ("Bank BNI / Rek. No / atas nama"). CFO read the amount and number but not the
// parties or the date, so direction came out "unknown".
//
// Addresses, phone and the account number are FAKE. Amounts are illustrative.
'use strict';

const PARALEGALS_INVOICE = `PT. PARA LEGALS INDONESIA
Jl. Contoh Raya No. 12, Denpasar, Bali 80000
Telp. (0361) 000-0000 | Email: billing@example.test

INVOICE
Nomor : 832/INV/IX/2026

To : PT Helm Care Indonesia
Jl. Contoh Bypass No. 1
Denpasar, Bali

No  Description                                        Amount
1   Jasa konsultasi hukum - perubahan anggaran dasar   Rp 15.000.000
2   Biaya pengurusan SK Kemenkumham                    Rp 2.500.000
Total                                                  Rp 17.500.000

Pembayaran dapat ditransfer ke:
Bank BNI
Rek. No : 0000-1111-22
atas nama : PT. Para Legals Indonesia

Denpasar, September 25th 2026
Best Regard,


PT. PARA LEGALS INDONESIA
Director
`;

// The same document as PDF text often arrives: no line breaks at all.
const PARALEGALS_INVOICE_ONE_LINE = PARALEGALS_INVOICE.replace(/\s*\n\s*/g, ' ');

module.exports = { PARALEGALS_INVOICE, PARALEGALS_INVOICE_ONE_LINE };
