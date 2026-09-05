// Refuse to let a credential into the history.
//
// Scans the diff a branch actually introduces rather than the whole repository, for two
// reasons: it is fast enough to run on every build, and an old finding somewhere else
// cannot quietly mask a new one added here.
//
//   node scripts/secret-scan.js            # against origin/main
//   node scripts/secret-scan.js <base-ref> # against something else
'use strict';

const { execFileSync } = require('child_process');

const base = process.argv[2] || 'origin/main';

/* Patterns are deliberately narrow. A scanner that cries wolf gets disabled within a
   week, and a disabled scanner protects nothing. Each one matches a shape that is a
   credential and is not plausibly anything else. */
const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JWT with payload', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { name: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{24,}/ },
  // An assignment of a long opaque value to something named like a secret.
  { name: 'hardcoded secret assignment',
    re: /\b(?:api[_-]?key|secret|password|passwd|token|private[_-]?key)\b\s*[:=]\s*['"][A-Za-z0-9_+/=-]{20,}['"]/i },
];

/* Lines that legitimately look alarming. Kept short and specific — a growing allowlist is
   a sign the patterns are wrong, not that the code is fine. */
const ALLOWED = [
  /process\.env\./,                       // reading a secret is not leaking one
  /\bYOUR_[A-Z_]+\b/,                     // placeholders in docs
  /example|sample|placeholder|dummy|fake/i,
  /\$\{\{\s*secrets\./,                   // GitHub Actions secret references
];

let diff;
try {
  diff = execFileSync('git', ['diff', '--unified=0', `${base}...HEAD`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  console.error(`secret-scan: could not diff against ${base}: ${e.message}`);
  process.exit(2);
}

const findings = [];
let file = null;

for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  const added = line.slice(1);
  if (ALLOWED.some((re) => re.test(added))) continue;
  for (const { name, re } of PATTERNS) {
    if (re.test(added)) {
      // The finding is reported, never the value. Printing it would put the credential
      // into the build log, which is the thing this exists to prevent.
      findings.push(`${file}: ${name}`);
      break;
    }
  }
}

if (findings.length) {
  console.error(`secret-scan: ${findings.length} finding(s) in the branch diff:`);
  for (const f of [...new Set(findings)]) console.error(`  ${f}`);
  console.error('\nNo values are printed. Remove the credential and rewrite the commit that added it.');
  process.exit(1);
}

const addedLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
console.log(`secret-scan: clean — ${addedLines} added lines checked against ${base}`);
