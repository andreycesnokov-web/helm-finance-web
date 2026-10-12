# Company setup documents — Business only

R5 reuses the existing signed Storage upload, audited classification endpoint,
scoped metadata read and Company Vault routing. No new schema, financial writer,
authentication, entitlement or feature flag is introduced.

A proposal does not fill a slot. Only the existing Vault's human-confirmed company
type counts; filename/content classification is a suggestion. A real successful
classification acknowledgement must agree with a fresh scoped document read before
the UI reports a confirmed type. A refusal keeps the uploaded file and selected
proposal, with an explicit retry; it cannot become a successful checklist item.

Saved company files and unconfirmed setup/accountant uploads are restored from the
existing scoped document list on reload. Other evidence remains in the regular
Documents page. AI unavailability is shown plainly; this form never claims it read
identifiers merely because a filename resembles NIB/NPWP. Applying profile values
is still a separate explicit user action.

The document list is authoritative for checklist slots after invalidation. Local
success state cannot keep an archived/missing file in a refreshed checklist.

Actual read-only browser reproduction found setup URLs ignored business_id and
read the previously selected company's documents. Setup now reuses the existing
route-scope resolver and holds company-bound children until URL membership and
selection resolve. Invalid/inaccessible companies do not issue document requests;
creation itself remains actor-only. A later company switch drops old URL intent.

Local diagnostic note: the existing static document/bill translation test parsed
the last ID object incorrectly on Windows CRLF. Normalize only line endings before
the same key/assertion checks; expected keys and product translations are unchanged.

Acceptance requires actual browser upload/Storage/API/DB, explicit classification,
refusal without false success, reload without duplicate upload, current membership
and Business boundary checks. External AI reading remains separately unverified
until an actual provider response is verified. A previous diagnostic returned an
HTTP 200 identity object with `unavailable_reason: ai_request_failed`; the UI must
not mistake that object for a successful reading. Provider availability is not
established by a configured key or an HTTP 200 alone. The owner authorized a new
external AI check using only a specially created synthetic document.
