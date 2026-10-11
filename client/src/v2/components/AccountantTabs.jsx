// AI Accountant section nav: Month close · Documents by transaction · Tax calendar · Tax profile.
import { Link } from 'react-router-dom'
import { useT } from '../i18n'

const TABS = [
  ['close', '/business/accountant'],
  ['packages', '/business/accountant?tab=packages'],
  ['taxes', '/business/accountant?tab=taxes'],
  ['profile', '/business/accountant/tax-profile'],
]

export default function AccountantTabs({ active }) {
  const t = useT()
  return (
    <nav className="v2-tabs" aria-label={t('acct.sections')}>
      {TABS.map(([k, to]) => (
        <Link key={k} to={to} className={`v2-tab-link${active === k ? ' is-on' : ''}`} aria-current={active === k ? 'page' : undefined}>{t(`acct.tab.${k}`)}</Link>
      ))}
    </nav>
  )
}
