// Approvals v2 (designs/Approvals, MobileApprovals). "Nothing is paid without
// approval." Pending items are debts with approval_status = 'pending_approval'
// from GET /api/debts. The three actions call the EXISTING endpoints exactly as
// Payables.jsx does — PATCH /api/debts/:id/approve, PATCH …/reject {reason},
// POST …/request-info {note}. The server re-checks role and business on each.
// Approving never pays anything: an approved bill becomes something to pay.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { apiFetch } from '../../lib/api'
import { Page, Card, Btn, Pill, Tabs, Loading, ErrorBox, Empty, Num, Note, PromptDialog, Ico } from '../ui'
import { useV2T, LOCALE } from '../lib/i18n'
import { useV2Data, useV2Invalidate, PULSE_PATH } from '../lib/data'
import { isPending, recentlyDecided, asList } from '../lib/debts'
import { remainingOf } from '../lib/counts'
import { buildForecast, dayIndex } from '../lib/forecast'
import { canApprove } from '../lib/roles'
import { money, dayMonth } from '../lib/format'
import { P } from '../routes'

const channelKey = (d) => {
  const c = String(d.source_channel || d.created_via || d.last_action_channel || '').toLowerCase()
  if (c.includes('telegram')) return 'appr.fromTelegram'
  if (c.includes('mcp') || c.includes('ai') || c.includes('claude')) return 'appr.fromAi'
  if (c) return 'appr.fromWeb'
  return null
}

