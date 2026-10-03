// Funding (designs/Funding.dc.html) — equity and loans the business raised. Never revenue.
// Register: GET /api/business-funding (P-03, migration 064). Writes (owner/ceo/admin/cfo,
// audited): POST /api/business-funding (a record and, for a loan, its repayment schedule),
// POST /api/business-funding/repayments/:rid/paid. Loan interest is the only part that
// reaches profit (Performance → interest, below EBITDA); repayments land on Radar.
// A founder loan is recorded here business-side only: the Personal↔Business bridge
// (/api/funding) is NOT called. Before 064 the page says so and shows what the classifier
// already marks as funding.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { PageHead, Card, Pill, Btn, NotYet, Empty, Skeleton } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { createFunding, markRepaymentPaid, actionError } from '../lib/actions'
import { money, shortDate } from '../lib/format'

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const SOURCES = ['founder', 'investor', 'bank', 'other_lender']
const EMPTY = { source_kind: 'founder', instrument: 'loan', lender_name: '', counterparty_id: '', amount: '', received_on: daysAgo(0), interest_rate_annual: '', due_on: '', terms_text: '' }

function RecordForm({ onDone, t }) {
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const cps = useApi('/counterparties')
  const [f, setF] = useState(EMPTY)
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const loan = f.instrument === 'loan'
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      await createFunding(token, { ...f, counterparty_id: f.counterparty_id || null,
        interest_rate_annual: loan ? f.interest_rate_annual : null, due_on: loan ? f.due_on : null,
        schedule: loan && rows.length ? rows : undefined })
      invalidate(); onDone()
    } catch (x) {
      const code = actionError(x)
      setErr(code === 'forbidden' ? t('fund.forbidden') : code === 'notApplied' ? t('fund.notApplied') : x?.data?.error ? t('fund.invalid', { what: x.data.error }) : code)
    } finally { setBusy(false) }
  }
  return (
    <Card title={t('fund.record')}>
      <form onSubmit={save}>
        <div className="v2-field">
          <span className="v2-field-label" id="f-inst">{t('fund.instrument')}</span>
          <div className="v2-seg" role="radiogroup" aria-labelledby="f-inst">
            {['loan', 'equity'].map((k) => <button key={k} type="button" role="radio" aria-checked={f.instrument === k} aria-pressed={f.instrument === k} className="v2-seg-btn" onClick={() => setF((x) => ({ ...x, instrument: k }))}>{t(`fund.inst.${k}`)}</button>)}
          </div>
        </div>
        <div className="v2-field-row">
          <label className="v2-field"><span className="v2-field-label">{t('fund.from')}</span>
            <select className="v2-select" value={f.source_kind} onChange={set('source_kind')}>{SOURCES.map((k) => <option key={k} value={k}>{t(`fund.src.${k}`)}</option>)}</select></label>
          <label className="v2-field"><span className="v2-field-label">{t('fund.lender')}</span>
            <input className="v2-input" value={f.lender_name} onChange={set('lender_name')} maxLength={200} /></label>
          <label className="v2-field"><span className="v2-field-label">{t('fund.orCounterparty')}</span>
            <select className="v2-select" value={f.counterparty_id} onChange={set('counterparty_id')}><option value="">—</option>
              {(cps.data?.counterparties || []).map((c) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}</select></label>
        </div>
        <div className="v2-field-row">
          <label className="v2-field"><span className="v2-field-label">{t('fund.amount')}</span>
            <input className="v2-input" type="number" inputMode="decimal" min="0.01" step="0.01" required value={f.amount} onChange={set('amount')} /></label>
          <label className="v2-field"><span className="v2-field-label">{t('fund.receivedOn')}</span>
            <input className="v2-input" type="date" required value={f.received_on} onChange={set('received_on')} /></label>
        </div>
        {loan && (
          <div className="v2-field-row">
            <label className="v2-field"><span className="v2-field-label">{t('fund.rate')}</span>
              <input className="v2-input" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={f.interest_rate_annual} onChange={set('interest_rate_annual')} />
              <span className="v2-muted v2-small">{t('fund.rateHint')}</span></label>
            <label className="v2-field"><span className="v2-field-label">{t('fund.dueOn')}</span>
              <input className="v2-input" type="date" value={f.due_on} onChange={set('due_on')} /></label>
          </div>
        )}
        <label className="v2-field"><span className="v2-field-label">{t('fund.terms')}</span>
          <input className="v2-input" value={f.terms_text} onChange={set('terms_text')} maxLength={2000} /></label>
        {loan && (
          <fieldset className="v2-fieldset">
            <legend className="v2-field-label">{t('fund.schedule')}</legend>
            {rows.map((r, i) => (
              <div key={i} className="v2-field-row">
                <label className="v2-field"><span className="v2-sr">{t('fund.dueOn')}</span><input className="v2-input" type="date" value={r.due_on} onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, due_on: e.target.value } : x)))} /></label>
                <label className="v2-field"><span className="v2-sr">{t('fund.principal')}</span><input className="v2-input" type="number" min="0" step="0.01" placeholder={t('fund.principal')} value={r.principal} onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, principal: e.target.value } : x)))} /></label>
                <label className="v2-field"><span className="v2-sr">{t('fund.interest')}</span><input className="v2-input" type="number" min="0" step="0.01" placeholder={t('fund.interest')} value={r.interest} onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, interest: e.target.value } : x)))} /></label>
              </div>
            ))}
            <Btn onClick={() => setRows((xs) => [...xs, { due_on: '', principal: '', interest: '' }])}>{t('fund.addRepayment')}</Btn>
            <p className="v2-muted v2-small">{t('fund.scheduleHint')}</p>
          </fieldset>
        )}
        <p className="v2-muted v2-small">{t('fund.never')}</p>
        <div className="v2-decide-row">
          <button type="button" className="v2-btn v2-btn-secondary" onClick={onDone} disabled={busy}>{t('dec.cancel')}</button>
          <button type="submit" className="v2-btn v2-btn-primary" disabled={busy}>{t('fund.save')}</button>
        </div>
        {err && <p className="v2-inline-err" role="alert">{err}</p>}
      </form>
    </Card>
  )
}

