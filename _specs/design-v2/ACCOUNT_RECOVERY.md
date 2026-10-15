# R3 account read/save recovery

Scope: Platform/current user's profile and Business entry; no Personal wallets, implicit companies or auth model changes. No migration or flag change.

A failed profile/workspace read is explicit and cannot substitute empty data. Saving requires a successful own-profile read. The verified email is read-only identity metadata scoped by the current CFO JWT BIGINT actor; submitted email/user_id cannot change it.

Manual name/timezone draft is actor-namespaced and contains neither token nor document/money data. Save is single-flight, requires a durable pending draft, matching canonical PATCH acknowledgement and fresh own-profile read. Unknown outcomes retain the draft and block replay; an explicit read checks the original fields after reload without another PATCH. Late replies after actor switch/unmount cannot confirm, clear drafts or follow up under another actor.

This does not add profile version/CAS or guarantee external email delivery. Real staging evidence is recorded outside the checkout with exact source/runtime versions.
