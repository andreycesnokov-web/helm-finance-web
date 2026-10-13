const PREFIX = 'cfoEntryDraft:v1:'
const fields = ['amount', 'wallet_id', 'date', 'description', 'category']
export function entryDraftKey(actor, business) {
  if (!/^-?\d+$/.test(String(actor || '')) || !/^[a-f0-9-]{36}$/i.test(String(business || ''))) return null
  return PREFIX + actor + ':' + business
}
export function readEntryDraft(storage, key) {
  if (!key) return null
  try {
    const value = JSON.parse(storage.getItem(key))
    if (value?.version !== 1 || !['income', 'expense'].includes(value.type) || !fields.every(f => typeof value[f] === 'string')) return null
    return { type: value.type, ...Object.fromEntries(fields.map(f => [f, value[f]])) }
  } catch { return null }
}
export function writeEntryDraft(storage, key, value) {
  if (!key) return false
  try {
    if (!value.amount && !value.description && !value.category) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify({ version: 1, type: value.type, ...Object.fromEntries(fields.map(f => [f, String(value[f] ?? '')])) }))
    return true
  } catch { return false }
}
