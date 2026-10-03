// Phone "More" (designs/MobileMore.dc.html). The sidebar's groups as cards, a company
// card that opens the workspace list, and Settings at the bottom. Same nav model and
// badges as the desktop sidebar, so the two can never drift.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import I from '../icons'
import { NAV_GROUPS, SETTINGS_ITEM } from '../nav'
import { useT } from '../i18n'
import { initial } from '../lib/format'
import { useShellCounts, usePlatformAdmin, useSwitchWorkspace } from '../shell/V2Shell'

// Items reachable from the bottom tab bar are not repeated here.
const IN_TABS = new Set(['pulse', 'radar', 'cfo'])

function Badge({ kind, counts, t }) {
  const n = counts?.[kind]
  if (n == null || n <= 0) return null
  const tone = kind === 'late' ? 'crit' : kind === 'approvals' ? 'info' : 'warn'
  return <span className={`v2-navbadge v2-tone-${tone}`}>{kind === 'late' ? t('badge.late', { n }) : n}</span>
}

function Row({ it, counts, t, label }) {
  const Ic = I[it.icon]
  return (
    <Link className="v2-morerow" to={it.to}>
      <Ic size={20} />
      <span className="v2-morerow-label">{label || t(it.labelKey)}</span>
      {it.badge && <Badge kind={it.badge} counts={counts} t={t} />}
    </Link>
  )
}

export default function More() {
  const t = useT()
  const { workspaces, active } = useWorkspace()
  const select = useSwitchWorkspace()
  const counts = useShellCounts()
  const isAdmin = usePlatformAdmin()
  const [open, setOpen] = useState(false)
  const all = [...(workspaces?.business || []), ...(workspaces?.personal || [])]

  return (
    <div className="v2-more">
      <h1 className="v2-h1">{t('nav.more')}</h1>

      <div className="v2-card v2-more-ws">
        <button type="button" className="v2-more-wsbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="v2-ava v2-ava-lg">{initial(active?.name)}</span>
          <span className="v2-more-wstext">
            <span className="v2-more-wsname">{active?.name}</span>
            <span className="v2-muted">{t('shell.switchHint')}</span>
          </span>
          <I.chevRight size={18} className={open ? 'v2-rot90' : ''} />
        </button>
        {open && (
          <ul className="v2-more-wslist">
            {all.map((w) => (
              <li key={w.id}>
                <button type="button" className="v2-morerow" aria-current={String(w.id) === String(active?.id) ? 'true' : undefined}
                  onClick={() => { setOpen(false); if (String(w.id) !== String(active?.id)) select(w) }}>
                  <span className={`v2-ava${w.type === 'personal' ? ' v2-ava-personal' : ''}`}>{initial(w.name)}</span>
                  <span className="v2-morerow-label">{w.name}</span>
                  <span className="v2-muted">{w.type === 'personal' ? t('shell.personal') : t('shell.company')}</span>
                </button>
              </li>
            ))}
            <li>
              <Link className="v2-morerow" to="/business/new"><I.plus size={20} /><span className="v2-morerow-label">{t('shell.createCompany')}</span></Link>
            </li>
          </ul>
        )}
      </div>

      {NAV_GROUPS.map((g) => {
        const items = g.items.filter((it) => !IN_TABS.has(it.key))
        if (!items.length) return null
        return (
          <div key={g.key} className="v2-more-group">
            <p className="v2-navgroup-title">{t(g.labelKey)}</p>
            <div className="v2-card v2-more-list">
              {items.map((it) => <Row key={it.key} it={it} counts={counts} t={t} />)}
            </div>
          </div>
        )
      })}

      <div className="v2-card v2-more-list">
        <Row it={SETTINGS_ITEM} counts={counts} t={t} label={t('nav.settingsLong')} />
        {isAdmin && <Row it={{ key: 'admin', icon: 'admin', to: '/admin/dashboard', labelKey: 'nav.admin' }} counts={counts} t={t} />}
      </div>
    </div>
  )
}
