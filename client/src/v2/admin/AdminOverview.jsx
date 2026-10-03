// Platform overview — GET /api/admin/dashboard (counts, health, warnings; billing is a
// placeholder server-side) and GET /api/admin/businesses (plans, trials, setup signals).
import { Link } from 'react-router-dom'
import { PageHead, Card, Pill, Skeleton, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { useAdminApi } from '../data'
import { shortDate } from '../lib/format'
import { overview, needsYou } from '../lib/adminModel'

export function AdminGate({ error, onRetry }) {
  const t = useT()
  if (error?.status === 403) return <ErrorBox error={t('admin.only')} />
  return <ErrorBox error={error} onRetry={onRetry} />
}

const n = (v) => (v == null ? '—' : String(v))

export default function AdminOverview() {
  const t = useT()
  const lang = useLang()
  const dash = useAdminApi('/admin/dashboard')
  const list = useAdminApi('/admin/businesses?limit=200')
  const head = <PageHead title={t('admin.overviewTitle')} sub={t('admin.overviewSub', { d: shortDate(new Date(), lang) })} actions={<Link to="/admin/system">{t('admin.system')}</Link>} />
  if (dash.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (dash.error) return <>{head}<AdminGate error={dash.error} onRetry={dash.reload} /></>
  const d = dash.data || {}
  const ov = overview(list.data?.businesses || [])
  const items = needsYou(d, ov)
  const f = ov.funnel
  const pct = (x) => (f.signedUp ? `${Math.round((x / f.signedUp) * 100)}%` : '—')
  return (
    <div className="v2-page">
      {head}
      <div className="v2-tiles">
        <div className="v2-tile"><span className="v2-tile-label">{t('admin.revenue')}</span><span className="v2-tile-val v2-muted">—</span><span className="v2-tile-sub">{t('admin.billingOff')}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('admin.paying')}</span><span className="v2-tile-val v2-num">{n(ov.paying)}</span><span className="v2-tile-sub">{t('admin.payingSub')}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('admin.onTrial')}</span><span className="v2-tile-val v2-num">{n(ov.trials)}</span><span className="v2-tile-sub">{t('admin.endWeek', { n: ov.trialsEndingWeek })}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('admin.companiesN')}</span><span className="v2-tile-val v2-num">{n(d.businesses?.company_workspaces ?? ov.companies)}</span><span className="v2-tile-sub">{t('admin.newCo', { n: n(d.businesses?.new_last_30_days) })}</span></div>
      </div>
      <div className="v2-grid-detail">
        <div className="v2-col">
          <Card title={t('admin.funnelTitle')} aside={<span className="v2-muted v2-small">{t('admin.funnelSub')}</span>}>
            <ul className="v2-funnel">
              {[['signedUp', f.signedUp], ['accounts', f.accounts], ['active', f.active]].map(([k, v]) => (
                <li key={k}><span>{t(`admin.funnel.${k}`)}</span><span className="v2-funnel-bar" aria-hidden="true"><span style={{ width: f.signedUp ? `${(v / f.signedUp) * 100}%` : 0 }} /></span><span className="v2-num">{v}</span><span className="v2-muted v2-num">{pct(v)}</span></li>
              ))}
            </ul>
            <p className="v2-muted v2-small">{t('admin.funnelNote')}</p>
          </Card>
          <Card title={t('admin.usersTitle')}>
            <dl className="v2-dl v2-dl-tight">
              <dt>{t('admin.u.total')}</dt><dd className="v2-num v2-r">{n(d.users?.total)}</dd>
              <dt>{t('admin.u.new7')}</dt><dd className="v2-num v2-r">{n(d.users?.new_last_7_days)}</dd>
              <dt>{t('admin.u.email')}</dt><dd className="v2-num v2-r">{n(d.users?.with_email_identity)}</dd>
              <dt>{t('admin.u.telegram')}</dt><dd className="v2-num v2-r">{n(d.users?.telegram_origin)}</dd>
              <dt>{t('admin.u.personal')}</dt><dd className="v2-num v2-r">{n(d.businesses?.personal_workspaces)}</dd>
            </dl>
          </Card>
          <Card title={t('admin.aiTitle')}><p className="v2-muted">{t('admin.aiNa')}</p></Card>
        </div>
        <aside className="v2-col">
          <Card title={t('admin.plans')}>
            <ul className="v2-moves">{Object.entries(ov.plans).map(([p, c]) => <li key={p}><span>{t(`admin.plan.${p}`)}</span><span className="v2-num">{c}</span></li>)}</ul>
            <p className="v2-muted v2-small">{t('admin.plansNote')}</p>
          </Card>
          <Card title={t('admin.needsYou')} aside={<Link to="/admin/system">{t('admin.all')}</Link>}>
            <ul className="v2-needs-list">
              {items.map((x, i) => <li key={i}><Pill tone={x.tone}>{t(`admin.tone.${x.tone}`)}</Pill><span>{x.text || t(`admin.need.${x.key}`, { n: x.n })}</span></li>)}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  )
}
