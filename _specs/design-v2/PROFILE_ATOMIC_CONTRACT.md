# Business profile next implementation contract

Owner's latest request: complete all16 fields, protected sources, atomic profile+audit, concurrent saves and version-bound confirm. Scope Business only; Personal finance and tax/rate rules unchanged. Source helper is preparatory and NOT wired to current live routes.

`profileProvenance.js` validates declared fields/types and actor/Business-namespaced source reads, own non-archived document plus own file, exact existing server extraction cache/value, manual edits resetting old labels, and refusal of client accountant_verified. Unit fixtures do not prove live AI. Explicit conflict stays conflict; discovery of conflicting own cached documents remains the eventual server/RPC responsibility.

Next standalone migration adds16 fields and numeric profile version/verified version as needed, preserving old schema/RLS/grants/history. New service-only invoker RPC must recheck current Business membership/role and own sources INSIDE the transaction and shared lock order; JS preflight is insufficient against TOCTOU. No UUID auth bridge or new Personal bridge.

Save must compare expected version, update only submitted fields, increment version and insert audit atomically. Audit failure rolls back all profile changes. Confirmation must target the exact displayed version and write its audit/version atomically; any concurrent edit invalidates stale confirmation. Never retain a prior verified label on an edited field or treat extracted suggestion as confirmed profile.

Keep existing manual/no-AI and honest unsupported/partial-save UI until the new schema/RPC are accepted. No legacy direct-write fallback on missing RPC. Implement load/current-actor/Business guards, explicit conflict review, expected version on R6/P1/P2 save/confirm, own history and unknown-outcome readback without automatic replay. Country remains current Business country; non-ID gets no invented ID obligations.

Required evidence before live rollout: own fresh backup + disposable native restore, final SQL hash/applicability, audit rollback, independent-session save/confirm races, own/foreign/archived/missing source, no invented extraction, removed/reader roles, anon/auth RPC grants and zero financial/Personal change. Then exact builds and own staging rollout, cache reload, actual all16-field API/UI/DB save/reload/edit/confirm/history/validation/rollback/A→B→A. Preview five native groups from b3c4d0a are schema-only proof, not this contract acceptance.
