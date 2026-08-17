// Guard against the "input loses focus after one character" bug class.
//
// A component declared INSIDE another component gets a new function identity on every
// render. React compares element types by identity, so it unmounts the old subtree and
// mounts a fresh one — destroying the <input> DOM node and its focus/caret. Typing then
// only ever registers a single character before the user has to click back in.
//
// That is exactly what happened to the AI Accountant Tax Profile form: `Field` was declared
// inside `BusinessAccountant`. This test fails if any file that renders form controls
// re-introduces the pattern.
//
//   Run: node --test tests/integration/formComponentStability.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'client', 'src');

function jsxFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsxFiles(full, out);
    else if (entry.name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

// An indented (= nested) declaration of a Capitalised component.
const NESTED_DECL = /^[ \t]+(?:const\s+([A-Z]\w*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\s+([A-Z]\w*)\s*\()/;

function findNestedFormComponents(source) {
  const lines = source.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const m = NESTED_DECL.exec(lines[i]);
    if (!m) continue;
    // Only flag when the declaration actually renders a form control — that is the case
    // where a remount destroys focus. Other nested components are a perf smell, not this bug.
    const body = lines.slice(i, i + 25).join('\n');
    if (/<input\b|<select\b|<textarea\b/.test(body)) {
      hits.push({ name: m[1] || m[2], line: i + 1 });
    }
  }
  return hits;
}

test('no component that renders form controls is declared inside another component', () => {
  const offenders = [];
  for (const file of jsxFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/<input\b|<select\b|<textarea\b/.test(src)) continue;   // only form-bearing files
    for (const hit of findNestedFormComponents(src)) {
      offenders.push(`${path.relative(SRC, file)}:${hit.line} — <${hit.name}> declared inside another component`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    'Nested component(s) rendering form controls will remount on every keystroke and lose input focus.\n' +
    'Move the component to module scope and pass what it needs via props:\n  ' + offenders.join('\n  '));
});

test('detector actually catches the original Tax Profile pattern', () => {
  // Sanity check: the exact shape of the bug that shipped must be detected, otherwise the
  // guard above could pass vacuously.
  const buggy = [
    'export function BusinessAccountant() {',
    '  const [form, setForm] = useState({})',
    '  const Field = ({ label, k }) => (',
    '    <div>',
    '      <input value={form[k] || \'\'} onChange={e => set(k, e.target.value)} />',
    '    </div>',
    '  )',
    '  return <Field label="NPWP" k="npwp" />',
    '}',
  ].join('\n');
  const hits = findNestedFormComponents(buggy);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].name, 'Field');
});

test('module-scope form components are allowed', () => {
  const good = [
    'function Field({ label, k, form, set }) {',
    '  return <input value={form[k] ?? \'\'} onChange={e => set(k, e.target.value)} />',
    '}',
    'export function Page() { return <Field label="NPWP" k="npwp" /> }',
  ].join('\n');
  assert.deepStrictEqual(findNestedFormComponents(good), []);
});