export default function Funding() {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const reg = useApi('/business-funding')
  const ins = useApi(`/pulse/advanced-insights?scope=business&from=${daysAgo(365)}&to=${daysAgo(0)}`)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState(null)
  const seen = ins.data?.metrics?.other_cash_movement?.funding
  const available = reg.data?.available === true
  const canEdit = reg.data?.can_edit === true
  const tot = reg.data?.totals
  const paid = async (r) => {
    setErr(null)
    try { await markRepaymentPaid(token, r.id, { paid_on: daysAgo(0) }); invalidate() } catch (x) { setErr(actionError(x) === 'forbidden' ? t('fund.forbidden') : actionError(x)) }
  }
  const head = <PageHead title={t('nav.funding')} sub={t('fund.sub')}
    actions={available ? (canEdit && <Btn variant="primary" icon={<I.plus size={16} />} onClick={() => setAdding(true)}>{t('fund.record')}</Btn>) : <NotYet note={t('fund.notApplied')}>{t('fund.record')}</NotYet>} />
  if (reg.loading) return <div className="v2-page">{head}<Card><Skeleton rows={6} /></Card></div>
  const records = reg.data?.records || []
  return (
    <div className="v2-page">
      {head}
      <div className="v2-tiles v2-tiles-3">
        <div className="v2-tile"><span className="v2-tile-label">{t('fund.raised')}</span>
          {available ? <><span className="v2-tile-val v2-num">{money(Number(tot.raised_equity) + Number(tot.raised_loans))}</span><span className="v2-tile-sub">{t('fund.raisedSplit', { e: money(tot.raised_equity), l: money(tot.raised_loans) })}</span></>
            : <><span className="v2-tile-val v2-muted">—</span><span className="v2-tile-sub">{t('placeholder.notSetUp')}</span></>}</div>
        <div className="v2-tile"><span className="v2-tile-label">{t('fund.toRepay')}</span>
          {available ? <><span className="v2-tile-val v2-num">{money(tot.loans_outstanding)}</span>
            <span className="v2-tile-sub">{tot.next_repayment ? t('fund.nextOn', { v: money(tot.next_repayment.amount), d: shortDate(tot.next_repayment.due_on, lang) }) : t('fund.noNext')}</span></>
            : <><span className="v2-tile-val v2-muted">—</span><span className="v2-tile-sub">{t('placeholder.notSetUp')}</span></>}</div>
        <div className="v2-tile"><span className="v2-tile-label">{t('fund.seen')}</span><span className="v2-tile-val v2-num">{seen == null ? '—' : money(seen)}</span><span className="v2-tile-sub">{t('fund.seenSub')}</span></div>
      </div>
      {adding && <RecordForm t={t} onDone={() => setAdding(false)} />}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
      <div className="v2-grid-detail">
        <Card className="v2-col" title={available ? t('fund.registerTitle', { n: records.length }) : null}>
          {!available ? <Empty icon={<I.funding size={28} />} title={t('fund.notAppliedTitle')} text={t('fund.notApplied')} action={<Link to="/business/transactions">{t('fund.seeTx')}</Link>} />
            : records.length === 0 ? <Empty icon={<I.funding size={28} />} title={t('fund.emptyTitle')} text={t('fund.emptyText')}
              action={canEdit ? <Btn variant="primary" onClick={() => setAdding(true)}>{t('fund.record')}</Btn> : null} />
            : (
              <ul className="v2-grouplist">
                {records.map((r) => (
                  <li key={r.id} className="v2-grouprow">
                    <span className="v2-group-name">
                      <strong>{r.lender_name || t(`fund.src.${r.source_kind}`)}</strong>
                      <span className="v2-muted v2-small">{t(`fund.inst.${r.instrument}`)} · {t(`fund.src.${r.source_kind}`)} · {shortDate(r.received_on, lang)}
                        {r.interest_rate_annual != null && ` · ${t('fund.rateN', { n: r.interest_rate_annual })}`}{r.due_on && ` · ${t('fund.dueBy', { d: shortDate(r.due_on, lang) })}`}</span>
                      {r.next_repayment && <span className="v2-small">{t('fund.nextOn', { v: money(Number(r.next_repayment.principal) + Number(r.next_repayment.interest)), d: shortDate(r.next_repayment.due_on, lang) })}
                        {canEdit && <> · <button type="button" className="v2-linkbtn" onClick={() => paid(r.next_repayment)}>{t('fund.markPaid')}</button></>}</span>}
                    </span>
                    <span className="v2-r"><span className="v2-num"><strong>{money(r.amount)}</strong></span>
                      {r.instrument === 'loan' && <span className="v2-muted v2-small v2-num"> {t('fund.outstanding', { v: money(r.outstanding) })}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <aside className="v2-col">
          <Card title={t('fund.howTitle')}><p className="v2-sec">{t('fund.how')}</p></Card>
          <Card title={t('fund.founderTitle')}><p className="v2-sec">{t('fund.founder')}</p></Card>
          <Card title={t('fund.intercoTitle')}><p className="v2-sec">{t('fund.interco')}</p><Link to="/business/intercompany">{t('fund.intercoLink')}</Link></Card>
        </aside>
      </div>
      {reg.data?.upcoming?.length > 0 && (
        <Card title={t('fund.upcomingTitle')} aside={<Link to="/business/radar">{t('nav.radar')}</Link>}>
          <ul className="v2-moves">{reg.data.upcoming.slice(0, 8).map((u) => (
            <li key={u.id}><span>{shortDate(u.due_on, lang)} · {u.lender || t('fund.loan')}{u.overdue && <> · <Pill tone="crit">{t('radar.tag.late')}</Pill></>}</span>
              <span className="v2-num">{money(u.amount)} <span className="v2-muted v2-small">{t('fund.split', { p: money(u.principal), i: money(u.interest) })}</span></span></li>
          ))}</ul>
        </Card>
      )}
    </div>
  )
}
