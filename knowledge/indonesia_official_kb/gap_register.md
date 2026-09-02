# Gap register

Updated **2026-09-02** after Phase 2. Severity: **blocker** = a rule cannot be drafted responsibly
without it · **important** = drafting is possible but risky · **later** = not on the invoice/payable path.

| # | Gap | Status | Severity | Why it matters | Next step |
|---|---|---|---|---|---|
| 1 | PPh 4(2) governing regulation | **CLOSED** | — | 10% final + gross definition cited to PP 34/2017 Pasal 4(1)–(2) | — currentness evidence archived, shows `Berlaku` |
| 2 | PMK-141 *jasa lain* list | **CLOSED** | — | 2% + gross-excl-PPN + *jasa hukum* item (d) cited to primary text | — currentness evidence archived, shows `Berlaku` |
| 3 | PPN current treatment | **partly closed** | important | Amendment identified as PMK 53/2025 eff. 2025-08-01; full amending text not read | Retrieve PMK 53/2025 full text from JDIH |
| 4 | Faktur pajak required fields | **open** | important | Blocks input-VAT creditability and evidence field lists | Find the PER on faktur pajak at `pajak.go.id/peraturan` |
| 5 | `DJP_BUPOT_001` unreadable | **open** | important | Bukti potong required-field list still unsourced | Needs OCR or a CID-capable extractor |
| 6 | `KEMENKEU_PPH21_001` unreadable | **open** | later | PPh 21 is out of v1 scope anyway | Needs a CID-capable extractor |
| 7 | BPJS Kesehatan source | **host CONFIRMED, content open** | later | Employer obligation completeness | Collect from `www.bpjs-kesehatan.go.id` |
| 8 | NPWP / no-NPWP uplift | **open** | important | Doubles the PPh 23 rate; not in PMK 141 | Locate in UU PPh Pasal 23(1a) |
| 9 | Rent vs service charge | **partly closed, still HIGH RISK** | **blocker for mixed invoices** | Two archived instruments point different ways | See below |
| 10 | General PPh Badan rate | **open** | important | Code seeds 22% with no source | UU PPh consolidated at `peraturan.bpk.go.id` |
| 11 | PT PMA sources | **open** | later | Company Vault context only | `bkpm.go.id` / `oss.go.id/regulasi` |
| 12 | Import / interest / intercompany | **open** | later | Transaction types drafted with no source at all | Collect only when those flows are built |

## Gap 9 in detail — the mixed-invoice boundary

Both sides are now archived and read, and they point in different directions:

- **PP 34/2017 Pasal 4(2)** — a service/maintenance/security/facility charge relating to the rented
  property is **inside** the 10% rental base, *"baik yang perjanjiannya dibuat secara terpisah maupun
  yang disatukan"* (whether contracted separately or combined).
- **`DJP_PPH42_006`** — building services supplied by a **third-party provider** are *jasa manajemen*,
  taxed at **2% under Pasal 23**.

Our reading is that the distinction is **who pays whom** — tenant→landlord falls under PP 34/2017,
owner→third-party manager falls under PPh 23. **That reading is ours, not the regulation's**, and it
is recorded as a reviewer question, not as a rule.

Until a reviewer resolves it, `TXN_MIXED_INVOICE` and `TXN_BUILDING_SERVICE_CHARGE` carry
`engine_behaviour: always_review`, and the engine must not apply a single rate to a mixed invoice.

## Gap 7 in detail — BPJS host

The Phase-1 allowlist named `bpjskesehatan.go.id`. **That host does not resolve.** The official host
is **`www.bpjs-kesehatan.go.id`** (hyphenated), confirmed by a 200 response. No BPJS Kesehatan
content was collected — only the host target is now settled, per the instruction not to collect
broadly until the official source is confirmed.

## Currentness evidence — added 2026-09-02

Both closed blockers now carry archived status evidence:

| Instrument | Result | Evidence | Caveat |
|---|---|---|---|
| PP 34 Tahun 2017 | `berlaku` | BPK "Status Berlaku"; JDIH "06 Sep 2017 – s.d. Dicabut"; Riwayat Dokumen (2), both **outgoing** | none recorded |
| PMK 141/PMK.03/2015 | `berlaku` | BPK "Status Berlaku"; JDIH "24 Jul 2015 – s.d. Dicabut"; Riwayat Dokumen (1), **outgoing** only | **BPK "STATUS PERATURAN: Belum Tersedia"** — no relationship data held, so absence ≠ proof |

`currentness_result` records what an official status page **said on the checked date**. It is
evidence of publication status only — it is **not** legal verification, and it never sets
`legal_verified` or `active`.
