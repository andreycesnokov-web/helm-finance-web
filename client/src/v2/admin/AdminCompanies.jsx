// Companies — GET /api/admin/businesses (list) and, for the selected company,
// GET /api/admin/businesses/:id, /members, /usage (counts), /api/admin/access-audit
// (plan/trial changes). Their financial data stays closed: "Request support access" is
// disabled until the grant design is approved (PROPOSALS P-13). Plan, trial and archive
// tools stay on the existing page: /admin/businesses/:id/tools.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Btn, NotYet, Skeleton } from '../ui'
import { useT, useLang } from '../i18n'
import { useAdminApi } from '../data'
import { shortDate } from '../lib/format'
import { filterCompanies, companyStatus, setupScore } from '../lib/adminModel'
import { AdminGate } from './AdminOverview'

const TONE = { healthy: 'good', trialEnds: 'warn', setupStuck: 'warn', pastDue: 'crit', archived: 'neutral' }

function Detail({ id, row, t, lang }) {
  const b = useAdminApi(`/admin/businesses/${encodeURIComponent(id)}`)
  const mem = useAdminApi(`/admin/businesses/${encodeURIComponent(id)}/members`)
  const use = useAdminApi(`/admin/businesses/${encodeURIComponent(id)}/usage`)
  const audit = useAdminApi(`/admin/access-audit?business_id=${encodeURIComponent(id)}&limit=5`)
  if (b.loading) return <Card><Skeleton rows={5} /></Card>
  if (b.error) return <AdminGate error={b.error} onRetry={b.reload} />
  const d = b.data || {}
  const biz = d.identity || {}
  const members = mem.data?.members || []
  const roles = members.reduce((m, x) => { m[x.role] = (m[x.role] || 0) + 1; return m }, {})
  const u = use.data?.usage || {}
  return (
    <Card as="section" className="v2-admin-detail" aria-label={biz.name}>
      <p className="v2-muted v2-small">{t('admin.selected')}</p>
      <h2 className="v2-h2">{biz.name}</h2>
      <p className="v2-sec v2-small">{[biz.business_code, biz.type, d.owner?.name ? t('admin.owner', { name: d.owner.name }) : null].filter(Boolean).join(' · ')}</p>
      <dl className="v2-dl v2-dl-tight">
        <dt>{t('admin.col.plan')}</dt><dd className="v2-r">{t(`admin.plan.${d.access?.effective_plan || row?.effective_plan || 'free'}`)}</dd>
        <dt>{t('admin.trial')}</dt><dd className="v2-r">{row?.trial_ends_at ? shortDate(row.trial_ends_at, lang) : '—'}</dd>
        <dt>{t('admin.team')}</dt><dd className="v2-r">{members.length ? Object.entries(roles).map(([r, c]) => `${c} ${t(`set.role.${r}`)}`).join(', ') : '—'}</dd>
        <dt>{t('admin.usage')}</dt><dd className="v2-r v2-small">{t('admin.usageLine', { w: u.wallets ?? '—', tx: u.transactions_this_month ?? '—', docs: u.documents ?? '—' })}</dd>
        <dt>{t('admin.aiQ')}</dt><dd className="v2-r v2-muted">{t('admin.notTracked')}</dd>
      </dl>
      <div className="v2-banner v2-tone-info">
        <I.admin size={18} />
        <span className="v2-banner-text"><strong>{t('admin.closedTitle')}</strong> {t('admin.closedText')}</span>
      </div>
      <NotYet note={t('admin.grantSoon')}>{t('admin.requestAccess')}</NotYet>
      <div className="v2-row-gap v2-row-start">
        <Btn to={`/admin/businesses/${encodeURIComponent(id)}/tools`}>{t('admin.tools')}</Btn>
      </div>
      <h3 className="v2-h3">{t('admin.recent')}</h3>
      {(audit.data?.events || []).length === 0 ? <p className="v2-muted v2-small">{t('admin.noRecent')}</p> : (
        <ul className="v2-moves">{audit.data.events.map((e) => <li key={e.id}><span>{shortDate(e.changed_at, lang)} · {t(`admin.act.${e.action}`)}</span><span className="v2-muted v2-small">{e.reason || ''}</span></li>)}</ul>
      )}
    </Card>
  )
}

