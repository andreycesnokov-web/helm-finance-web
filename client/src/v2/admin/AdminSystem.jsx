// Flags & system — new /admin/system. Read-only. Backend flags are the booleans GET
// /api/admin/dashboard already returns (never values); frontend flags are the ones this
// build was made with. Changing a global flag still goes through a deploy (rule 7).
// Admin log: GET /api/admin/access-audit (plan/trial/access changes, append-only).
import { PageHead, Card, Pill, Skeleton } from '../ui'
import { useT, useLang } from '../i18n'
import { useAdminApi } from '../data'
import { shortDate } from '../lib/format'
import { AdminGate } from './AdminOverview'

// Build-time flags of THIS bundle. Vite inlines each value; the names are documented in
// .env.example / ARCHITECTURE.md.
const FRONTEND_FLAGS = {
  VITE_DESIGN_V2: import.meta.env.VITE_DESIGN_V2 === 'true',
  VITE_EMAIL_AUTH_ENABLED: import.meta.env.VITE_EMAIL_AUTH_ENABLED === 'true',
  VITE_BUSINESS_PREMIUM_UI: import.meta.env.VITE_BUSINESS_PREMIUM_UI === 'true',
  VITE_AI_ACCOUNTANT_PREMIUM: import.meta.env.VITE_AI_ACCOUNTANT_PREMIUM === 'true',
  VITE_PERSONAL_FUNDING_UI_ENABLED: import.meta.env.VITE_PERSONAL_FUNDING_UI_ENABLED === 'true',
}

export default function AdminSystem() {
  const t = useT()
  const lang = useLang()
  const dash = useAdminApi('/admin/dashboard')
  const audit = useAdminApi('/admin/access-audit?limit=20')
  const head = <PageHead title={t('admin.system')} sub={t('admin.systemSub')} />
  if (dash.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (dash.error) return <>{head}<AdminGate error={dash.error} onRetry={dash.reload} /></>
  const sys = dash.data?.system || {}
  const flags = sys.feature_flags || {}
  const Row = ({ name, on, kind }) => (
    <li className="v2-flag"><span className="v2-flag-name"><strong>{t(`admin.flag.${name}`)}</strong><code className="v2-muted v2-small">{name}</code></span>
      <span className="v2-muted v2-small">{t(`admin.kind.${kind}`)}</span><Pill tone={on ? 'good' : 'neutral'}>{t(on ? 'admin.on' : 'admin.off')}</Pill></li>
  )
  return (
    <div className="v2-page">
      {head}
      <Card title={t('admin.flags')} aside={<span className="v2-muted v2-small">{t('admin.flagsSub')}</span>}>
        <ul className="v2-flags">
          {Object.entries(flags).map(([k, v]) => <Row key={k} name={k} on={!!v} kind="backend" />)}
          {Object.entries(FRONTEND_FLAGS).map(([k, v]) => <Row key={k} name={k} on={v} kind="frontend" />)}
        </ul>
        <p className="v2-muted v2-small">{t('admin.flagsNote')}</p>
      </Card>
      <div className="v2-grid-2">
        <Card title={t('admin.services')}>
          <dl className="v2-dl v2-dl-tight">
            <dt>{t('admin.svc.db')}</dt><dd className="v2-r"><Pill tone={sys.db_reachable ? 'good' : 'crit'}>{t(sys.db_reachable ? 'admin.svc.ok' : 'admin.svc.down')}</Pill></dd>
            <dt>{t('admin.svc.metrics')}</dt><dd className="v2-r"><Pill tone={sys.degraded ? 'warn' : 'good'}>{t(sys.degraded ? 'admin.svc.partial' : 'admin.svc.complete')}</Pill></dd>
            <dt>{t('admin.svc.commit')}</dt><dd className="v2-r v2-num">{sys.commit || '—'}</dd>
            <dt>{t('admin.svc.checked')}</dt><dd className="v2-r">{sys.timestamp ? new Date(sys.timestamp).toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB') : '—'}</dd>
          </dl>
          <p className="v2-muted v2-small">{t('admin.svcNote')}</p>
        </Card>
        <Card title={t('admin.aiCost')}><p className="v2-muted">{t('admin.aiNa')}</p></Card>
      </div>
      <Card title={t('admin.log')} aside={<span className="v2-muted v2-small">{t('admin.logSub')}</span>}>
        {audit.error ? <p className="v2-muted">{t('admin.logNa')}</p> : (audit.data?.events || []).length === 0 ? <p className="v2-muted">{t('admin.noRecent')}</p> : (
          <ul className="v2-moves">{audit.data.events.map((e) => (
            <li key={e.id}><span>{shortDate(e.changed_at, lang)} · {t(`admin.act.${e.action}`)}{e.business_code ? ` · ${e.business_code}` : ''}</span><span className="v2-muted v2-small">{e.reason || ''}</span></li>
          ))}</ul>
        )}
      </Card>
    </div>
  )
}
