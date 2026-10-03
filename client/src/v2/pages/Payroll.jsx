// Payroll (designs/Payroll.dc.html). GET /api/payroll/overview (people + recent payments
// with their gross / deduction / net lines) and GET /api/wallets. PPh 21 is shown only as
// RECORDED on the payment lines — this page never computes a tax (TER rates live in the
// verified rule engine, not in UI code). Adding people and running payroll stay on the
// existing page (Manage payroll).
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Btn, Skeleton, ErrorBox, Empty, Pill } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'
import { latestPayrollRun } from '../lib/obligations'
import { flowOf } from '../lib/pulseModel'

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export default function Payroll() {
  const t = useT()
  const lang = useLang()
  const ov = useApi('/payroll/overview')
  const wallets = useApi('/wallets')
  const ins = useApi(`/pulse/advanced-insights?from=${daysAgo(30)}&to=${daysAgo(0)}`)
  const head = (
    <PageHead title={t('nav.payroll')} sub={t('pay.sub')}
      actions={<><Btn to="/business/payroll/manage">{t('pay.addPerson')}</Btn><Btn variant="primary" to="/business/payroll/manage">{t('pay.manage')}</Btn></>} />
  )
  if (ov.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (ov.error) return <>{head}<ErrorBox error={ov.error?.status === 403 ? t('pay.forbidden') : ov.error} onRetry={ov.error?.status === 403 ? null : ov.reload} /></>

  const employees = ov.data?.employees || []
  const run = latestPayrollRun(ov.data)
  const flow = flowOf(ins.data?.metrics)
  if (!employees.length && !run) {
    return <>{head}<Card><Empty icon={<I.payroll size={28} />} title={t('pay.emptyTitle')} text={t('pay.emptyText')}
      action={<Btn variant="primary" to="/business/payroll/manage">{t('pay.addPerson')}</Btn>} /></Card></>
  }
  const lines = new Map((run?.people || []).map((p) => [String(p.employee_id || p.name), p]))
  const rows = employees.map((e) => ({ e, p: lines.get(String(e.id)) || lines.get(String(e.name)) || null }))
  for (const p of run?.people || []) if (!employees.some((e) => String(e.id) === String(p.employee_id) || e.name === p.name)) rows.push({ e: null, p })
  const payWallet = (wallets.data?.wallets || []).find((w) => employees.some((e) => String(e.default_wallet_id) === String(w.id)))
  const share = flow && flow.moneyIn > 0 && run ? Math.round(((run.gross) / flow.moneyIn) * 100) : null

  return (
    <div className="v2-page">
      {head}
      {run && (
        <Card>
          <div className="v2-pay-hero">
            <div className="v2-stat">
              <Pill tone={run.paid ? 'good' : 'info'}>{t(run.paid ? 'pay.paid' : 'pay.scheduled')} · {run.period}</Pill>
              <span className="v2-stat-label">{t('pay.toPeople', { d: run.date ? shortDate(run.date, lang) : run.period })}</span>
              <span className="v2-stat-big v2-num">{money(run.net)}</span>
              {payWallet && <span className="v2-stat-sub">{t('pay.walletHas', { w: payWallet.name, v: money(payWallet.balance) })}
                {' — '}{Number(payWallet.balance) >= run.net ? t('pay.enough') : <span className="v2-neg">{t('pay.notEnough')}</span>}</span>}
            </div>
            <div className="v2-pay-stats">
              <div className="v2-stat v2-stat-box"><span className="v2-stat-label">{t('pay.gross')}</span><span className="v2-stat-mid v2-num">{money(run.gross)}</span></div>
              <div className="v2-stat v2-stat-box"><span className="v2-stat-label">{t('pay.pph21')}</span><span className="v2-stat-mid v2-num">{run.tax == null ? '—' : money(run.tax)}</span>
                <span className="v2-stat-sub">{run.tax == null ? t('pay.taxNotRecorded') : t('pay.taxRecorded')}</span></div>
              <div className="v2-stat v2-stat-box"><span className="v2-stat-label">{t('pay.bpjs')}</span><span className="v2-stat-mid v2-num">{run.bpjs ? money(run.bpjs) : '—'}</span></div>
            </div>
          </div>
        </Card>
      )}
      <div className="v2-grid-detail">
        <Card title={t('pay.people', { n: employees.length })} className="v2-col">
          <div className="v2-paytable" role="table" aria-label={t('nav.payroll')}>
            <div className="v2-payrow v2-payrow-head" role="row">
              <span role="columnheader">{t('pay.col.person')}</span><span role="columnheader" className="v2-r">{t('pay.col.gross')}</span>
              <span role="columnheader" className="v2-r">PPh 21</span><span role="columnheader" className="v2-r">{t('pay.col.net')}</span>
            </div>
            {rows.map(({ e, p }, i) => (
              <div key={e?.id || p?.id || i} className="v2-payrow" role="row">
                <span role="cell" className="v2-dec-text"><span className="v2-dec-title">{e?.name || p?.name}</span><span className="v2-dec-meta">{e?.role || '—'}</span></span>
                <span role="cell" className="v2-num v2-r">{p ? money(p.gross) : e?.default_salary ? money(e.default_salary) : '—'}</span>
                <span role="cell" className="v2-num v2-r">{p && p.tax != null ? money(p.tax) : '—'}</span>
                <span role="cell" className="v2-num v2-r">{p ? money(p.net) : '—'}</span>
              </div>
            ))}
          </div>
          <p className="v2-muted v2-small">{t('pay.terNote')}</p>
        </Card>
        <aside className="v2-col">
          <Card title={t('pay.vsIn')}>
            <p className="v2-sec">{share != null ? t('pay.share', { v: money(run.gross), n: share }) : t('pay.shareNone')}</p>
          </Card>
          <Card title={t('pay.hiring')}>
            <p className="v2-sec">{t('pay.hiringText')}</p>
            <Link to="/business/ai-cfo">{t('pay.askCfo')}</Link>
          </Card>
        </aside>
      </div>
    </div>
  )
}
