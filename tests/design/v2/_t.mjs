// Tiny runner shared by the design-v2 tests (same style as tests/design/*).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
export const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

let pass = 0, fail = 0
export async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`) }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) }
}
export function done() {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}
