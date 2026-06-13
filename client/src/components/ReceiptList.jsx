import { fmt } from '../lib/api'

// Shows attached receipts with recognized amounts and a computed total.
// Falls back to the legacy single attachment_url when no attachments array.
export default function ReceiptList({ debt, token }) {
  const list = Array.isArray(debt.attachments) ? debt.attachments : []
  const hasLegacy = !list.length && debt.attachment_url

  if (!list.length && !hasLegacy) return null

  const recognized = list.map(a => Number(a.amount)).filter(n => isFinite(n) && n > 0)
  const total = recognized.reduce((s, n) => s + n, 0)
  const link = (i) => `/api/debts/${debt.id}/receipt?token=${encodeURIComponent(token)}${i !== undefined ? `&i=${i}` : ''}`

  return (
    <div style={{ marginTop: 4 }}>
      {hasLegacy ? (
        <a href={link()} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>📎 Чек</a>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {list.map((a, i) => (
              <a key={i} href={link(i)} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--brand)', background: 'var(--brand-light)', borderRadius: 6, padding: '2px 7px', textDecoration: 'none' }}>
                📎 {a.amount ? fmt(a.amount) : `Чек ${i + 1}`}
              </a>
            ))}
          </div>
          {total > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
              Итого по чекам: <b style={{ color: 'var(--text-2)' }}>{fmt(total)} {debt.currency || 'IDR'}</b>
              {recognized.length < list.length && ` · ${list.length - recognized.length} не распознано`}
            </div>
          )}
        </>
      )}
    </div>
  )
}
