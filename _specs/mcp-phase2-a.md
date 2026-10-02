# MCP Phase 2 · Batch A — invoice extraction accuracy

Workspace: **Business** (document extraction is business-scoped; no Personal path touched).
No new tools, no flags, no migrations, no env, no auth.

## Problem (live MCP test, 2026-10-02)
PT. PARA LEGALS INDONESIA invoice № 832/INV/IX/2026: CFO read the amount and number but not
the supplier, the buyer or the date, so direction came out `unknown`. Reproduced with a
fixture (`tests/fixtures/paralegals_invoice.js`, fake addresses/account) in two shapes:
multi-line and one-line PDF text.

Root causes:
1. Issuer/buyer were read from labels only (`Dari/From/Vendor`, `Kepada/Bill to`). This
   invoice names the supplier only in the letterhead, the "Best Regard" signature block and
   "atas nama" in the bank details; the buyer after `To :`.
2. In `documentParties`, `/\bto\s*:?/` matched the "To" inside **"Total"**, opening a BUYER
   block that captured the supplier from the payment instructions below it.
3. Dates: "Denpasar, September 25th 2026" (month first, ordinal) was not a recognised form.
4. Document number: with a bare `INVOICE` title the parser could answer with a WORD
   ("Nomor"/"Invoice") — the known "Invoice" bug.
5. Description: a table header "Description · Amount" was read as the description ("Amount").

## Changes
- `server/lib/documentParties.js`: `To :` needs its colon and a word boundary; signature
  blocks (`Best Regard(s)`, `Hormat kami`, `Sincerely`) and `atas nama` / `account name` open
  ISSUER blocks; names stop at a street address (`Jl.`), a "City, date" line, or a signatory
  title; a city glued before a date in one-line text is trimmed.
- `server/lib/documentExtraction.js`:
  - issuer/buyer fall back to the party blocks when no label names them (a side with no block
    stays null; the same company on both sides leaves the buyer empty with a warning);
  - buyer labels gain `Kepada Yth.` and `To :`;
  - document number must contain a digit; `Nomor :` / `Invoice No` labels preferred;
  - new fields `payee_bank_name`, `payee_account_number`, `payee_account_name` from the
    payment instructions — read only when an account number is printed;
  - description skips table-header words, row numbers and the item price.
- `server/lib/documentDates.js`: month-first (`September 25th 2026`, `Sept 25, 2026`) and
  ordinal day-first (`25th September 2026`) dates; the lone-date fallback recognises them.
- `server/lib/counterpartyIntelligence.js`: an invoice's payee account is attached to the
  suggested counterparty **only when the issuer is the counterparty** (a bill to us). On an
  invoice we issued it is our own account and is not filed against the client. This lets an
  existing supplier saved under another name ("Paralegal") be matched by bank account.

## Tests
- Fixture tests in `documentExtraction` (+10), `documentParties` (+3), `documentDates` (+2):
  supplier/buyer/number/total/description/bank in both shapes; full intake → `payable`,
  vendor `PT. PARA LEGALS INDONESIA` with the BNI account; match of an existing "Paralegal"
  counterparty by account; an invoice we issued → `receivable` with no bank account attached;
  "Total" no longer opens a buyer block; bare `INVOICE` title never becomes the number.
- All existing extraction/party/date/OCR/counterparty tests unchanged and green.
- Full suite 1450/1451 (only the pre-existing `telegramActorWiring › no migration was added by
  PR2.5`, which also fails on main).

## Risk
Party fallback only runs when the label-based reading found nothing, so documents that read
correctly before are unaffected (all prior fixtures unchanged). New fields are additive keys of
the extraction result (`EMPTY_FIELDS`); nothing writes them anywhere yet.
Production impact: better suggestions on new/re-analysed documents; nothing is saved by
extraction itself.
