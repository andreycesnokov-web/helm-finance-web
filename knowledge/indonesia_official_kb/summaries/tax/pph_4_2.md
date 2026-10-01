# PPh Pasal 4 ayat (2) - rental - summary

> Orientation note written from official sources on 2026-09-02. **Not a citation and not legal advice.** Every figure is a candidate awaiting licensed review. Go to the primary regulation before relying on anything here.

## What we established

Rental of land and/or buildings is subject to **final** income tax under Article 4(2). DJP guidance
describes a rate of **10% of gross rental value**, where gross is said to include amounts paid in any
form relating to the rented property - explicitly mentioning maintenance, security and service
charges. Withholding is done by the tenant where the tenant is a designated withholder; otherwise the
landlord remits directly. Deposit is described as due by the 10th of the following month.

## What is unresolved

- **The governing PP has not been retrieved. This is the single biggest gap in the knowledge base.**
- The precise test for "designated withholder".
- The boundary with PPh 23: `DJP_PPH42_006` is a DJP warning specifically about mis-rating building
  service charges. This is the most product-relevant open question we have.

## Why this matters to the product

Two things make this harder than PPh 23:

1. **It is final, not creditable.** The accounting treatment differs, so the engine cannot model it
   as an ordinary withholding that simply reduces the payment.
2. **The gross definition may sweep in service charges** that a tenant invoice lists separately.
   Test Case 2 (Alfamart bundle) is exactly this shape: a kwitansi plus faktur pajak plus a rental
   agreement, where base rent and service charge may be separate lines.
