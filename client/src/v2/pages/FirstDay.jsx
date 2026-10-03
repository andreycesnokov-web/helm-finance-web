// First day (designs/FirstDay.dc.html) — /business/onboarding.
// Four steps to the first real answer, each marked done from data that exists:
//   profile   tax profile completeness (GET /api/accountant/applicability — /profile does not return it)
//   accounts  wallets exist (GET /api/business/financial-counts)
//   statement a bank statement was imported (same counts)
//   debts     bills or invoices exist (same counts)
// The existing guided onboarding stays at /business/onboarding/classic.
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton } from '../ui'
import { useT } from '../i18n'
import { useApi } from '../data'

export default function FirstDay() {
  const t = useT()
  const counts = useApi('/business/financial-counts')
  const appl = useApi('/accountant/applicability')
  if (counts.loading) return <><PageHead title={t('first.title')} /><Card><Skeleton rows={5} /></Card></>
  const c = counts.data?.counts || {}
  const pct = appl.data?.completeness?.percent ?? 0
  const steps = [
    { key: 'profile', done: pct >= 100, to: '/business/accountant/tax-profile' },
    { key: 'accounts', done: Number(c.wallets) > 0, to: '/business/accounts/manage' },
    { key: 'statement', done: Number(c.bank_import_batches) > 0, to: '/business/bank-import' },
    { key: 'debts', done: Number(c.debts) > 0, to: '/business/payables' },
    { key: 'team', done: false, optional: true, to: '/business/team' },
  ]
  const done = steps.filter((s) => s.done && !s.optional).length
  return (
    <div className="v2-page">
      <PageHead title={t('first.title')} sub={t('first.sub')} actions={<Btn to="/business/onboarding/classic">{t('first.guided')}</Btn>} />
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
            <li key={s.key} className={s.done ? 'is-done' : ''}>
              <span className="v2-step-n" aria-hidden="true">{s.done ? <I.check size={16} /> : i + 1}</span>
              <span className="v2-check-text">
                <strong>{t(`first.s.${s.key}`)}{s.done && <span className="v2-sr"> — {t('acct.done')}</span>}</strong>
                <span className="v2-muted v2-small">{t(`first.s.${s.key}Hint`)}</span>
              </span>
              {!s.done && <Btn variant={i === steps.findIndex((x) => !x.done) ? 'primary' : 'secondary'} to={s.to}>{t(`first.s.${s.key}Cta`)}</Btn>}
            </li>
          ))}
        </ol>
      </Card>
      <p className="v2-muted v2-small"><Link to="/business/pulse">{t('first.skip')}</Link></p>
    </div>
  )
}
