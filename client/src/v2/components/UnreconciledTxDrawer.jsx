// Unreconciled Bank Transaction Workbench Drawer
// Allows finance users to inspect, diagnose, and take action on unreconciled bank operations.
import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { Pill, Btn, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { money, shortDate } from '../lib/format'
import { determineUnreconciledReason } from '../lib/accounting'
import { updateTransaction } from '../lib/actions'
import { detailPath } from '../pages/Bills'

export default function UnreconciledTxDrawer({
  tx,
  month,
  wallets = [],
  batches = [],
  debts = [],
  docs = [],
  categories = [],
  canEdit = true,
  onClose,
  onSaved,
  onTxUpdated,
}) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const drawerRef = useRef(null)
  const lastFocus = useRef(null)

  // Reason diagnosis
  const wallet = useMemo(
    () => wallets.find((w) => String(w.id) === String(tx?.wallet_id)) || null,
    [wallets, tx?.wallet_id]
  )
  const reason = useMemo(
    () => determineUnreconciledReason({ tx, month, wallet, batches }),
    [tx, month, wallet, batches]
  )

  // Identify linked invoice / bill
  const linkedDebt = useMemo(() => {
    if (!tx) return null
    return (
      debts.find(
        (d) =>
          String(d.linked_transaction_id) === String(tx.id) ||
          String(d.id) === String(tx.debt_id) ||
          String(d.id) === String(tx.invoice_id)
      ) || null
    )
  }, [tx, debts])

  // Identify opening balance
  const isOpening = useMemo(() => {
    if (!tx) return false
    return (
      tx.source === 'wallet_opening_balance' ||
      tx.category === 'Opening balance' ||
      tx.type === 'opening'
    )
  }, [tx])

  // Attached documents
  const attachedDocs = useMemo(() => {
    if (!tx) return []
    return docs.filter((d) => {
      if (tx.document_id && String(d.id) === String(tx.document_id)) return true
      if (Array.isArray(d.links)) {
        return d.links.some(
          (l) => l.target_type === 'transaction' && String(l.target_id) === String(tx.id)
        )
      }
      return false
    })
  }, [tx, docs])

  // Edit state
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState({
    description: tx?.description || '',
    category: tx?.category || '',
    wallet_id: tx?.wallet_id ? String(tx.wallet_id) : '',
    date: tx?.date || tx?.transaction_date ? String(tx.date || tx.transaction_date).slice(0, 10) : '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [reasonExpanded, setReasonExpanded] = useState(false)

  // Synchronize draft when tx prop updates
  useEffect(() => {
    if (tx) {
      setDraft({
        description: tx.description || '',
        category: tx.category || '',
        wallet_id: tx.wallet_id ? String(tx.wallet_id) : '',
        date: tx.date || tx.transaction_date ? String(tx.date || tx.transaction_date).slice(0, 10) : '',
      })
      setSaveError(null)
      setSaveSuccess(false)
    }
  }, [tx])

  // Accessibility: trap focus and handle Escape
  useEffect(() => {
    lastFocus.current = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      lastFocus.current?.focus?.()
    }
  }, [onClose])

  if (!tx) return null

  const isIncome = tx.type === 'income' || tx.type === 'cash_in'
  const amount = Number(tx.amount_original || tx.amount || 0)
  const currency = tx.currency_original || tx.currency || 'IDR'

  // Source type label
  let sourceLabel = t('acct.drawer.sourceManual')
  if (isOpening) sourceLabel = t('acct.drawer.sourceOpening')
  else if (linkedDebt) sourceLabel = t('acct.drawer.sourceDebt')
  else if (tx.bank_import_batch_id || tx.bank_import_row_id || tx.source === 'bank')
    sourceLabel = t('acct.drawer.sourceBank')

  // Reason text and action
  let reasonBadgeText = t('acct.unlinked.badgeClarification')
  let reasonDetail = t('acct.reason.clarification')
  let reasonAction = null

  if (reason.code === 'no_statement') {
    reasonBadgeText = t('acct.unlinked.badgeNoStatement')
    reasonDetail = t('acct.reason.noStatement', {
      wallet: wallet?.name || t('acct.unlinked.unknownAccount'),
      month,
    })
    reasonAction = (
      <Link to="/business/bank-import" className="v2-btn v2-btn-sm v2-btn-primary" onClick={onClose}>
        {t('acct.unlinked.uploadStatement')}
      </Link>
    )
  } else if (reason.code === 'statement_unconfirmed') {
    reasonBadgeText = t('acct.unlinked.badgeUnconfirmed')
    reasonDetail = t('acct.reason.unconfirmed')
    reasonAction = (
      <Link to="/business/bank-import" className="v2-btn v2-btn-sm v2-btn-secondary" onClick={onClose}>
        {t('acct.unlinked.reviewStatement')}
      </Link>
    )
  } else if (reason.code === 'no_match') {
    reasonBadgeText = t('acct.unlinked.badgeNoMatch')
    reasonDetail = t('acct.reason.noMatch')
    reasonAction = (
      <Link to="/business/bank-import" className="v2-btn v2-btn-sm v2-btn-secondary" onClick={onClose}>
        {t('acct.unlinked.reviewStatement')}
      </Link>
    )
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const payload = {
        description: draft.description,
        category: draft.category || null,
      }
      if (draft.wallet_id && !isOpening && !linkedDebt) {
        payload.wallet_id = draft.wallet_id
      }
      if (draft.date && !isOpening) {
        payload.date = draft.date
      }

      const updated = await updateTransaction(token, tx.id, payload)
      setSaveSuccess(true)
      setIsEditing(false)
      onSaved?.(updated)
      onTxUpdated?.(updated)
    } catch (err) {
      setSaveError(err?.message || err?.data?.message || 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="v2-workbench-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={drawerRef}
        className="v2-workbench-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2-unreconciled-title"
      >
        <span className="v2-sheet-grip" aria-hidden="true" />
        <header className="v2-workbench-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, color: '#DC2626' }}>⚠️</span>
            <div>
              <strong id="v2-unreconciled-title" style={{ fontSize: 16 }}>
                {t('acct.drawer.title')}
              </strong>
              <div className="v2-muted v2-small">ID #{tx.id}</div>
            </div>
          </div>
          <button
            type="button"
            className="v2-iconbtn"
            onClick={onClose}
            aria-label={t('acct.modalClose')}
            style={{ width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <I.close size={20} />
          </button>
        </header>

        <div className="v2-workbench-body">
          {/* Amount Block */}
          <div
            style={{
              padding: '16px',
              background: 'var(--surface-page, #f8fafc)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Pill tone={isIncome ? 'good' : 'warn'}>
                  {isIncome ? t('tx.k.in') : t('tx.k.out')}
                </Pill>
                <Pill tone="neutral">{sourceLabel}</Pill>
              </div>
              <span className="v2-muted v2-small">{draft.date || tx.date}</span>
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: isIncome ? '#059669' : '#DC2626',
                letterSpacing: '-0.02em',
              }}
            >
              {isIncome ? '+' : '−'}
              {money(amount, currency)}
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4, color: 'var(--text-primary, #0f172a)' }}>
              {draft.description || tx.description || '—'}
            </div>
          </div>

          {/* Reason & Action Banner */}
          <div
            style={{
              padding: '14px',
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#DC2626', fontSize: 16 }}>⚠️</span>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#991B1B' }}>
                  {t('acct.drawer.reconStatus')}:
                </span>
                <span style={{ fontWeight: 600, color: '#DC2626' }}>{reasonBadgeText}</span>
              </div>
              <button
                type="button"
                className="v2-btn v2-btn-ghost v2-btn-sm"
                aria-expanded={reasonExpanded}
                aria-controls={`reason-details-${tx.id}`}
                onClick={() => setReasonExpanded((v) => !v)}
                style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}
              >
                {reasonExpanded ? '▲' : '▼'} {lang === 'ru' ? 'Пояснение' : lang === 'id' ? 'Penjelasan' : 'Explanation'}
              </button>
            </div>

            {reasonExpanded && (
              <div
                id={`reason-details-${tx.id}`}
                style={{
                  fontSize: 13,
                  color: '#7F1D1D',
                  lineHeight: 1.5,
                  paddingTop: 8,
                  borderTop: '1px dashed #FCA5A5',
                }}
              >
                {reasonDetail}
              </div>
            )}

            {reasonAction && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>{reasonAction}</div>
            )}
          </div>

          {/* Special Cases Notices */}
          {isOpening && (
            <div
              style={{
                padding: '12px',
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: 8,
                fontSize: 13,
                color: '#1E40AF',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div>ℹ️ {t('acct.drawer.openingNotice')}</div>
              <div>
                <Link
                  to="/business/accounts"
                  className="v2-btn v2-btn-sm v2-btn-secondary"
                  onClick={onClose}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {t('acct.drawer.manageAccount')}
                </Link>
              </div>
            </div>
          )}

          {linkedDebt && (
            <div
              style={{
                padding: '12px',
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: 8,
                fontSize: 13,
                color: '#166534',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div>
                ℹ️{' '}
                {t('acct.drawer.debtNotice', {
                  ref: linkedDebt.invoice_number || linkedDebt.counterparty || `#${linkedDebt.id}`,
                })}
              </div>
              <div>
                <Link
                  to={detailPath(linkedDebt)}
                  className="v2-btn v2-btn-sm v2-btn-secondary"
                  onClick={onClose}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {t('acct.drawer.openDebt')}
                </Link>
              </div>
            </div>
          )}

          {/* Attributes and Edit Form */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '16px',
              border: '1px solid var(--border-subtle, #e2e8f0)',
              borderRadius: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('acct.drawer.editFields')}</span>
              {canEdit && !isEditing && (
                <button
                  type="button"
                  className="v2-btn v2-btn-sm v2-btn-ghost"
                  onClick={() => setIsEditing(true)}
                  style={{ cursor: 'pointer' }}
                >
                  ✏️ {t('acct.drawer.edit')}
                </button>
              )}
            </div>

            {saveSuccess && (
              <div
                style={{
                  padding: '6px 10px',
                  background: '#ECFDF5',
                  color: '#065F46',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                ✓ {t('acct.drawer.saveSuccess')}
              </div>
            )}

            {saveError && (
              <div
                style={{
                  padding: '6px 10px',
                  background: '#FEF2F2',
                  color: '#991B1B',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                ⚠️ {t('acct.drawer.saveError', { msg: saveError })}
              </div>
            )}

            {!isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="v2-muted">{t('acct.drawer.date')}:</span>
                  <span style={{ fontWeight: 500 }}>{draft.date || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="v2-muted">{t('acct.drawer.account')}:</span>
                  <span style={{ fontWeight: 500 }}>{wallet?.name || t('acct.unlinked.unknownAccount')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="v2-muted">{t('acct.drawer.category')}:</span>
                  <span style={{ fontWeight: 500 }}>{draft.category || t('tx.col.noCat', '—')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="v2-muted">{t('acct.drawer.description')}:</span>
                  <span style={{ fontWeight: 500, textAlign: 'right', maxWidth: '65%' }}>
                    {draft.description || '—'}
                  </span>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Date */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span className="v2-muted">{t('acct.drawer.date')}</span>
                  <input
                    type="date"
                    className="v2-input"
                    value={draft.date}
                    disabled={saving || isOpening}
                    onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                    style={{ fontSize: 13, height: 34 }}
                  />
                </label>

                {/* Account */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span className="v2-muted">{t('acct.drawer.account')}</span>
                  <select
                    className="v2-select"
                    value={draft.wallet_id}
                    disabled={saving || isOpening || !!linkedDebt}
                    onChange={(e) => setDraft((d) => ({ ...d, wallet_id: e.target.value }))}
                    style={{ fontSize: 13, height: 34 }}
                  >
                    <option value="">{t('acct.unlinked.unknownAccount')}</option>
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.currency})
                      </option>
                    ))}
                  </select>
                </label>

                {/* Category */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span className="v2-muted">{t('acct.drawer.category')}</span>
                  <select
                    className="v2-select"
                    value={draft.category}
                    disabled={saving}
                    onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                    style={{ fontSize: 13, height: 34 }}
                  >
                    <option value="">{t('tx.chooseCategory')}</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Description */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span className="v2-muted">{t('acct.drawer.description')}</span>
                  <input
                    type="text"
                    className="v2-input"
                    value={draft.description}
                    disabled={saving}
                    maxLength={500}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    style={{ fontSize: 13, height: 34 }}
                  />
                </label>

                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#B45309' }}>
                  ℹ️ {t('acct.drawer.unreconciledNotice')}
                </p>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    type="button"
                    className="v2-btn v2-btn-ghost v2-btn-sm"
                    disabled={saving}
                    onClick={() => {
                      setIsEditing(false)
                      setSaveError(null)
                    }}
                  >
                    {t('acct.drawer.cancel')}
                  </button>
                  <button type="submit" className="v2-btn v2-btn-primary v2-btn-sm" disabled={saving}>
                    {saving ? t('acct.drawer.saving') : t('acct.drawer.save')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Attached Documents */}
          <div
            style={{
              padding: '14px',
              border: '1px solid var(--border-subtle, #e2e8f0)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{t('acct.drawer.docsTitle')}</span>
              <Link to="/business/documents" className="v2-btn v2-btn-sm v2-btn-ghost" onClick={onClose}>
                📎 {t('acct.drawer.attachDoc')}
              </Link>
            </div>
            {attachedDocs.length === 0 ? (
              <span className="v2-muted v2-small">{t('acct.drawer.noDocs')}</span>
            ) : (
              <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13 }}>
                {attachedDocs.map((doc) => (
                  <li key={doc.id}>
                    <span style={{ fontWeight: 500 }}>{doc.file_name || `Doc #${doc.id}`}</span>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #64748b)' }}>
              {t('acct.drawer.docWarning')}
            </p>
          </div>
        </div>

        <footer className="v2-workbench-foot">
          <button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>
            {t('acct.drawer.cancel')}
          </button>
        </footer>
      </aside>
    </>
  )
}
