# R6/R7 company review — Business only

Actual browser baseline on 756da41 reproduced three defects without saving a
profile: manual=1 still launched document reading; an explicit edit disappeared
after reload; a company recorded as Singapore submitted jurisdiction ID.

Manual mode now skips reading. Company-bound manual draft fields and explicit
answers are stored under actor + Business id; no token, document bytes or AI
responses enter the draft. Draft storage failure is visible. Scoped request guards
discard late responses; failed or partial saves retain the draft. Clear only after
the real profile response confirms every submitted field.

The existing company country resolves country identity, not tax rules. Unknown or
conflicting saved jurisdiction requires profile review. Indonesia-specific fields
and questions are only used for Indonesia. No new rules for Singapore/Malaysia/
Thailand are invented, and this registration calendar plainly reports unsupported
countries instead of showing Indonesian duties. Existing financial-year dates
remain unchanged unless the user explicitly changes that selection.

The existing role-checked, audited profile PUT and capability/partial-save contract
remain authoritative. No migration, authorization model, billing or financial
writer changes. R1–R10 is still incomplete until real negative and cross-cutting
browser/API/DB acceptance is recorded for all remaining paths.
