const normal = (v) => v == null || v === '' ? '' : Array.isArray(v) ? v.map(String).join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v)

// A 2xx alone does not confirm every submitted value. Keep unsupported and
// unconfirmed input in the form; never automatically repeat a partially saved write.
export function unsavedFields(body, row, response = {}) {
  const pending = new Set([...(response.not_saved || []), ...(response.unsupported_fields || [])])
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue
    if (key === 'field_verification') {
      for (const [field, state] of Object.entries(value || {})) {
        if (normal(row?.[key]?.[field]) !== normal(state)) pending.add(key)
      }
    } else if (!row || !Object.hasOwn(row, key) || normal(row[key]) !== normal(value)) pending.add(key)
  }
  return [...pending]
}
