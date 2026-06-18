// Deterministic cash-impact reconciliation for a vendor invoice + withholding.
// Pure (no DB, no LLM). Keeps the commercial, official-VAT and withholding bases
// SEPARATE — never assumes they are equal. Reports mismatches instead of hiding
// them. The document layer never moves cash; this only describes expected cash.
function n(v) { return Number(v || 0); }

function reconcileInvoice(input) {
  const subtotal = n(input.subtotal_amount);
  const commercialVat = n(input.commercial_tax_amount);
  const gross = n(input.gross_amount);
  const wBase = n(input.withholding_base);
  const wRate = n(input.withholding_rate);
  const wAmount = n(input.withholding_amount);
  const bankFee = n(input.bank_fee);

  const grossComputed = subtotal + commercialVat;
  const withholdingComputed = Math.round(wBase * wRate);
  const expectedVendorNet = gross - wAmount;             // vendor receives gross minus withholding
  const settlement = expectedVendorNet + wAmount;        // closes the payable (bank fee NOT included)
  const vendorBankDebit = expectedVendorNet + bankFee;   // what the bank actually debits for the vendor payment

  const mismatches = [];
  if (gross && Math.abs(grossComputed - gross) > 1) mismatches.push(`gross ${gross} != subtotal+VAT ${grossComputed}`);
  if (wBase && wRate && Math.abs(withholdingComputed - wAmount) > 1) mismatches.push(`withholding ${wAmount} != base*rate ${withholdingComputed}`);
  if (Math.abs(settlement - gross) > 1) mismatches.push(`settlement ${settlement} != gross ${gross}`);

  return {
    subtotal, commercial_vat: commercialVat, gross,
    withholding_amount: wAmount,
    expected_vendor_net_amount: expectedVendorNet,
    settlement,                       // vendor_net + withholding = gross
    bank_fee: bankFee,                // separate expense, NOT part of settlement
    vendor_bank_debit: vendorBankDebit,
    balanced: mismatches.length === 0,
    mismatches,
  };
}

module.exports = { reconcileInvoice };