export default function Approvals() {
  const { t, lang } = useV2T()
  const locale = LOCALE[lang]
  const { token } = useAuth()
  const { active } = useWorkspace()
  const debtsQ = useV2Data('/debts')
  const pulse = useV2Data(PULSE_PATH, { silent: true })
  const invalidate = useV2Invalidate()
  const [tab, setTab] = useState('waiting')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [dialog, setDialog] = useState(null)   // { kind: 'reject'|'ask', debt }
  const [done, setDone] = useState(null)
  const mayApprove = canApprove(active?.role)

  const debts = asList(debtsQ.data)
  const waiting = debts.filter(isPending)
  const decided = recentlyDecided(debts, 8)
  const fc = useMemo(() => (pulse.data ? buildForecast(pulse.data) : null), [pulse.data])

  const refresh = () => { invalidate('/debts'); invalidate('/pulse'); debtsQ.reload() }
  const run = async (debt, kind, text) => {
    setBusy(debt.id); setErr(null)
    try {
      if (kind === 'approve') await apiFetch(`/debts/${debt.id}/approve`, token, { method: 'PATCH' })
      else if (kind === 'reject') await apiFetch(`/debts/${debt.id}/reject`, token, { method: 'PATCH', body: { reason: text || 'Rejected via Web App' } })
      else await apiFetch(`/debts/${debt.id}/request-info`, token, { method: 'POST', body: { note: text } })
      setDialog(null); setDone({ kind, name: debt.counterparty || '' }); refresh()
    } catch (e) { setErr(e.message || 'Request failed') } finally { setBusy(null) }
  }

  const head = { title: t('nav.approvals'), sub: t('appr.sub') }
  if (debtsQ.loading) return <Page {...head}><Card><Loading rows={5} /></Card></Page>
  if (debtsQ.error) return <Page {...head}><ErrorBox error={debtsQ.error} onRetry={debtsQ.reload} /></Page>

  return (
    <Page {...head}>
      <Tabs label={t('nav.approvals')} active={tab} onChange={setTab} items={[
        { key: 'waiting', label: t('appr.waiting', { n: waiting.length }) }, { key: 'decided', label: t('appr.decided') }]} />
      {done && <Note tone="info" icon="checkCircle">{t(`appr.done_${done.kind}`, { name: done.name })}</Note>}
      {!mayApprove && <Note tone="warning" icon="lock">{t('appr.cannotApprove')}</Note>}

      {tab === 'waiting' && (waiting.length === 0
        ? <Card><Empty icon="checkCircle" title={t('appr.empty')} body={t('appr.emptyBody')} /></Card>
        : waiting.map((d) => {
          const day = dayIndex(d.due_date)
          const after = fc && day !== null && day <= fc.horizon ? fc.cashAfter(Math.max(1, day)) : null
          const ch = channelKey(d)
          const detail = d.type === 'payable' ? P.billDetail(d.id) : P.invoiceDetail(d.id)
          return (
            <Card key={d.id} className="v2-apcard">
              <div className="v2-apcard-top">
                <span className="v2-tile-ic"><Ico name={d.type === 'payable' ? 'receipt' : 'checkCircle'} size={20} /></span>
                <div className="v2-row-main">
                  <div className="v2-apcard-kind">{t(d.type === 'payable' ? 'appr.billToPay' : 'appr.moneyIn')}{d.due_date ? ` · ${t('pulse.due', { date: dayMonth(d.due_date, locale) })}` : ''}</div>
                  <Link to={detail} className="v2-row-title v2-rowlink">{d.counterparty || '—'}</Link>
                  {d.description && <div className="v2-row-sub">{d.description}</div>}
                  <div className="v2-apcard-meta">
                    {ch && <Pill tone="neutral">{t(ch)}</Pill>}
                    {after !== null && d.type === 'payable' && <span>{t('appr.cashAfter', { v: money(after) })}</span>}
                  </div>
                </div>
                <Num className="v2-apcard-amt">{money(remainingOf(d))}</Num>
              </div>
              {mayApprove && <div className="v2-apcard-actions">
                <Btn onClick={() => { setErr(null); setDialog({ kind: 'reject', debt: d }) }} disabled={busy === d.id}>{t('appr.reject')}</Btn>
                <Btn onClick={() => { setErr(null); setDialog({ kind: 'ask', debt: d }) }} disabled={busy === d.id}>{t('appr.ask')}</Btn>
                <Btn variant="primary" onClick={() => run(d, 'approve')} disabled={busy === d.id}>{busy === d.id ? t('appr.working') : t('pulse.approve')}</Btn>
              </div>}
              {err && busy === null && dialog === null && <div className="v2-field-error" role="alert">{err}</div>}
            </Card>)
        }))}

      {tab === 'decided' && <Card title={t('appr.recentlyDecided')}>
        {decided.length === 0 ? <p className="v2-cardsub">{t('appr.noneDecided')}</p> : <div className="v2-rows">{decided.map((d) => (
          <div key={d.id} className="v2-row">
            <div className="v2-row-main"><div className="v2-row-title">{d.counterparty || '—'}{d.description ? <span className="is-muted"> · {d.description}</span> : null}</div>
              <div className="v2-row-sub">{t(d.approval_status === 'approved' ? 'appr.approvedOn' : 'appr.rejectedOn', { date: dayMonth(d.approved_at, locale) })}{d.rejected_reason ? ` · “${d.rejected_reason}”` : ''}</div></div>
            <Pill tone={d.approval_status === 'approved' ? 'good' : 'neutral'}>{t(d.approval_status === 'approved' ? 'appr.approved' : 'appr.rejected')}</Pill>
            <Num className="v2-row-amt">{money(d.original_amount || d.amount)}</Num>
          </div>))}</div>}
      </Card>}

      <Card title={t('appr.howTitle')}>
        <ul className="v2-bullets"><li>{t('appr.how1')}</li><li>{t('appr.how2')}</li></ul>
        <Btn variant="ghost" size="sm" to={P.team}>{t('appr.whoCan')}</Btn>
      </Card>

      <PromptDialog open={!!dialog} busy={!!busy} error={err} required={dialog?.kind === 'ask'}
        title={dialog ? t(dialog.kind === 'reject' ? 'appr.rejectTitle' : 'appr.askTitle', { name: dialog.debt.counterparty || '' }) : ''}
        label={t(dialog?.kind === 'reject' ? 'appr.reasonLabel' : 'appr.noteLabel')}
        confirmLabel={t(dialog?.kind === 'reject' ? 'appr.reject' : 'appr.send')} cancelLabel={t('common.cancel')}
        onCancel={() => setDialog(null)} onConfirm={(text) => run(dialog.debt, dialog.kind, text)} />
    </Page>
  )
}
