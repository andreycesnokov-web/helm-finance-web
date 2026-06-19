// Pure document access rules. Backend is the source of truth; the frontend only
// hides actions. Unit-tested in tests/documentAccess.test.js.
//
// Roles mirror server/index.js role helpers:
//   view-all  = owner/ceo/admin/cfo/accountant/auditor   (whole business)
//   upload    = all of the above except auditor + manager/employee
//   manage    = owner/ceo/admin/cfo/accountant            (link/unlink/archive/edit)
// Manager/employee are RESTRICTED: they only see documents they uploaded OR
// documents linked to a record (debt) they themselves created.

const VIEW_ALL_ROLES = ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'auditor'];
const MANAGE_ROLES   = ['owner', 'ceo', 'admin', 'cfo', 'accountant'];
const UPLOAD_ROLES   = ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'manager', 'employee'];

const canViewAllDocuments = (role) => VIEW_ALL_ROLES.includes(role);
const canManageDocuments  = (role) => MANAGE_ROLES.includes(role);
const canUploadDocument   = (role) => UPLOAD_ROLES.includes(role);

// Can this actor read this specific document?
// doc.links = [{ target_type, target_id }]; ownedDebtIds = debt ids the actor created.
function canAccessDocument({ role, userId, doc, ownedDebtIds = [] }) {
  if (canViewAllDocuments(role)) return true;
  if (!doc) return false;
  if (doc.created_by_user_id === userId) return true;             // own upload
  const owned = new Set((ownedDebtIds || []).map(String));
  return (doc.links || []).some(l => l.target_type === 'debt' && owned.has(String(l.target_id)));
}

module.exports = {
  VIEW_ALL_ROLES, MANAGE_ROLES, UPLOAD_ROLES,
  canViewAllDocuments, canManageDocuments, canUploadDocument, canAccessDocument,
};
