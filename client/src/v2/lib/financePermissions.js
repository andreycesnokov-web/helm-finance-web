// Mirrors the existing Business server writer roles; this never grants access.
// The API still checks current membership on every operation.
export const canRecordCompanyMoney = role => ['owner', 'ceo', 'admin', 'cfo', 'accountant'].includes(role)
export const canSubmitBill = role => ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'manager', 'employee'].includes(role)
