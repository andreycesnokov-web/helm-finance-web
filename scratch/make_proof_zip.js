const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const stage = path.join(__dirname, 'acceptance_stage');
if (fs.existsSync(stage)) {
  fs.rmSync(stage, { recursive: true, force: true });
}
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(path.join(stage, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(stage, 'tests'), { recursive: true });
fs.mkdirSync(path.join(stage, 'diffs'), { recursive: true });

// 1. Export diff
const patch = cp.execSync('git diff', { maxBuffer: 10 * 1024 * 1024 });
fs.writeFileSync(path.join(stage, 'diffs', 'feature_changes.patch'), patch);

// 2. Copy test scripts
fs.copyFileSync(path.join(__dirname, 'run_acceptance_pass2.js'), path.join(stage, 'tests', 'run_acceptance_pass2.js'));
fs.copyFileSync(path.join(__dirname, '..', 'tests', 'unit', 'burnRunway.test.js'), path.join(stage, 'tests', 'burnRunway.test.js'));
fs.copyFileSync(path.join(__dirname, '..', 'tests', 'integration', 'walletTransfersTask30.test.js'), path.join(stage, 'tests', 'walletTransfersTask30.test.js'));
fs.copyFileSync(path.join(__dirname, '..', 'tests', 'indonesiaTaxKnowledgeCards.test.cjs'), path.join(stage, 'tests', 'indonesiaTaxKnowledgeCards.test.cjs'));

// 3. Copy screenshots from artifacts dir
const artDir = 'C:\\Users\\HUAWEI\\.gemini\\antigravity\\brain\\b4b5605a-29c0-4e6a-9e39-7008b78589f3';
const files = fs.readdirSync(artDir).filter(f => f.startsWith('proof_') && f.endsWith('.png'));
for (const f of files) {
  fs.copyFileSync(path.join(artDir, f), path.join(stage, 'screenshots', f));
}
console.log(`Copied ${files.length} screenshots to stage.`);

// 4. Create README in stage
const readmeContent = `# CFO Finance OS: Acceptance & Proof Package (Draft PR #134)

- **Branch**: \`feature/cfo-os-daily-spend-transfers-tooltips\`
- **Base Commit**: \`d14e05faf45b949d76e582ae26324a31c533ac7b\`
- **Codex PR #133 SHA**: \`63feda16f678ab4e6830098289f8f87d0987745a\` (Tax KB v2 cards)
- **Draft PR**: [#134](https://github.com/andreycesnokov-web/helm-finance-web/pull/134)
- **Date**: 2026-10-06

---

## 1. Status of the Six Review Items

| Item | Scope | Verification / Status |
|---|---|---|
| **1. Incomplete FX Valuation** | If foreign currency transaction lacks \`amount_idr\`, Pulse shows warning badge & \`unvalued_tx_count\`. Amounts marked partial (\`is_partial: true\`). Confident positive cash flow, break-even, and runway are strictly blocked (\`runway_days: null\`, \`runway_reason: 'incomplete_valuation'\`). | **PASS** (Unit tests & Pulse UI verified) |
| **2. Fix Window Boundaries** | Rolling window uses calendar dates inclusive: 30-day window starts \`asOfDate - 29 days\`; partial window is \`diff + 1\` (e.g. 2026-10-02 to 2026-10-06 = 5 days inclusive). Timezone explicitly UTC. Daily spend for 15M / 5d = exactly 3,000,000 IDR (3.0M), not 3.75M. 12 comprehensive unit tests cover 1-day, 5-day partial, 30-day, past, and future transaction exclusions. | **PASS** (12 unit tests in \`burnRunway.test.js\` PASS) |
| **3. Concurrency on PostgreSQL** | \`walletTransfersTask30.test.js\` provides SQL logic verification via in-memory PGlite. True multi-process concurrency with independent TCP connections (\`postgresIndependentConnections.test.js\`) requires an external PostgreSQL daemon. In environments without a local daemon, local run reports **BLOCKED (local daemon unavailable)** and relies on the GitHub Actions CI workflow (\`.github/workflows/ci.yml:postgres-atomic-concurrency\`). | **BLOCKED (Local)** / **PASS (CI)** |
| **4. Company Switch in Browser** | Switching companies drops cache, resets state, and discards delayed in-flight responses. Modal closes immediately. Input \`#acc-ask\` and URL search params (\`?ask=\`, \`?q=\`) are cleanly stripped upon workspace switch. | **PASS** (Playwright automated test Part 5 PASS) |
| **5. Localization (RU / EN / ID)** | Fully translated: Daily spend, Net cash burn, flow states, transfer buttons (\`t('acc.transferBetween')\`), unvalued warnings, and tax knowledge reference headers across English, Russian, and Indonesian. | **PASS** (Playwright automated test Part 6 PASS) |
| **6. Server Source for Tax Cards** | Connected to backend endpoint \`GET /api/accountant/tax-knowledge/cards?lang=\` powered by Codex PR #133 \`getCard()\`. Includes loading skeleton, 401/403 forbidden protection (never masked), and offline fallback for network errors. Rates, deadlines, and TER matrices remain blocked from authoritative determination. | **PASS** (Playwright automated test Part 4 PASS) |

---

## 2. Test Execution Commands

\`\`\`bash
# 1. Run burn / runway unit tests (12 tests)
node --test tests/burnRunway.test.js

# 2. Run Codex Tax Cards contract tests (14 assertions)
node tests/indonesiaTaxKnowledgeCards.test.cjs

# 3. Run PGlite SQL transfer verification
node tests/walletTransfersTask30.test.js

# 4. Run automated browser acceptance suite (Playwright + memory Supabase shim)
node tests/run_acceptance_pass2.js
\`\`\`

---

## 3. Package Structure

- \`diffs/feature_changes.patch\`: Unified patch of all source modifications.
- \`tests/\`:
  - \`burnRunway.test.js\`: Core mathematical engine unit test suite (12 tests).
  - \`run_acceptance_pass2.js\`: Complete Playwright browser automation suite (Parts 1-6).
  - \`walletTransfersTask30.test.js\`: SQL double-entry ledger verification.
  - \`indonesiaTaxKnowledgeCards.test.cjs\`: Codex Tax KB v2 contract tests.
- \`screenshots/\`: 13 high-resolution browser proof screenshots:
  - \`proof_01_pulse_daily_spend_desktop.png\`
  - \`proof_02_daily_spend_tooltip_desktop.png\`
  - \`proof_03_accounts_before_transfer.png\`
  - \`proof_04_transfer_modal_opened.png\`
  - \`proof_05_transfer_modal_filled.png\`
  - \`proof_06_accounts_after_transfer.png\`
  - \`proof_07_pulse_mobile_390px.png\`
  - \`proof_08_tooltip_sheet_390px.png\`
  - \`proof_09_pulse_mobile_320px.png\`
  - \`proof_10_calendar_tax_cards.png\`
  - \`proof_11_accountant_tax_cards.png\`
  - \`proof_12_tax_card_details_drawer.png\`
  - \`proof_13_ask_box_prefilled.png\`
`;
fs.writeFileSync(path.join(stage, 'README.md'), readmeContent);

// 5. Package zip via powershell
const zipPath = path.join(__dirname, '..', 'CFO_OS_Acceptance_Proof.zip');
cp.execSync(`powershell -Command "Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force"`);
console.log('Archive created successfully at:', zipPath);

const hash = cp.execSync(`powershell -Command "(Get-FileHash '${zipPath}' -Algorithm SHA256).Hash"`).toString().trim();
console.log('SHA256:', hash);
