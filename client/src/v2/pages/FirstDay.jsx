// First day (designs reg/R8) — /business/onboarding, where company setup lands.
// Each step is marked done from data that exists, never from a click:
//   profile   the tax profile is complete (GET /api/accountant/applicability → completeness)
//   accounts  wallets exist (GET /api/business/financial-counts)
//   statement a bank statement was imported (same counts)
//   debts     bills or invoices exist (same counts)
// The side card shows the nearest tax deadline from the tax calendar and an AI CFO question.
// Every link opens a v2 screen.
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { shortDate } from '../lib/format'
import { ruleTitle } from './Accountant'
import { useAsk } from '../ai/AskContext'

export default function FirstDay() {
  const t = useT()
  const lang = useLang()
  const { openAsk } = useAsk()
  const counts = useApi('/business/financial-counts')
  const appl = useApi('/accountant/applicability')
  const cal = useApi('/accountant/tax-calendar')
  if (counts.loading) return <><PageHead title={t('first.title')} /><Card><Skeleton rows={5} /></Card></>
  if (counts.error) return <><PageHead title={t('first.title')} /><ErrorBox error={counts.error} onRetry={counts.reload} /></>
  const c = counts.data?.counts || {}
  const pct = appl.data?.completeness?.percent ?? 0
  const steps = [
    { key: 'profile', done: pct >= 100, to: '/business/setup/taxes', doneTo: '/business/accountant/tax-profile' },
    { key: 'accounts', done: Number(c.wallets) > 0, to: '/business/accounts' },
    { key: 'statement', done: Number(c.bank_import_batches) > 0, to: '/business/bank-import' },
    { key: 'debts', done: Number(c.debts) > 0, to: '/business/payables' },
    { key: 'team', done: false, optional: true, to: '/business/settings' },
  ]
  const done = steps.filter((s) => s.done && !s.optional).length
  const events = cal.data?.events || []
  const today = new Date().toISOString().slice(0, 10)
  const overdue = events.find((e) => e.stage === 'overdue')
  const next = overdue || events.find((e) => String(e.due_date) >= today)
  return (
    <div className="v2-page">
      <PageHead title={done === 0 ? t('first.created') : t('first.title')} sub={t('first.sub')} />
      <div className="v2-grid-detail">
        <div className="v2-col">
          <section className="v2-hero v2-hero-plain">
            <div className="v2-hero-text">
              <h2 className="v2-hero-title">{t('first.head')}</h2>
              <p className="v2-hero-p v2-show">{t('first.p')}</p>
              <Pill tone={done === 4 ? 'good' : 'info'}>{t('first.progress', { n: done })}</Pill>
            </div>
          </section>
          <Card>
            <ol className="v2-steps">
              {steps.map((s, i) => (
                <li key={s.key} className={s.done ? 'is-done' : ''} data-first-step={s.key} data-done={s.done ? '1' : '0'}>
                  <span className="v2-step-n" aria-hidden="true">{s.done ? <I.check size={16} /> : i + 1}</span>
                  <span className="v2-check-text">
                    <strong>{t(`first.s.${s.key}`)}{s.done && <span className="v2-sr"> — {t('acct.done')}</span>}</strong>
                    <span className="v2-muted v2-small">{t(`first.s.${s.key}Hint`)}</span>
                  </span>
                  {s.done
                    ? (s.doneTo ? <Btn to={s.doneTo}>{t('first.open')}</Btn> : null)
                    : <Btn variant={i === steps.findIndex((x) => !x.done) ? 'primary' : 'secondary'} to={s.to}>{t(`first.s.${s.key}Cta`)}</Btn>}
                </li>
              ))}
            </ol>
          </Card>
          <p className="v2-muted v2-small"><Link to="/business/pulse">{t('first.skip')}</Link></p>
        </div>
        <aside className="v2-col">
          <Card title={t('first.nextDue')}>
            {cal.loading ? <Skeleton rows={2} /> : next ? (
              <>
                <p className="v2-dec-title">{ruleTitle(t, next)}{next.period ? ` · ${next.period}` : ''}</p>
                <p className={next.stage === 'overdue' ? 'v2-inline-err' : 'v2-sec'}>{next.stage === 'overdue' ? t('first.overdue', { d: shortDate(next.due_date, lang) }) : t('first.dueBy', { d: shortDate(next.due_date, lang) })}</p>
                {next.nil_return && <p className="v2-muted v2-small">{t('first.nil')}</p>}
                <Btn to="/business/setup/taxes">{t('first.how')}</Btn>
              </>
            ) : <p className="v2-muted">{t('acct.noEvents')}</p>}
          </Card>
          <Card title={t('first.askTitle')}>
            <p className="v2-sec">{t('first.askQ')}</p>
            <button type="button" className="v2-btn v2-btn-secondary" onClick={() => openAsk(t('first.askQ'))}>{t('first.ask')}</button>
          </Card>
        </aside>
      </div>
    </div>
  )
}
