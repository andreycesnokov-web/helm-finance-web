// Phone "More" (designs/MobileMore): workspace switch, every nav group, settings.
import { Link } from 'react-router-dom'
import { NAV_GROUPS, P } from '../routes'
import { useV2T } from '../lib/i18n'
import { Page, Ico, Count } from '../ui'
import { WorkspaceMenu, useShellCounts } from '../shell/V2Shell'

// The phone tab bar already carries these; More lists the rest.
const ON_TAB_BAR = new Set(['pulse', 'radar', 'cfo'])

export default function More() {
  const { t } = useV2T()
  const counts = useShellCounts()
  const badge = (it) => {
    const n = it.badge ? counts[it.badge] : 0
    if (!n) return null
    if (it.badge === 'lateBills') return <Count tone="danger">{t('nav.late', { n })}</Count>
    return <Count tone={it.badge === 'approvals' ? 'info' : 'warning'}>{n}</Count>
  }
  return (
    <Page title={t('more.title')}>
      <div className="v2-more">
        <WorkspaceMenu variant="more" />
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter((it) => !ON_TAB_BAR.has(it.key))
          if (!items.length) return null
          return (
            <section key={g.key} className="v2-more-group">
              <h2 className="v2-more-title">{t(g.labelKey)}</h2>
              <div className="v2-more-list">
                {items.map((it) => (
                  <Link key={it.key} to={it.to} className="v2-more-row">
                    <Ico name={it.icon} /><span className="v2-more-label">{t(it.labelKey)}</span>{badge(it)}
                  </Link>
                ))}
              </div>
            </section>
          )
        })}
        <div className="v2-more-list">
          <Link to={P.settings} className="v2-more-row">
            <Ico name="cog" /><span className="v2-more-label">{t('nav.settingsLong')}</span>
          </Link>
        </div>
      </div>
    </Page>
  )
}
