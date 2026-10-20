// Read-only cursor protocol. Reject a repeated/out-of-order page rather than
// presenting duplicate rows as additional bank evidence.
export function appendTransactionPage(rows, page, beforeId, pageSize = 500) {
  if (!Array.isArray(page) || page.length > pageSize) throw new Error('Invalid transactions response')
  let previous = beforeId ?? Infinity
  for (const row of page) {
    const id = Number(row?.id)
    if (!Number.isSafeInteger(id) || id < 1 || id >= previous) throw new Error('Invalid transaction cursor')
    previous = id
  }
  return { rows: [...rows, ...page], beforeId: page.length ? previous : beforeId, hasMore: page.length === pageSize }
}
