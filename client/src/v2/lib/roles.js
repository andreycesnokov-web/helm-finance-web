// Client mirrors of the server's role gates (server/index.js). Used ONLY to avoid
// firing a request the server will refuse and to hide controls a role cannot
// use; the server remains the authority and re-checks every call.
const FINANCE_VIEW = ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'auditor']
const APPROVE = ['owner', 'ceo', 'admin', 'cfo']
const AI_CFO = ['owner', 'ceo', 'admin', 'cfo', 'accountant']

const norm = (r) => String(r || '').toLowerCase()
export const canViewFinance = (role) => FINANCE_VIEW.includes(norm(role))
export const canApprove = (role) => APPROVE.includes(norm(role))
export const canUseAiCfo = (role) => AI_CFO.includes(norm(role))
