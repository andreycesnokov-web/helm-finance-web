# PPh Pasal 23 - summary

> Orientation note written from official sources on 2026-09-02. **Not a citation and not legal advice.** Every figure is a candidate awaiting licensed review. Go to the primary regulation before relying on anything here.

## What we established

PPh 23 is withholding on payments to **entities** for services, including technical, management,
construction and consulting services, plus a list of *jasa lain*. DJP guidance describes the rate as
**2% of DPP**, with DPP being the transaction value **excluding PPN**, and a **100% higher rate (4%)**
where the counterparty has no NPWP. Withholding is evidenced by a **bukti potong**, now issued through
Coretax e-Bupot.

The *jasa lain* list is cited to PMK-141/PMK.03/2015 (`DJP_PPH23_003`).

## What is unresolved

- **The PMK text has not been retrieved.** Everything above comes from DJP explanatory pages.
- Whether legal / paralegal services sit inside the *jasa lain* list.
- The entity-vs-individual boundary: `DJP_PPH23_005` is explicitly about this being confused with
  PPh 21. Our `counterparties` table holds no field that would let the engine decide.

## Why this matters to the product

This is the rule to activate first. It drives Test Case 1 and is the most common supplier situation.
It is also the rule where the missing **counterparty NPWP field** bites: without it the engine cannot
choose between the 2% and 4% variants and must present both.
