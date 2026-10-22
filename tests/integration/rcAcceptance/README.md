# Explicitly admitted synthetic RC acceptance

These are executable real HTTP/PostgreSQL/Storage/Playwright checks, not routed API fixtures. Never point them at production, a shared staging database, or customer files. Run only after the approved NEW target admission and private runner configuration in the accompanying review package. The runner has no host ports and its own internal networks.

Admission creates fresh synthetic identities and an ephemeral `/tmp/acceptance-session.json` inside the private runner; never print/download it. Every database-bearing script checks `pg_control_system()` against that admitted cluster. Required runner environment: own `DATABASE_URL`, `BASE_URL`, `PLATFORM_URL`, platform credentials and expected NEW cluster; set through private local/server files, never chat or source control. `NODE_PATH=/opt/runner/node_modules` supplies pg and playwright-core. Real V2 must be built with VITE_DESIGN_V2=true and VITE_EMAIL_AUTH_ENABLED=true. No paid/external AI configuration.

Order: admit-http -> picker-http -> payroll-http -> browser-native -> browser-lifecycle-final. The final lifecycle deliberately requires unused synthetic period2027-04 and a unique bank description; it refuses replay if that period already exists. It injects a transport failure ONLY AFTER `route.fetch()` receives a successful real committed response. All recovery is the actual product receipt UI; no fabricated response. The supplied final script passed end to end. Earlier navigation-harness failures are retained in review evidence and are not counted as passing suites.

Then before-restart -> restart ONLY the newly admitted app (review-package helper) -> browser-relogin-permissions. Browser-bill-callers uses real scoped bill create/document link APIs to prepare two synthetic callers; it follows actual payable/receivable detail links to the shared Documents picker and restores document type. No final output or accounting approval is manufactured.

Browser transport is an in-runner localhost reverse proxy forwarding actual app responses unchanged. This provides the standard trustworthy-localhost secure context/Web Locks, without disabled browser web security or published host ports. It is not proof of access from the owner's Windows browser. A raw Chromium no-sandbox launch is confined to an unprivileged, resource-limited, isolated synthetic runner; do not reuse it in production.

Native independent-connection races remain `../postgresPayrollRunRaces.test.js`: actual PG17.6, protected-cluster guards, no embedded fallback. Embedded SQL tests are a separate PG18.3 layer.

Evidence JSON/screenshots/logs contain synthetic data only. Collect allowlisted evidence, never private env, cookies, storageState, OAuth URLs, or JWTs. Snapshot/compare the bank ledger and balance around every product action. Synthetic bank transactions in tests are explicit setup fixtures; linking/saving/approving must not create cash.
