// Bills & invoices (designs/Bills.dc.html, MobileBills.dc.html). One page, three
// routes: /business/payables (To pay), /business/receivables (To collect),
// /business/invoices (All). Data: GET /api/debts and GET /api/wallets.
//
// Writes reuse the existing components unchanged: DebtFormModal (Add a bill / New
// invoice, business scope locked) and DebtPaymentModal (Mark paid / Mark received).
// The previous pages stay one click away under "Classic view".
import { useMemo, useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import DebtPaymentModal from '../../components/DebtPaymentModal'
import BillDialog from '../components/BillDialog'
import I from '../icons'
import { PageHead, Card, Pill, Btn, NotYet, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { money, shortDate, daysUntil } from '../lib/format'
import { billStatus, billSummary, billRows, tabForPath, remaining } from '../lib/obligations'

const TONE = { pending: 'info', late: 'crit', partial: 'warn', open: 'neutral', paid: 'good', cancelled: 'neutral' }
// Each tab is its own route, so a reload or a shared link keeps the tab.
const TAB_PATH = { pay: '/business/payables', collect: '/business/receivables', all: '/business/invoices' }
const clean = (v) => (v == null || ['null', 'undefined'].includes(String(v).trim()) ? '' : String(v))

export function detailPath(d) {
  return `/business/${d.type === 'receivable' ? 'receivables' : 'payables'}/${encodeURIComponent(d.id)}`
}

export function StatusPill({ d }) {
  const t = useT()
  const s = billStatus(d)
  const text = s === 'late' ? t('bills.status.lateN', { n: Number(d.days_overdue) || Math.max(0, -daysUntil(d.due_date)) }) : t(`bills.status.${s}`)
  return <Pill tone={TONE[s]}>{text}</Pill>
}

function Row({ d, onPay, t, lang }) {
  const s = billStatus(d)
  const receivable = d.type === 'receivable'
  let action
  if (s === 'pending') action = <Btn to={detailPath(d)}>{t('bills.review')}</Btn>
  // A late invoice can still be marked received (existing POST /api/debts/:id/pay through
  // DebtPaymentModal); sending a reminder is not built yet and stays "Coming soon".
  else if (s === 'late' && receivable) action = <span className="v2-btnpair"><Btn onClick={() => onPay(d)}>{t('bills.markReceived')}</Btn><NotYet note={t('bills.reminderSoon')}>{t('bills.sendReminder')}</NotYet></span>
  else if (s === 'open' || s === 'partial' || s === 'late') action = <Btn onClick={() => onPay(d)}>{t(receivable ? 'bills.markReceived' : 'bills.markPaid')}</Btn>
  else action = <Btn to={detailPath(d)}>{t('bills.open')}</Btn>
  return (
    <div className="v2-brow" role="row">
      <span role="cell" className="v2-brow-who">
        <Link to={detailPath(d)} className="v2-brow-name">{clean(d.counterparty) || t('bills.noName')}</Link>
        <span className="v2-brow-note">{[clean(d.description), d.source_channel === 'mcp' ? t('bills.byAi') : null].filter(Boolean).join(' · ')}</span>
      </span>
      <span role="cell" className="v2-brow-due v2-num">{d.due_date ? shortDate(d.due_date, lang) : '—'}</span>
      <span role="cell" className="v2-brow-status"><StatusPill d={d} /></span>
      <span role="cell" className="v2-brow-amt v2-num v2-r">{money(remaining(d), { currency: d.currency || 'IDR' })}</span>
      <span role="cell" className="v2-brow-act">{action}</span>
    </div>
  )
}

function Section({ title, rows, onPay, t, lang, who }) {
  return (
    <div className="v2-bsec">
      <h2 className="v2-h3">{title}</h2>
      {rows.length === 0 ? <p className="v2-muted">{t('bills.none')}</p> : (
        <div className="v2-btable" role="table" aria-label={title}>
          <div className="v2-brow v2-brow-head" role="row">
            <span role="columnheader">{who}</span><span role="columnheader">{t('bills.col.due')}</span>
            <span role="columnheader">{t('bills.col.status')}</span><span role="columnheader" className="v2-r">{t('bills.col.amount')}</span>
            <span role="columnheader"><span className="v2-sr">{t('bills.col.action')}</span></span>
          </div>
          {rows.map((d) => <Row key={d.id} d={d} onPay={onPay} t={t} lang={lang} />)}
        </div>
      )}
    </div>
  )
}

export default function Bills() {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const loc = useLocation()
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const [tab, setTabState] = useState(() => tabForPath(loc.pathname))
  useEffect(() => { setTabState(tabForPath(loc.pathname)) }, [loc.pathname])
  const setTab = (k) => {
    setTabState(k)
    if (TAB_PATH[k] && loc.pathname !== TAB_PATH[k]) navigate(`${TAB_PATH[k]}${loc.search}`)
  }
  const [view, setView] = useState('open')
  const [create, setCreate] = useState(null)   // 'payable' | 'receivable'
  const [pay, setPay] = useState(null)
  const [editDebt, setEditDebt] = useState(null)
  const debts = useApi('/debts')
  const wallets = useApi('/wallets')
  // GET /api/wallets returns only this company's wallets (by business_id). A wallet labelled
  // 'personal' is still company-held (_specs/accounts-personal-scope-ambiguity.md), so it is
  // not dropped; DebtPaymentModal lists it with its name.
  const bizWallets = (wallets.data?.wallets || []).filter((x) => x.is_active !== false)

  const list = Array.isArray(debts.data) ? debts.data : []
  const sum = useMemo(() => billSummary(list), [list])

  // Handle ?edit=<id> query parameter (e.g. from Radar "Set date")
  useEffect(() => {
    const editId = new URLSearchParams(loc.search).get('edit')
    if (editId && list.length > 0) {
      const target = list.find(d => String(d.id) === String(editId))
      if (target) {
        setEditDebt(target)
      }
    }
  }, [loc.search, list])

  const clearEditParam = () => {
    const params = new URLSearchParams(loc.search)
    if (params.has('edit')) {
      params.delete('edit')
      const newSearch = params.toString() ? `?${params.toString()}` : ''
      navigate(`${loc.pathname}${newSearch}`, { replace: true })
    }
    setEditDebt(null)
  }

  const head = (
    <PageHead title={t('nav.bills')} sub={t('bills.sub')}
      actions={<>
        <Btn icon={<I.plus size={16} />} onClick={() => setCreate('payable')}>{t('bills.addBill')}</Btn>
        <Btn variant="primary" icon={<I.plus size={16} />} onClick={() => setCreate('receivable')}>{t('bills.newInvoice')}</Btn>
      </>} />
  )
  const modals = (
    <>
      {create && <BillDialog mode={create} onClose={() => setCreate(null)} onSaved={invalidate} />}
      {pay && <DebtPaymentModal debt={pay} accounts={bizWallets} token={token}
        onClose={() => setPay(null)} onSuccess={() => { setPay(null); invalidate() }} />}
      {editDebt && <BillDialog debt={editDebt} onClose={clearEditParam} onSaved={invalidate} />}
    </>
  )
  if (debts.loading) return <>{head}<Card><Skeleton rows={6} /></Card>{modals}</>
  if (debts.error) return <>{head}<ErrorBox error={debts.error} onRetry={debts.reload} />{modals}</>

  const collect = billRows(list, { tab: 'collect', view })
  const payRows = billRows(list, { tab: 'pay', view })

  return (
    <div className="v2-page">
      {head}
      <div className="v2-twocards">
        <button type="button" className={`v2-card v2-sumcard${tab === 'collect' ? ' is-on' : ''}`} onClick={() => setTab('collect')}>
          <span className="v2-stat-label">{t('bills.owedToYou', { n: sum.collect.count })}</span>
          <span className="v2-stat-mid v2-num">{money(sum.collect.total)}</span>
          <span className="v2-stat-sub">
            {sum.collect.late > 0 && <span className="v2-neg">{t('bills.lateAmt', { v: money(sum.collect.late) })}</span>}
            {sum.collect.late > 0 && ' · '}{t('bills.dueSoon', { v: money(sum.collect.dueSoon) })}
          </span>
        </button>
        <button type="button" className={`v2-card v2-sumcard${tab === 'pay' ? ' is-on' : ''}`} onClick={() => setTab('pay')}>
          <span className="v2-stat-label">{t('bills.youOwe', { n: sum.pay.count })}</span>
          <span className="v2-stat-mid v2-num">{money(sum.pay.total)}</span>
          <span className="v2-stat-sub">
            {sum.pay.pending > 0 && <span className="v2-info">{t('bills.pendingAmt', { v: money(sum.pay.pending) })} · </span>}
            {sum.pay.lateCount > 0 ? <span className="v2-neg">{t('bills.overdueN', { n: sum.pay.lateCount })}</span> : t('bills.nothingOverdue')}
            {' · '}{t('bills.payrollElsewhere')}
          </span>
        </button>
      </div>

      <Card>
        <div className="v2-card-head v2-wrap">
          <div className="v2-seg" role="tablist" aria-label={t('bills.tabs')}>
            {['pay', 'collect', 'all'].map((k) => (
              <button key={k} type="button" role="tab" className="v2-seg-btn" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{t(`bills.tab.${k}`)}</button>
            ))}
          </div>
          <div className="v2-seg" role="group" aria-label={t('bills.viewLabel')}>
            {['open', 'paid'].map((k) => (
              <button key={k} type="button" className="v2-seg-btn" aria-pressed={view === k} onClick={() => setView(k)}>{t(`bills.view.${k}`)}</button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <Empty icon={<I.bills size={28} />} title={t('bills.emptyTitle')} text={t('bills.emptyText')}
            action={<Btn variant="primary" onClick={() => setCreate('payable')}>{t('bills.addBill')}</Btn>} />
        ) : (
          <>
            {(tab === 'collect' || tab === 'all') && <Section title={t('bills.toCollect')} rows={collect} onPay={setPay} t={t} lang={lang} who={t('bills.col.customer')} />}
            {(tab === 'pay' || tab === 'all') && <Section title={t('bills.toPay')} rows={payRows} onPay={setPay} t={t} lang={lang} who={t('bills.col.supplier')} />}
          </>
        )}
      </Card>
      {modals}
    </div>
  )
}
