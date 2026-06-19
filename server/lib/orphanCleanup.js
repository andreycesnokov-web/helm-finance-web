// Pure core for abandoned-upload cleanup. No I/O — the CLI in
// server/scripts/cleanupOrphanDocuments.js injects the real storage lister and
// the set of referenced paths. Unit-tested in tests/orphanCleanup.test.js.

// An object is an orphan iff it is OLDER than the threshold AND its storage_path
// is NOT referenced by document_files. A referenced file is NEVER an orphan,
// regardless of age — that is the hard safety invariant.
function findOrphans(objects, referencedPaths, now = new Date(), thresholdHours = 24) {
  const ref = referencedPaths instanceof Set ? referencedPaths : new Set(referencedPaths || []);
  const cutoff = new Date(now).getTime() - thresholdHours * 3600 * 1000;
  const out = [];
  for (const o of (objects || [])) {
    if (!o || !o.path) continue;
    if (ref.has(o.path)) continue;                         // referenced → never an orphan
    const created = o.created_at ? new Date(o.created_at).getTime() : 0;
    if (created > cutoff) continue;                        // younger than threshold → ignore
    out.push({ path: o.path, ageHours: Math.round((new Date(now).getTime() - created) / 3600000) });
  }
  return out;
}

module.exports = { findOrphans };
