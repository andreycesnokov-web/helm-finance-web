# CFO OS V2 commercial work — INCOMPLETE

Follow the full owner request at `_specs/commercial-request-20261015.txt`. It supersedes
the previous next-task suggestion about owner financing. The invoice-linking issue
from this chat is still unresolved and was displaced by the commercial request.

Workspace: `C:/Users/HUAWEI/Documents/Codex/2026-10-15/new-chat/work/cfo-v2`.
This is a local clone of the clean 90ab5e6 source, not the original project mirror.
Read AGENTS.md and the four required _specs files. Read docs/commercial-billing-contract.md.

Stage A audit/contract is committed separately. Stage B is PARTIAL and includes the
existing businessAccess resolver's opt-in commercial policy, input/API module not yet
installed in index.js, SQL preview (not a migration), unit tests and native evidence.
The full commercial product is NOT implemented, NOT deployed, and NOT accepted.

Staging actual HEAD remains 90ab5e6b7a2fc69cd0e5c5bd43e5bf6850e27760, V2 image
sha256:e75803ba63cfbd60bdf14ad6220bafc27bf1c49e5f85ed27886e65e890a28fe3.
No shared/live schema or application was modified. Production and all actual customer
financial records are untouched. Restore/test DBs only were created on dedicated staging.

19 native PG17 preview groups PASS; 36 new local Node tests PASS; legacy 18 PASS.
Evidence is in this directory. SQL exact hash is in native-preview-results.json.
Native test script expects PREVIEW_SQL injected as a Python string and intentionally
creates a fresh restored database. Never rerun it into an existing DB; never restore
over the shared staging database. The archived first native preview is superseded by
the 19-group results only for the exact documented hash. Native is not actual HTTP/UI.

Fresh protected full backup was restored successfully with supabase_admin (postgres
is not a superuser and failed on vault.secrets; that failed copy was retained). Final
native copy restored ACLs and exercised service_role RPCs. Backup paths and hashes are
in backup-restore-results.json. Do not copy backup bytes or secrets into artifacts.

Important audit result: plan_limits is EMPTY on actual staging. Initial prices are
owner-approved USD 59/149/299 but NO commercial limits/features are approved. The only
limits tested were explicitly labeled isolated staging fixtures. Nothing was published.

Owner answered: provider not selected; probably Xendit. Treat Xendit as candidate only.
No Xendit/Midtrans/billing env keys found in V2; vault was NOT decrypted/inspected.
Do not claim sandbox-provider acceptance. Do not invent FX, refunds, proration or MRR.

NEXT independent work: complete B persistence (paid periods/admin grants/quota reservation
and central admission policy), review SQL security/applicability, generate a real migration
with CLI only after design is stable, run native and actual HTTP acceptance, then C admin
catalog/assignment and D onboarding/billing. Shared staging rollout only after exact
backup/restore/application gates. E candidate adapter contract work can proceed but actual
sandbox provider gate remains blocked. F notifications/referral and G all 22 full acceptance
groups remain open. No user approval is missing for independent development or local commits.

Do not alter existing migrations, auth identity model, customer ledger, Personal data,
production/Railway/main Supabase/HelmCare/DNS/firewall. No push/PR/merge or real payments.
