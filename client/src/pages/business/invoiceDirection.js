// Invoice direction — the SINGLE source of truth for "does this invoice create money
// we owe, or money owed to us?", and for every user-facing word that follows from it.
//
// This module exists because the answer was previously re-derived (and hardcoded) in
// several places, which is how a customer_invoice ended up being described as a
// "supplier payable". Anything that needs a direction-dependent label must read it from
// here — never write "supplier" or "payable" inline.
//
// Mapping comes from the REAL CHECK-constrained document_type values (migration 031):
//   vendor_invoice   → payable      (a supplier billed us)
//   customer_invoice → receivable   (we billed a customer)
//   tax_invoice      → UNKNOWN      (a faktur pajak exists on both sides)
//
// tax_invoice is deliberately left undirected. Guessing would be a coin flip that
// silently creates the wrong kind of record, so the UI asks instead.

export const DIRECTION_BY_TYPE = {
  vendor_invoice: 'payable',
  customer_invoice: 'receivable',
}

/** @returns 'payable' | 'receivable' | null (null = genuinely unknown, do not guess) */
export function directionOf(d) {
  return DIRECTION_BY_TYPE[d?.document_type] || null
}

/* Every direction-dependent string in one table. `null` is a first-class case, not a
   fallback to the payable wording. */
const META = {
  payable: {
    dir: 'payable',
    known: true,
    rowLabel: 'Supplier invoice',
    reviewEyebrow: 'Review supplier invoice',
    reviewSub: 'AI prepared a payable suggestion. Review tax before this affects your books.',
    party: 'Supplier',
    partyLower: 'supplier',
    recordNoun: 'payable',
    createdNoun: 'Supplier payable',
    moneyLine: 'Money your business needs to pay.',
    withholdLabel: 'Less: withholding tax',
    netLabel: 'Net amount to pay supplier',
    payCardLabel: 'You pay supplier',
    taxCardLabel: 'You withhold for tax',
    linkExistingLabel: 'Link existing payable',
    openRecordLabel: 'Open payable',
    evidenceLine: 'This invoice is attached to the payable as supporting document.',
  },
  receivable: {
    dir: 'receivable',
    known: true,
    rowLabel: 'Sales invoice',
    reviewEyebrow: 'Review sales invoice',
    reviewSub: 'AI prepared a receivable suggestion. Review tax before this affects your books.',
    party: 'Customer',
    partyLower: 'customer',
    recordNoun: 'receivable',
    createdNoun: 'Customer receivable',
    moneyLine: 'Money owed to your business.',
    // The customer withholds from what they pay us — the mirror of the payable case,
    // never the same sentence with a different noun.
    withholdLabel: 'Less: customer withholding / deductions',
    netLabel: 'Net amount expected from customer',
    payCardLabel: 'Customer pays',
    taxCardLabel: 'Potential withholding / tax review',
    linkExistingLabel: 'Link existing receivable',
    openRecordLabel: 'Open receivable',
    evidenceLine: 'This invoice is attached to the receivable as supporting document.',
  },
  unknown: {
    dir: null,
    known: false,
    rowLabel: 'Invoice · direction needed',
    reviewEyebrow: 'Review invoice',
    reviewSub: 'Choose whether this is a supplier or a customer invoice before anything is created.',
    party: 'Counterparty',
    partyLower: 'counterparty',
    recordNoun: 'record',
    createdNoun: 'Record',
    moneyLine: 'Direction not set.',
    withholdLabel: 'Less: withholding / deductions',
    netLabel: 'Net amount',
    payCardLabel: 'Net amount',
    taxCardLabel: 'Withholding / tax review',
    linkExistingLabel: 'Link existing record',
    openRecordLabel: 'Open record',
    evidenceLine: 'This invoice is attached to the record as supporting document.',
  },
}

/** Labels for a direction. Pass the direction, not the document. */
export const directionMeta = (dir) => META[dir] || META.unknown

/** Convenience: labels straight from a document row. */
export const metaOf = (d) => directionMeta(directionOf(d))

export const GROSS_LABEL = 'Gross invoice amount'
