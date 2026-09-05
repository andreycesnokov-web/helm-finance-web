// Run the test suite, on any platform.
//
// CI used to check that server/index.js parses and that the client builds. Both are
// worth knowing and neither says whether the software works, so "CI is green" was a
// weaker statement than it looked on a pull request. This runs the actual tests.
//
//   node scripts/run-tests.js            unit tests (fast)
//   node scripts/run-tests.js --all      unit + integration
//   node scripts/run-tests.js --integration
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const onlyIntegration = args.includes('--integration');

const listTests = (dir) => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter((f) => /\.test\.(js|mjs)$/.test(f))
    .sort()
    .map((f) => path.join(dir, f).split(path.sep).join('/'));
};

const files = [
  ...(onlyIntegration ? [] : listTests('tests')),
  ...(wantAll || onlyIntegration ? listTests('tests/integration') : []),
];

if (files.length === 0) {
  console.error('No test files found — refusing to report success on an empty run.');
  process.exit(1);
}

const failures = [];
const started = Date.now();

for (const file of files) {
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: 'utf8' });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  const summary = (output.match(/^.*(?:ALL PASS|passed|FAILED|# pass).*$/gm) || []).pop() || '';
  if (r.status !== 0) {
    failures.push(file);
    console.log(`FAIL  ${file}`);
    // Only the failing assertions, so a red build is readable without scrolling.
    const detail = output.split('\n').filter((l) => /^\s*(XX|not ok|AssertionError|Error:)/.test(l));
    for (const line of detail.slice(0, 8)) console.log(`      ${line.trim()}`);
    if (detail.length === 0) console.log(output.split('\n').slice(-8).join('\n'));
  } else {
    console.log(`ok    ${file}  ${summary.trim()}`);
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n${files.length} files, ${failures.length} failed, ${secs}s`);
if (failures.length) {
  console.log(`failing: ${failures.join(', ')}`);
  process.exit(1);
}
