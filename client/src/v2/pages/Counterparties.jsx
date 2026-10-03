// Counterparties (designs/Counterparties.dc.html). Directory from GET /api/counterparties,
// open balances and payment habits from GET /api/debts (matched by name). A name opens
// the v2 edit form (existing PATCH /api/counterparties/:id); "Edit details" stays Classic.
// Duplicate suggestions (same NPWP or same bank account) are shown, never merged:
// "Keep both" only hides the suggestion on this device; merging is not available.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Btn, NotYet, Skeleton, ErrorBox, Empty } from '../ui'
import { useT } from '../i18n'
import { useApi } from '../data'
import { money } from '../lib/format'
import { duplicatePairs, cpFilter, payerHistory } from '../lib/obligations'

const DISMISS_KEY = 'v2.cpDupDismissed'
const readDismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') } catch { return [] } }

export default function Counterparties() {
  const t = useT()
  const [filter, setFilter] = useState('all')
  const [dismissed, setDismissed] = useState(readDismissed)
  const cps = useApi('/counterparties')
  const debts = useApi('/debts')
  const list = cps.data?.counterparties || []
  const dlist = Array.isArray(debts.data) ? debts.data : []
  const pairs = useMemo(() => duplicatePairs(list).filter((p) => !dismissed.includes([p.a.id, p.b.id].sort().join('|'))), [list, dismissed])

  const keepBoth = (p) => {
    const k = [p.a.id, p.b.id].sort().join('|')
    const next = [...dismissed, k]
    setDismissed(next)
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  const head = (
    <PageHead title={t('nav.counterparties')} sub={t('cp.sub')}
      actions={<>
        <Btn to="/business/counterparties/manage">{t('cp.manage')}</Btn>
        <Btn variant="primary" icon={<I.plus size={16} />} to="/business/counterparties/new">{t('cp.add')}</Btn>
      </>} />
  )
  if (cps.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (cps.error) return <>{head}<ErrorBox error={cps.error} onRetry={cps.reload} /></>

  const counts = Object.fromEntries(['all', 'customer', 'supplier', 'missing'].map((f) => [f, list.filter((c) => cpFilter(c, f)).length]))
  const rows = list.filter((c) => cpFilter(c, filter))

  return (
    <div className="v2-page">
      {head}
      {pairs.slice(0, 1).map((p) => (
        <div key={p.a.id + p.b.id} className="v2-banner v2-tone-warn" role="status">
          <I.warn size={18} />
          <span className="v2-banner-text">
            <strong>{t('cp.dupTitle', { a: p.a.display_name || p.a.name, b: p.b.display_name || p.b.name })}</strong>
            {' — '}{p.reason === 'npwp' ? t('cp.dupNpwp') : t('cp.dupBank', { last4: p.detail })} {t('cp.neverMerge')}
          </span>
          <Btn onClick={() => keepBoth(p)}>{t('cp.keepBoth')}</Btn>
          <NotYet note={t('cp.mergeSoon')}>{t('cp.merge')}</NotYet>
        </div>
      ))}

      <Card>
        <div className="v2-chips" role="group" aria-label={t('cp.filter')}>
          {['all', 'customer', 'supplier', 'missing'].map((f) => (
            <button key={f} type="button" className="v2-chip v2-chip-sel" aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`cp.f.${f}`, { n: counts[f] })}</button>
          ))}
        </div>
        {rows.length === 0 ? (
          <Empty icon={<I.counterparties size={28} />} title={t('cp.emptyTitle')} text={t('cp.emptyText')}
            action={<Btn variant="primary" to="/business/counterparties/new">{t('cp.add')}</Btn>} />
        ) : (
          <div className="v2-cptable" role="table" aria-label={t('nav.counterparties')}>
            <div className="v2-cprow v2-cprow-head" role="row">
              <span role="columnheader">{t('cp.col.name')}</span><span role="columnheader">{t('cp.col.type')}</span>
              <span role="columnheader">{t('cp.col.balance')}</span><span role="columnheader">{t('cp.col.pay')}</span>
              <span role="columnheader">{t('cp.col.tax')}</span>
            </div>
            {rows.map((c) => {
              const h = payerHistory(dlist, c.legal_name || c.name) || payerHistory(dlist, c.display_name)
              const owes = h && h.openTotal > 0
              const theyOwe = owes && (h.type === 'receivable')
              return (
                <div key={c.id} className="v2-cprow" role="row">
                  <span role="cell" className="v2-cp-name">
                    <Link to={`/business/counterparties/${encodeURIComponent(c.id)}/edit`}>{c.display_name || c.name}</Link>
                    {c.source_system === 'mcp' && <span className="v2-muted v2-small">{t('cp.byAi')}</span>}
                  </span>
                  <span role="cell"><Pill tone="neutral">{t(`cp.role.${c.role || 'other'}`)}</Pill></span>
                  <span role="cell" className="v2-num">{owes
                    ? <span className={h.lateNow > 0 ? 'v2-neg' : ''}>{t(theyOwe ? 'cp.owes' : 'cp.youOwe', { v: money(h.openTotal) })}{h.lateNow > 0 ? ` · ${t('cp.late')}` : ''}</span>
                    : '—'}</span>
                  <span role="cell" className="v2-small">{!h || h.paidCount === 0 ? <span className="v2-muted">{t('cp.noHistory')}</span>
                    : h.avgLate ? t('cp.avgLate', { n: h.avgLate }) : t('cp.onTime', { k: h.onTime, n: h.paidCount })}</span>
                  <span role="cell" className="v2-small">
                    {[c.entity_form ? t(`cp.form.ef.${c.entity_form}`) : null,
                      c.pkp_status === 'pkp' ? 'PKP' : c.pkp_status === 'non_pkp' ? 'Non-PKP' : null,
                      c.npwp ? t('cp.npwpOnFile') : null, c.default_tax_treatment,
                      c.payment_terms_days != null ? t('cp.termsN', { n: c.payment_terms_days }) : null].filter(Boolean).join(' · ')
                      || <Pill tone="warn">{t('cp.missing')}</Pill>}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
