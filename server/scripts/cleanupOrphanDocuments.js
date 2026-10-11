#!/usr/bin/env node
// Abandoned-upload cleanup for the Tax Documents private bucket.
//
//   Dry-run (default, deletes NOTHING):
//     node server/scripts/cleanupOrphanDocuments.js
//   Actually delete confirmed orphans:
//     node server/scripts/cleanupOrphanDocuments.js --execute
//   Options: --hours=24  --bucket=financial-documents
//
// Safety invariants:
//   • lists objects under businesses/*/documents/*
//   • an object is removed ONLY if it is older than the threshold AND its
//     storage_path is absent from document_files
//   • a path referenced by document_files is NEVER deleted (any age)
//   • dry-run by default; deletion requires explicit --execute
//   • logs path, age and result
// This script is NOT scheduled — no destructive cron is added in this PR.
const { createClient } = require('@supabase/supabase-js');
const { findOrphans } = require('../lib/orphanCleanup');
require('dotenv').config();

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const EXECUTE = process.argv.includes('--execute');
const THRESHOLD_HOURS = Number(arg('hours', 24));
const BUCKET = arg('bucket', process.env.DOCUMENTS_BUCKET || 'financial-documents');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Recursively list every object under businesses/*/documents/*.
async function listAllObjects(prefix = 'businesses') {
  const out = [];
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list(${prefix}): ${error.message}`);
  for (const entry of (data || [])) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null || entry.metadata == null) out.push(...await listAllObjects(path)); // folder
    else out.push({ path, created_at: entry.created_at || entry.updated_at || null });
  }
  return out;
}

(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1);
  }
  console.log(`[orphan-cleanup] bucket=${BUCKET} threshold=${THRESHOLD_HOURS}h mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

  const objects = await listAllObjects();
  const { data: files, error } = await supabase.from('document_files').select('storage_path');
  if (error) { console.error('document_files read failed:', error.message); process.exit(1); }
  const referenced = new Set((files || []).map(f => f.storage_path));

  const orphans = findOrphans(objects, referenced, new Date(), THRESHOLD_HOURS);
  console.log(`[orphan-cleanup] objects=${objects.length} referenced=${referenced.size} orphans=${orphans.length}`);

  let removed = 0;
  for (const o of orphans) {
    if (referenced.has(o.path)) { console.log(`SKIP (referenced) ${o.path}`); continue; } // belt-and-braces
    if (!EXECUTE) { console.log(`DRY-RUN would delete  ${o.path}  (age ${o.ageHours}h)`); continue; }
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([o.path]);
    if (rmErr) console.log(`ERROR deleting ${o.path}: ${rmErr.message}`);
    else { console.log(`DELETED ${o.path}  (age ${o.ageHours}h)`); removed++; }
  }
  console.log(`[orphan-cleanup] done — ${EXECUTE ? `deleted ${removed}` : `dry-run, deleted 0 (would delete ${orphans.length})`}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
