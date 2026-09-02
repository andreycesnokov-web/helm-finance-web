#!/usr/bin/env python3
"""Integrity validator for the Indonesia Official KB.

Run from the repo root:  python3 knowledge/indonesia_official_kb/tools/validate_kb.py

Enforces the invariants this KB depends on:
  * no rule candidate is 'active'; no source carries a legal 'verified' status
  * downloaded_file is only set when the file actually exists on disk
  * every archived file has a sha256, and it MATCHES the bytes on disk
  * every archived file appears in MANIFEST.json, and vice versa
  * registry JSON/CSV stay in sync
  * all JSON parses
Exit code 1 on any failure.
"""
import json, csv, os, sys, hashlib

KB = os.path.join("knowledge", "indonesia_official_kb")
errs, warns, oks = [], [], []


def ok(m): oks.append(m)
def err(m): errs.append(m)
def warn(m): warns.append(m)


def load(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        err(f"invalid JSON: {p} ({e})")
        return None


reg = load(os.path.join(KB, "source_registry.json"))
man = load(os.path.join(KB, "raw_sources", "MANIFEST.json"))
cands = {n: load(os.path.join(KB, "rule_candidates", n)) for n in
         ("tax_rule_candidates.json", "evidence_rule_candidates.json", "compliance_rule_candidates.json")}
if reg is None or man is None or any(v is None for v in cands.values()):
    print("FATAL: JSON did not parse"); sys.exit(1)
ok("all JSON files parse")

# 1. nothing activated, nothing legally verified
for name, doc in cands.items():
    key = name.replace(".json", "")
    for c in doc.get(key, []):
        cid = c.get("candidate_id") or c.get("evidence_type")
        if c.get("status") != "under_review":
            err(f"{name}: {cid} status={c.get('status')} (must be under_review)")
        if "rate" in c and c.get("status") == "active":
            err(f"{name}: {cid} is ACTIVE")
ok("no rule candidate is active; all under_review")

for s in reg["sources"]:
    if s.get("status") not in ("collected", "needs_review"):
        err(f"registry {s['source_id']}: status={s.get('status')} (must be collected/needs_review)")
    if s.get("verification_status") not in (
            "search_listed", "fetch_verified", "opened_no_download", "unreachable", "blocked",
            "deprecated_candidate"):
        err(f"registry {s['source_id']}: bad verification_status={s.get('verification_status')}")
ok("no source claims a legal 'verified' status")

# 2. downloaded_file only when the file exists, and the hash matches
checked = 0
for s in reg["sources"]:
    df, sha = s.get("downloaded_file", ""), s.get("sha256", "")
    if not df:
        if sha:
            err(f"registry {s['source_id']}: sha256 set with no downloaded_file")
        continue
    if not os.path.exists(df):
        err(f"registry {s['source_id']}: downloaded_file does not exist: {df}")
        continue
    if not sha:
        err(f"registry {s['source_id']}: file exists but sha256 missing")
        continue
    actual = hashlib.sha256(open(df, "rb").read()).hexdigest()
    if actual != sha.lower():
        err(f"registry {s['source_id']}: SHA MISMATCH\n    on disk: {actual}\n    recorded: {sha}")
    else:
        checked += 1
ok(f"{checked} archived files: sha256 recomputed and matches")

# 3. manifest <-> disk <-> registry
mfiles = {e["local_file"] for e in man["entries"] if e.get("local_file")}
for e in man["entries"]:
    lf, sha = e.get("local_file", ""), e.get("sha256", "")
    if lf and not os.path.exists(lf):
        err(f"manifest {e['source_id']}: local_file missing on disk: {lf}")
    if lf and not sha:
        err(f"manifest {e['source_id']}: local file with no sha256")
    if not lf and sha:
        err(f"manifest {e['source_id']}: sha256 with no local_file")

on_disk = set()
for dp, _, ns in os.walk(os.path.join(KB, "raw_sources")):
    for n in ns:
        if n.lower().endswith((".html", ".pdf", ".json")) and n != "MANIFEST.json":
            on_disk.add(os.path.join(dp, n).replace("\\", "/"))
missing = on_disk - mfiles
if missing:
    err(f"archived files absent from MANIFEST: {sorted(missing)}")
ok(f"{len(on_disk)} archived files, all present in MANIFEST")

rdf = {s["downloaded_file"] for s in reg["sources"] if s.get("downloaded_file")}
if rdf - mfiles:
    err(f"registry references files not in MANIFEST: {sorted(rdf - mfiles)}")
ok("registry downloaded_file entries all appear in MANIFEST")

# 4. registry json/csv in sync
with open(os.path.join(KB, "source_registry.csv"), encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
if [r["source_id"] for r in rows] != [s["source_id"] for s in reg["sources"]]:
    err("source_registry.csv is out of sync with source_registry.json")
else:
    ok(f"registry JSON/CSV in sync ({len(rows)} rows)")

# 5. no summary claims to read an unreadable source
for sid in ("DJP_BUPOT_001", "KEMENKEU_PPH21_001"):
    p = os.path.join(KB, "summaries")
    for dp, _, ns in os.walk(p):
        for n in ns:
            if n == f"{sid}.md":
                warn(f"a summary exists for {sid}, which has no readable text layer — verify it makes no factual claim")
ok("no summary written for a source with no readable text")


# 6. Phase 2 — invoice transaction candidates, rate discipline, no facts from unreadable sources
NOT_CHUNKABLE = set(man.get("not_chunkable", {}).get("source_ids", []))

inv_p = os.path.join(KB, "rule_candidates", "invoice_transaction_candidates.json")
if os.path.exists(inv_p):
    inv = load(inv_p)
    if inv:
        rows_i = inv.get("invoice_transaction_candidates", [])
        for c in rows_i:
            cid = c.get("candidate_id")
            if c.get("status") != "under_review":
                err(f"invoice candidate {cid}: status={c.get('status')}")
            if c.get("legal_verified") is not False:
                err(f"invoice candidate {cid}: legal_verified must be false")
            if c.get("active") is not False:
                err(f"invoice candidate {cid}: active must be false")
            if not c.get("accountant_review_required"):
                err(f"invoice candidate {cid}: accountant_review_required must be true")
            if c.get("possible_rate") is not None and not c.get("source_ids"):
                err(f"invoice candidate {cid}: possible_rate set with no source_ids")
            tb = c.get("tax_base")
            if tb is None or (isinstance(tb, str) and not tb.strip()):
                err(f"invoice candidate {cid}: tax_base must be a value or 'needs_reviewer'")
            if c.get("possible_rate") is not None:
                sids = set(c.get("source_ids", []))
                if sids and sids.issubset(NOT_CHUNKABLE):
                    err(f"invoice candidate {cid}: rate supported only by not_chunkable sources")
        ok(f"{len(rows_i)} invoice candidates: under_review, legal_verified=false, active=false")

for c in cands["tax_rule_candidates.json"].get("tax_rule_candidates", []):
    cid = c.get("candidate_id")
    if c.get("rate") is not None:
        sids = set(c.get("source_ids", []))
        if not sids:
            err(f"{cid}: rate set with no source_ids")
        elif sids.issubset(NOT_CHUNKABLE):
            err(f"{cid}: rate supported only by not_chunkable sources")
    b = c.get("base")
    if b is None or (isinstance(b, str) and not b.strip()):
        err(f"{cid}: base must be a value or 'needs_reviewer'")
ok("no rate rests solely on an unreadable source; every base is set or needs_reviewer")


# 7. Currentness evidence must never masquerade as legal verification
ALLOWED_CUR = {"berlaku", "dicabut", "diubah", "unknown"}
cur_n = 0
for s in reg["sources"]:
    sid = s["source_id"]
    has = [k for k in ("currentness_result", "currentness_checked_at", "currentness_status_source",
                       "currentness_note") if s.get(k)]
    if not has:
        continue
    cur_n += 1
    if len(has) != 4:
        err(f"registry {sid}: partial currentness block, missing {sorted({'currentness_result','currentness_checked_at','currentness_status_source','currentness_note'} - set(has))}")
    if s.get("currentness_result") not in ALLOWED_CUR:
        err(f"registry {sid}: currentness_result={s.get('currentness_result')} not in {sorted(ALLOWED_CUR)}")
    if s.get("status") not in ("collected", "needs_review"):
        err(f"registry {sid}: currentness recorded but status={s.get('status')}")
    note = str(s.get("currentness_note", "")).lower()
    if "not legally_verified" not in note.replace("not legally verified", "not legally_verified"):
        err(f"registry {sid}: currentness_note must state it is NOT legally_verified")
    for ref in (s.get("currentness_status_source") or []):
        if ref not in {x["source_id"] for x in reg["sources"]}:
            err(f"registry {sid}: currentness_status_source references unknown source {ref}")
ok(f"{cur_n} sources carry a complete currentness block; none claims legal verification")

for fn, key in (("tax_rule_candidates.json", "tax_rule_candidates"),):
    for c in cands[fn].get(key, []):
        if c.get("currentness_result") and (c.get("legal_verified") or c.get("status") != "under_review"):
            err(f"{c.get('candidate_id')}: currentness present but candidate is not under_review/unverified")
inv_p2 = os.path.join(KB, "rule_candidates", "invoice_transaction_candidates.json")
if os.path.exists(inv_p2):
    _i = load(inv_p2)
    for c in (_i or {}).get("invoice_transaction_candidates", []):
        if c.get("currentness_result") and (c.get("legal_verified") is not False or c.get("active") is not False):
            err(f"{c.get('candidate_id')}: currentness present but legal_verified/active not false")
ok("no candidate treats currentness evidence as legal verification")

print("\n".join(f"  ok   {m}" for m in oks))
if warns:
    print("\n".join(f"  warn {m}" for m in warns))
if errs:
    print("\n".join(f"  FAIL {m}" for m in errs))
    print(f"\nVALIDATION FAILED: {len(errs)} error(s)")
    sys.exit(1)
print(f"\nVALIDATION PASSED ({len(oks)} checks, {len(warns)} warning(s))")
