// Unit tests for orphan-upload cleanup core. Run: node tests/orphanCleanup.test.js
const { findOrphans } = require('../server/lib/orphanCleanup');

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };

const NOW = new Date('2026-06-19T12:00:00Z');
const hAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();

const objects = [
  { path: 'businesses/A/documents/d1/old-orphan.pdf', created_at: hAgo(48) },   // orphan, old
  { path: 'businesses/A/documents/d2/young-orphan.pdf', created_at: hAgo(2) },  // orphan, young
  { path: 'businesses/A/documents/d3/referenced.pdf', created_at: hAgo(72) },   // referenced, old
];
const referenced = new Set(['businesses/A/documents/d3/referenced.pdf']);

const orphans = findOrphans(objects, referenced, NOW, 24);
const paths = orphans.map(o => o.path);

ok('orphan found (old + unreferenced)', paths.includes('businesses/A/documents/d1/old-orphan.pdf'));
ok('young upload (< threshold) ignored', !paths.includes('businesses/A/documents/d2/young-orphan.pdf'));
ok('referenced file NEVER removed (even if old)', !paths.includes('businesses/A/documents/d3/referenced.pdf'));
ok('exactly one orphan identified', orphans.length === 1);
ok('orphan carries an age in hours', orphans[0].ageHours >= 24);

// Safety: a referenced file that is also young is doubly safe.
ok('referenced+young never orphan', findOrphans([{ path: 'p', created_at: hAgo(1) }], new Set(['p']), NOW, 24).length === 0);
// Empty inputs are safe.
ok('no objects -> no orphans', findOrphans([], new Set(), NOW, 24).length === 0);
ok('null-safe', findOrphans(null, null, NOW, 24).length === 0);

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
