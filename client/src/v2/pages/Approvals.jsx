// Approvals (designs/Approvals.dc.html, MobileApprovals.dc.html).
// "Nothing is paid without approval." Waiting = open items with approval_status
// 'pending_approval'; Decided = approved/rejected items with a decision time.
// Data: GET /api/debts, GET /api/pulse (cash effect, Radar rules). Decisions use the
// existing debt endpoints through DecisionActions; the server checks the role.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'
import { isPending, remaining } from '../lib/obligations'
import { cashItems, forecast } from '../lib/radarSeries'
import DecisionActions from '../components/DecisionActions'
import { detailPath } from './Bills'

const CHANNEL = { mcp: 'approvals.from.ai', telegram: 'approvals.from.telegram', web: 'approvals.from.web' }

export default function Approvals() {
  const t = useT()
  const lang = useLang()
  const [tab, setTab] = useState('waiting')
  const debts = useApi('/debts')
  const pulse = useApi('/pulse?scope=business')
  const list = Array.isArray(debts.data) ? debts.data : []
  const waiting = list.filter(isPending).sort((a, b) => String(a.due_date || '9') < String(b.due_date || '9') ? -1 : 1)
  const decided = list.filter((d) => d.approved_at && ['approved', 'rejected'].includes(d.approval_status))
    .sort((a, b) => (a.approved_at < b.approved_at ? 1 : -1)).slice(0, 10)

  // Expected cash right after each waiting item's date, if it is approved (Radar rules).
  const after = useMemo(() => {
    if (!pulse.data) return {}
    const p = pulse.data
    const items = cashItems({ debts: [...(p.debts || []).filter((x) => !waiting.some((w) => String(w.id) === String(x.id))), ...waiting] }).items
    const f = forecast({ balance: p.totalBalance, burnRate: p.burnRate, items })
    return Object.fromEntries(items.filter((i) => i.tag === 'approval').map((i) => [String(i.id), f.days[i.day]?.expected]))
  }, [pulse.data, waiting]) // eslint-disable-line react-hooks/exhaustive-deps

  const head = <PageHead title={t('nav.approvals')} sub={t('approvals.sub')} />
  if (debts.loading) return <>{head}<Card><Skeleton rows={5} /></Card></>
  if (debts.error) return <>{head}<ErrorBox error={debts.error} onRetry={debts.reload} /></>

  return (
    <div className="v2-page">
      {head}
      <div className="v2-grid-detail">
        <div className="v2-col">
          <div className="v2-seg" role="tablist" aria-label={t('nav.approvals')}>
            <button type="button" role="tab" className="v2-seg-btn" aria-selected={tab === 'waiting'} aria-pressed={tab === 'waiting'} onClick={() => setTab('waiting')}>{t('approvals.waiting', { n: waiting.length })}</button>
            <button type="button" role="tab" className="v2-seg-btn" aria-selected={tab === 'decided'} aria-pressed={tab === 'decided'} onClick={() => setTab('decided')}>{t('approvals.decided')}</button>
          </div>

          {tab === 'waiting' && (waiting.length === 0
            ? <Card><Empty icon={<I.approvals size={28} />} title={t('approvals.emptyTitle')} text={t('approvals.emptyText')} /></Card>
            : waiting.map((d) => (
              <Card key={d.id} as="article" className="v2-appr">
                <div className="v2-appr-top">
                  <span className="v2-dec-ic v2-tone-info" aria-hidden="true">{d.type === 'receivable' ? <I.arrowDown /> : <I.bills />}</span>
                  <div className="v2-dec-text">
                    <span className="v2-muted v2-small">{t(d.type === 'receivable' ? 'approvals.invoice' : 'approvals.bill')}</span>
                    <Link className="v2-dec-title" to={detailPath(d)}>{d.counterparty || t('bills.noName')}</Link>
                    <span className="v2-dec-meta">{[d.description, d.due_date && t('pulse.dec.due', { d: shortDate(d.due_date, lang) })].filter(Boolean).join(' · ')}</span>
                  </div>
                  <span className="v2-dec-amt v2-num">{money(remaining(d), { currency: d.currency || 'IDR' })}</span>
                </div>
                <div className="v2-appr-meta">
                  <Pill tone="neutral">{t(CHANNEL[d.source_channel] || 'approvals.from.web')}{d.created_by_name ? ` · ${d.created_by_name}` : ''}</Pill>
                  {after[String(d.id)] != null && <span className="v2-muted v2-small">{t('approvals.cashAfter', { v: money(after[String(d.id)]) })}</span>}
                  {d.info_requested_at && <Pill tone="warn">{t('approvals.infoAsked')}</Pill>}
                </div>
                <DecisionActions debt={d} />
              </Card>
            )))}

          {tab === 'decided' && (
            <Card title={t('approvals.recent')}>
              {decided.length === 0 ? <p className="v2-muted">{t('approvals.noneDecided')}</p> : (
                <ul className="v2-decided">
                  {decided.map((d) => (
                    <li key={d.id}>
                      <span className="v2-decided-text">
                        <Link to={detailPath(d)}>{d.counterparty || t('bills.noName')}</Link>
                        <span className="v2-muted v2-small">{d.approval_status === 'rejected'
                          ? t('approvals.rejectedOn', { d: shortDate(d.approved_at, lang), why: d.rejected_reason || '—' })
                          : t('approvals.approvedOn', { d: shortDate(d.approved_at, lang) })}</span>
                      </span>
                      <Pill tone={d.approval_status === 'rejected' ? 'crit' : 'good'}>{t(`approvals.st.${d.approval_status}`)}</Pill>
                      <span className="v2-num">{money(d.original_amount ?? d.amount, { currency: d.currency || 'IDR' })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <aside className="v2-col">
          <Card title={t('approvals.howTitle')}>
            <p className="v2-sec">{t('approvals.how1')}</p>
            <p className="v2-sec">{t('approvals.how2')}</p>
            <Link to="/business/team">{t('approvals.whoCan')}</Link>
          </Card>
        </aside>
      </div>
    </div>
  )
}
