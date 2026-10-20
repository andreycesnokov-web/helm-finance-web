# Reproduce targeted checks

From the isolated repository root, with lockfile dependencies installed:

```powershell
node --test tests/transactionDocumentStatus.test.js tests/integration/payrollRunsSql.test.js tests/integration/pickerDocumentLinksSql.test.js tests/payrollRunValidation.test.js tests/design/payrollRunModel.test.mjs tests/design/transactionPicker.test.mjs tests/design/v2DocumentsBills.test.mjs tests/design/v2Guards.test.mjs tests/financialRecovery.test.mjs tests/walletLedger.test.js tests/documentAccess.test.js
```

Build from `client/`, once with each value:

```powershell
$env:VITE_DESIGN_V2='false'; npm run build
$env:VITE_DESIGN_V2='true'; npm run build
```

After the ON build, run UI fixtures from the repository root:

```powershell
$env:CHROMIUM='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:UI_IN_PROCESS='true'
node tests/design/v2/transactionPickerBrowser.mjs
node tests/design/v2/payrollRunsBrowser.mjs
```

The in-process transport routes the existing built frontend and existing fixture map inside the test browser. It does not provide database/HTTP/Auth/Storage acceptance and does not connect to the live owner browser.

Only after a separately confirmed native disposable local database is available, provide its connection through the local environment (never chat) and run:

```powershell
node --test tests/integration/postgresPayrollRunRaces.test.js
```

This suite creates/drops only its own database after the existing shared-cluster guard. No production connection or fallback is accepted. Real PostgREST/Auth/private Storage acceptance remains a separate required gate.
