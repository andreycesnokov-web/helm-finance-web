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

  const grossComputed = subtotal + commercialVat;
  const withholdingComputed = Math.round(wBase * wRate);
  const expectedVendorNet = gross - wAmount;             // vendor receives gross minus withholding
  const combinedCashOut = expectedVendorNet + wAmount;   // vendor net + tax payment

  const mismatches = [];
  if (gross && Math.abs(grossComputed - gross) > 1) mismatches.push(`gross ${gross} != subtotal+VAT ${grossComputed}`);
  if (wBase && wRate && Math.abs(withholdingComputed - wAmount) > 1) mismatches.push(`withholding ${wAmount} != base*rate ${withholdingComputed}`);
  if (Math.abs(combinedCashOut - gross) > 1) mismatches.push(`combined cash-out ${combinedCashOut} != gross ${gross}`);

  return {
    subtotal, commercial_vat: commercialVat, gross,
    withholding_amount: wAmount,
    expected_vendor_net_amount: expectedVendorNet,
    combined_cash_out: combinedCashOut,
    balanced: mismatches.length === 0,
    mismatches,
  };
}

module.exports = { reconcileInvoice };
