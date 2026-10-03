// Settings (designs/Settings.dc.html). An overview of the rules every screen follows,
// with each change made where it is made today: the existing Settings page (Classic),
// Team, the Company profile and Bank import. Targets & alerts are edited here (P-01, P-08,
// components/TargetsCard.jsx). Reads: GET /api/team, GET /api/accountant/profile,
// GET /api/access/status (plan). Telegram linking is NOT touched here.
import { Link } from 'react-router-dom'
import { useAccess } from '../../hooks/useAccess'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import I from '../icons'
import { PageHead, Card, Pill, Btn } from '../ui'
import { useT } from '../i18n'
import { useApi } from '../data'
import { initial } from '../lib/format'
import TargetsCard from '../components/TargetsCard'

const SECTIONS = ['targets', 'company', 'team', 'connections', 'plan']

export default function Settings() {
  const t = useT()
  const { active } = useWorkspace()
  const { planLabel } = useAccess()
  const team = useApi('/team')
  const prof = useApi('/accountant/profile')
  const members = team.data?.members || []
  const pct = prof.data?.completeness?.percent
  return (
    <div className="v2-page">
      <PageHead title={t('nav.settings')} sub={t('set.sub', { name: active?.name || '' })} actions={<Btn to="/business/settings/classic">{t('set.allSettings')}</Btn>} />
      <nav className="v2-tabs" aria-label={t('set.sections')}>
        {SECTIONS.map((s) => <a key={s} className="v2-tab-link" href={`#set-${s}`}>{t(`set.s.${s}`)}</a>)}
      </nav>

      <TargetsCard />

      <Card id="set-company" title={t('set.s.company')}>
        <p className="v2-sec">{pct != null ? t('prof.pct', { n: pct }) : t('prof.unknownPct')}</p>
        <Btn to="/business/accountant/tax-profile">{t('set.openProfile')}</Btn>
      </Card>

      <Card id="set-team" title={t('set.s.team')} aside={<Link to="/business/team">{t('set.invite')}</Link>}>
        {team.error ? <p className="v2-muted">{t('set.teamHidden')}</p> : (
          <ul className="v2-team">
            {members.map((m) => (
              <li key={m.id || m.user_id}>
                <span className="v2-ava">{initial(m.display_name || m.first_name || m.username)}</span>
                <span className="v2-team-name">{m.display_name || m.first_name || m.username || '—'}</span>
                <Pill tone="neutral">{t(`set.role.${m.role}`)}</Pill>
                <span className="v2-muted v2-small v2-team-what">{t(`set.roleWhat.${m.role}`)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/business/team">{t('set.manageTeam')}</Link>
      </Card>

      <Card id="set-connections" title={t('set.s.connections')}>
        <ul className="v2-conn">
          <li><I.send size={18} /><span><strong>Telegram</strong><span className="v2-muted v2-small">{t('set.tg')}</span></span><Link to="/business/settings/classic">{t('set.open')}</Link></li>
          <li><I.cfo size={18} /><span><strong>{t('set.ai')}</strong><span className="v2-muted v2-small">{t('set.aiHint')}</span></span><Link to="/business/settings/classic">{t('set.open')}</Link></li>
          <li><I.accounts size={18} /><span><strong>{t('set.bank')}</strong><span className="v2-muted v2-small">{t('set.bankHint')}</span></span><Link to="/business/bank-import">{t('acc.import')}</Link></li>
          <li><I.link size={18} /><span><strong>{t('set.gateways')}</strong><span className="v2-muted v2-small">{t('set.gatewaysHint')}</span></span><Link to="/business/payment-connections">{t('set.open')}</Link></li>
        </ul>
      </Card>

      <Card id="set-plan" title={t('set.s.plan')}>
        <p className="v2-sec">{planLabel || '—'}</p>
        <p className="v2-muted v2-small">{t('set.planNote')}</p>
      </Card>
    </div>
  )
}
