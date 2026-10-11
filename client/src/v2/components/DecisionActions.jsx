// Reject · Ask for details · Approve for one item waiting for approval.
// Uses the existing debt endpoints (lib/actions.js); the server checks the role and
// answers 403 for anyone who may only submit. Reject and Ask need a short text, typed
// inline — no browser prompt(). Approving never pays anything.
// The buttons follow the same rules (lib/decisions.js, role from GET /api/team): a role
// that may only submit sees a note instead, and Approve is off on your own submission
// unless you are the owner or CEO. While the role is loading the buttons stay off.
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useApi, useInvalidate } from '../data'
import { approveDebt, rejectDebt, requestDebtInfo, actionError } from '../lib/actions'
import { decisionRights } from '../lib/decisions'
import { useT } from '../i18n'
import I from '../icons'

export default function DecisionActions({ debt, onDone, size = 'md' }) {
  const t = useT()
  const { token, user } = useAuth()
  const team = useApi('/team')
  const rights = decisionRights({ role: team.data?.my_role, userId: user?.id, debt })
  const invalidate = useInvalidate()
  const [mode, setMode] = useState(null)       // null | 'reject' | 'ask'
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)

  const run = async (kind) => {
    setBusy(true); setErr(null)
    try {
      if (kind === 'approve') await approveDebt(token, debt.id)
      if (kind === 'reject') await rejectDebt(token, debt.id, text.trim())
      if (kind === 'ask') await requestDebtInfo(token, debt.id, text.trim())
      setDone(kind); setMode(null); setText('')
      invalidate()
      onDone?.(kind)
    } catch (e) {
      const code = actionError(e)
      setErr(code === 'forbidden' ? t('dec.forbidden') : code)
    } finally { setBusy(false) }
  }

  if (done) {
    return <p className="v2-dec-done" role="status"><I.check size={16} />{t(`dec.done.${done}`)}</p>
  }
  if (rights.known && !rights.canDecide) return <p className="v2-muted v2-small">{t('dec.forbidden')}</p>

  return (
    <div className={`v2-decide v2-decide-${size}`}>
      {mode ? (
        <form className="v2-decide-form" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) run(mode) }}>
          <label className="v2-field">
            <span className="v2-field-label">{t(mode === 'reject' ? 'dec.reasonLabel' : 'dec.askLabel')}</span>
            <input className="v2-input" value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={500}
              placeholder={t(mode === 'reject' ? 'dec.reasonPh' : 'dec.askPh')} />
          </label>
          <div className="v2-decide-row">
            <button type="button" className="v2-btn v2-btn-secondary" onClick={() => { setMode(null); setText('') }} disabled={busy}>{t('dec.cancel')}</button>
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || text.trim().length < 3}>
              {t(mode === 'reject' ? 'dec.confirmReject' : 'dec.send')}
            </button>
          </div>
        </form>
      ) : (
        <div className="v2-decide-row">
          <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setMode('reject')} disabled={busy || !rights.canDecide}>{t('dec.reject')}</button>
          <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setMode('ask')} disabled={busy || !rights.canDecide}>{t('dec.ask')}</button>
          <button type="button" className="v2-btn v2-btn-primary" onClick={() => run('approve')} disabled={busy || !rights.canApprove}
            title={rights.why === 'own' ? t('dec.ownItem') : undefined}><I.check size={16} />{t('dec.approve')}</button>
        </div>
      )}
      {rights.why === 'own' && !mode && <p className="v2-muted v2-small">{t('dec.ownItem')}</p>}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </div>
  )
}
