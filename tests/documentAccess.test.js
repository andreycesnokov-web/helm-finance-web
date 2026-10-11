// Manager/employee/auditor access regression. Run: node tests/documentAccess.test.js
const A = require('../server/lib/documentAccess');

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };

const ownDoc = { created_by_user_id: 10, links: [] };
const othersDoc = { created_by_user_id: 99, links: [] };
const linkedToOwnDebt = { created_by_user_id: 99, links: [{ target_type: 'debt', target_id: 500 }] };
const linkedToOtherDebt = { created_by_user_id: 99, links: [{ target_type: 'debt', target_id: 777 }] };

// Manager
ok('manager sees own uploaded document', A.canAccessDocument({ role: 'manager', userId: 10, doc: ownDoc }));
ok('manager sees document linked to their own submitted debt', A.canAccessDocument({ role: 'manager', userId: 10, doc: linkedToOwnDebt, ownedDebtIds: [500] }));
ok('manager CANNOT browse all business documents (not own/linked)', !A.canAccessDocument({ role: 'manager', userId: 10, doc: othersDoc, ownedDebtIds: [500] }));
ok('manager CANNOT access another manager\'s unrelated document', !A.canAccessDocument({ role: 'manager', userId: 10, doc: linkedToOtherDebt, ownedDebtIds: [500] }));
ok('manager cannot manage (link/archive)', !A.canManageDocuments('manager'));
ok('manager can upload', A.canUploadDocument('manager'));

// Employee — equivalent restricted behavior
ok('employee sees own document', A.canAccessDocument({ role: 'employee', userId: 7, doc: { created_by_user_id: 7, links: [] } }));
ok('employee restricted from others', !A.canAccessDocument({ role: 'employee', userId: 7, doc: othersDoc }));
ok('employee can upload', A.canUploadDocument('employee'));
ok('employee cannot manage', !A.canManageDocuments('employee'));

// Auditor — read-only across the business
ok('auditor sees all (read)', A.canAccessDocument({ role: 'auditor', userId: 3, doc: othersDoc }));
ok('auditor cannot upload', !A.canUploadDocument('auditor'));
ok('auditor cannot manage', !A.canManageDocuments('auditor'));

// Finance roles
ok('cfo views all', A.canViewAllDocuments('cfo'));
ok('accountant manages', A.canManageDocuments('accountant'));
ok('owner manages', A.canManageDocuments('owner'));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
