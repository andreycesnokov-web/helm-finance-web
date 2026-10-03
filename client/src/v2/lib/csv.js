// One CSV cell. Quotes commas, quotes and line breaks, and blocks formula injection: a text
// cell starting with = + - @ (or a tab / carriage return) is prefixed with ' so a spreadsheet
// shows it as text instead of running it (OWASP "CSV injection"). A plain number such as
// -125000 is left as a number. Used by every v2 export.
const FORMULA = /^[=+\-@\t\r]/
const NUMBER = /^-?\d+(\.\d+)?$/
export function csvCell(v) {
  let s = String(v ?? '')
  if (FORMULA.test(s) && !NUMBER.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