export default function AdminCompanies({ selectedId }) {
  const t = useT()
  const lang = useLang()
  const nav = useNavigate()
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const list = useAdminApi('/admin/businesses?limit=200')
  const all = list.data?.businesses || []
  const companies = all.filter((b) => (b.type || 'business') !== 'personal')
  const head = <PageHead title={t('admin.companies')} sub={t('admin.companiesSub', { n: all.length, c: companies.length, p: all.length - companies.length })} actions={<Link to="/admin/dashboard">{t('admin.overview')}</Link>} />
  if (list.loading) return <>{head}<Card><Skeleton rows={8} /></Card></>
  if (list.error) return <>{head}<AdminGate error={list.error} onRetry={list.reload} /></>
  const counts = Object.fromEntries(['all', 'paying', 'trial', 'attention'].map((f) => [f, filterCompanies(all, { filter: f }).length]))
  const rows = filterCompanies(all, { filter, q })
  const sel = selectedId || rows[0]?.business_id || null
  return (
    <div className="v2-page">
      {head}
      <div className="v2-filters">
        <div className="v2-chips" role="group" aria-label={t('admin.filter')}>
          {['all', 'paying', 'trial', 'attention'].map((k) => <button key={k} type="button" className="v2-chip v2-chip-sel" aria-pressed={filter === k} onClick={() => setFilter(k)}>{t(`admin.f.${k}`, { n: counts[k] })}</button>)}
        </div>
        <label className="v2-search"><I.search size={16} /><span className="v2-sr">{t('admin.search')}</span>
          <input className="v2-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.search')} /></label>
      </div>
      <div className="v2-grid-detail">
        <Card className="v2-col">
          <div className="v2-adtable" role="table" aria-label={t('admin.companies')}>
            <div className="v2-adrow v2-adrow-head" role="row">
              <span role="columnheader">{t('admin.col.company')}</span><span role="columnheader">{t('admin.col.plan')}</span>
              <span role="columnheader">{t('admin.col.setup')}</span><span role="columnheader">{t('admin.col.last')}</span><span role="columnheader">{t('admin.col.status')}</span>
            </div>
            {rows.map((b) => {
              const st = companyStatus(b)
              const s = setupScore(b)
              return (
                <button key={b.business_id} type="button" role="row" className={`v2-adrow${sel === b.business_id ? ' is-on' : ''}`} aria-pressed={sel === b.business_id}
                  onClick={() => nav(`/admin/businesses/${encodeURIComponent(b.business_id)}`)}>
                  <span role="cell" className="v2-ad-name"><strong>{b.name}</strong><span className="v2-muted v2-small">{[b.business_code, t('admin.since', { d: shortDate(b.created_at, lang) })].filter(Boolean).join(' · ')}</span></span>
                  <span role="cell">{t(`admin.plan.${b.effective_plan || 'free'}`)}{b.trial_status_effective === 'active' && b.trial_ends_at ? <span className="v2-muted v2-small"> · {t('admin.trialTo', { d: shortDate(b.trial_ends_at, lang) })}</span> : null}</span>
                  <span role="cell" className="v2-num">{s.done}/{s.of}</span>
                  <span role="cell" className="v2-small">{shortDate(b.last_activity, lang)}</span>
                  <span role="cell"><Pill tone={TONE[st]}>{t(`admin.st.${st}`)}</Pill></span>
                </button>
              )
            })}
          </div>
          <p className="v2-muted v2-small">{t('admin.showing', { n: rows.length, m: companies.length })}</p>
        </Card>
        <aside className="v2-col">{sel && <Detail key={sel} id={sel} row={all.find((x) => x.business_id === sel)} t={t} lang={lang} />}</aside>
      </div>
    </div>
  )
}
