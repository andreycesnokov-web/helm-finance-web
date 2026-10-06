// AI Accountant (designs/Accountant, AccountantPackages, AccountantTaxes).
// Tabs: Month close · Documents by transaction · Tax calendar (this page, ?tab=) and
// Tax profile (/business/accountant/tax-profile).
//
// Reads only: /api/transactions?period=all, /api/debts, /api/bank-import/batches,
// /api/wallets, /api/accountant/summary (stored compliance events — read-only; the
// calendar route that GENERATES events is not called from here), /api/accountant/obligations
// (engine-calculated amounts). The ask box uses the existing POST /api/accountant/ask,
// which answers from the verified rules and changes no data.
// "Engines calculate, AI explains": no rate, date or amount is computed in this file.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { PageHead, Card, Pill, Btn, NotYet, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'
import { monthOptions, accountantMonth, closeReadiness, packages, packageSummary, monthGrid, complianceEvents, eventStage } from '../lib/accounting'
import { askAccountant } from '../lib/ask'
import AccountantTabs from '../components/AccountantTabs'
import { findWithholdingRule } from '../../pages/business/InvoiceReviewDrawer'
import TaxKnowledgeCard from '../../components/TaxKnowledgeCard'
import { listTaxCards, getTaxCard, matchTopicId } from '../../lib/taxKnowledgeFixtures'
import InfoTooltip from '../../components/InfoTooltip'

const monthLabel = (key, lang) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { month: 'long', year: 'numeric' })
}
const STAGE_TONE = { done: 'good', overdue: 'crit', calculated: 'info', todo: 'neutral' }

function MonthPicker({ value, onChange }) {
  const t = useT()
  const lang = useLang()
  return (
    <select className="v2-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('acct.month')}>
      {monthOptions(12).map((m) => <option key={m.key} value={m.key}>{monthLabel(m.key, lang)}</option>)}
    </select>
  )
}

function AskBox({ externalQuery = '', onQueryChange }) {
  const t = useT()
  const { token } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(() => externalQuery || sp.get('ask') || '')
  const [st, setSt] = useState({ busy: false, answer: null, err: null })
  // One business's answer never shows under another (review 8.2 #2).
  const { active, scopeKey } = useWorkspace()
  const wsKey = `${active?.id ?? ''}|${scopeKey ?? ''}`
  const wsRef = useRef(wsKey)

  useEffect(() => {
    if (externalQuery !== undefined && externalQuery !== null && externalQuery !== '') {
      setQ(externalQuery)
    }
  }, [externalQuery])

  useEffect(() => {
    if (wsRef.current !== wsKey) {
      wsRef.current = wsKey
      setQ('')
      setSt({ busy: false, answer: null, err: null })
      if (onQueryChange) onQueryChange('')
      if (sp.has('ask') || sp.has('q')) {
        const nextSp = new URLSearchParams(sp)
        nextSp.delete('ask')
        nextSp.delete('q')
        setSp(nextSp, { replace: true })
      }
    }
  }, [wsKey, sp, setSp, onQueryChange])

  useEffect(() => {
    // Only take search param if ws hasn't just switched away
    const askParam = sp.get('ask') || sp.get('q')
    if (askParam) {
      setQ(askParam)
    }
  }, [sp])

  const ask = async (question) => {
    const text = (question ?? q).trim()
    if (!text) return
    const asked = wsRef.current
    setQ(text); setSt({ busy: true, answer: null, err: null })
    try { const r = await askAccountant(token, text); if (wsRef.current === asked) setSt({ busy: false, answer: r, err: null }) }
    catch (e) { if (wsRef.current === asked) setSt({ busy: false, answer: null, err: e?.status === 403 ? t('dec.forbidden') : e.message }) }
  }
  return (
    <Card>
      <form className="v2-askbox" onSubmit={(e) => { e.preventDefault(); ask() }}>
        <label htmlFor="acc-ask" className="v2-field-label">{t('acct.askLabel')}</label>
        <div className="v2-askrow">
          <input
            id="acc-ask"
            className="v2-input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (onQueryChange) onQueryChange(e.target.value)
            }}
            placeholder={t('acct.askPh')}
            maxLength={500}
          />
          <button type="submit" className="v2-btn v2-btn-primary" aria-label={t('acct.send')} title={q.trim() ? undefined : t('ask.typeFirst')} disabled={st.busy || !q.trim()}><I.send size={16} /></button>
        </div>
      </form>
      <div className="v2-chips">
        {['q1', 'q2', 'q3'].map((k) => <button key={k} type="button" className="v2-chip" onClick={() => ask(t(`acct.chip.${k}`))}>{t(`acct.chip.${k}`)}</button>)}
        <Link className="v2-chip v2-chip-ask" to="/business/accountant/tax-profile">{t('acct.tab.profile')}</Link>
      </div>
      {st.busy && <Skeleton rows={2} />}
      {st.err && <p className="v2-inline-err" role="alert">{st.err}</p>}
      {st.answer && (
        <div className="v2-answer" aria-live="polite">
          <p>{st.answer.answer}</p>
          {st.answer.disclaimer && <p className="v2-muted v2-small">{st.answer.disclaimer}</p>}
          {Array.isArray(st.answer.used_rules) && st.answer.used_rules.length > 0 && (
            <p className="v2-muted v2-small">{t('acct.sources')}: {st.answer.used_rules.map((r) => r.rule_code).join(', ')}</p>
          )}
        </div>
      )}
    </Card>
  )
}

function TaxList({ events, lang, t, limit, empty = 'acct.noEvents' }) {
  if (!events.length) return <p className="v2-muted">{t(empty)}</p>
  return (
    <ul className="v2-taxlist">
      {events.slice(0, limit).map((e) => {
        const stage = eventStage(e)
        const topicId = matchTopicId(e.rule_code || e.title)
        const matchedCard = topicId ? getTaxCard(topicId, lang) : null
        const whatText = Array.isArray(matchedCard?.what_is) && matchedCard.what_is[0]?.text
          ? matchedCard.what_is[0].text
          : (Array.isArray(matchedCard?.summary) && matchedCard.summary[0]?.text ? matchedCard.summary[0].text : '')
        const howText = Array.isArray(matchedCard?.how_it_works) && matchedCard.how_it_works[0]?.text
          ? matchedCard.how_it_works[0].text
          : (matchedCard?.section_status?.how_it_works === 'unavailable' ? 'Archived procedure under research review.' : '')

        return (
          <li key={e.id || e.rule_code + e.period}>
            <span className="v2-num v2-taxlist-date">{shortDate(e.due_date, lang)}</span>
            <span className="v2-taxlist-what" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <strong>{e.title || e.rule_code}</strong>
              {matchedCard && (
                <InfoTooltip
                  title={matchedCard.name}
                  what={whatText}
                  how={howText}
                  interpret={matchedCard.required_notice}
                  lang={lang}
                />
              )}
              {e.period && <span className="v2-muted"> · {e.period}</span>}
            </span>
            <span className="v2-num v2-r">{e.estimated_amount != null ? money(e.estimated_amount) : '—'}</span>
            <Pill tone={STAGE_TONE[stage]}>{t(`acct.stage.${stage}`)}</Pill>
          </li>
        )
      })}
    </ul>
  )
}

function CloseTab({ month }) {
  const t = useT()
  const lang = useLang()
  const { active, scopeKey } = useWorkspace()
  const [askQuery, setAskQuery] = useState('')

  useEffect(() => {
    setAskQuery('')
  }, [active?.id, scopeKey])
  const tx = useApi('/transactions?period=all')
  const debts = useApi('/debts')
  const batches = useApi('/bank-import/batches')
  const wallets = useApi('/wallets')
  const summary = useApi('/accountant/summary')
  const taxCardsApi = useApi(`/accountant/tax-knowledge/cards?lang=${lang}`)

  const taxStatus = taxCardsApi.error?.status || (taxCardsApi.error?.data && taxCardsApi.error.data.status)
  const isForbidden = taxStatus === 403 || taxStatus === 401 || /401|403|unauthorized|forbidden/i.test(taxCardsApi.error?.message || '')
  const isNetworkOffline = !!taxCardsApi.error && !taxStatus && (
    (typeof window !== 'undefined' && !window.navigator.onLine) ||
    /Failed to fetch|NetworkError|network|offline/i.test(taxCardsApi.error?.message || '')
  )
  const isServerError = !!taxCardsApi.error && !isForbidden && !isNetworkOffline
  const isOffline = isNetworkOffline
  const isMalformed = !taxCardsApi.loading && !taxCardsApi.error && taxCardsApi.data != null && (typeof taxCardsApi.data !== 'object' || !Array.isArray(taxCardsApi.data.cards))
  const isEmpty = !taxCardsApi.loading && !taxCardsApi.error && !isMalformed && Array.isArray(taxCardsApi.data?.cards) && taxCardsApi.data.cards.length === 0

  const taxCards = useMemo(() => {
    if (Array.isArray(taxCardsApi.data?.cards) && taxCardsApi.data.cards.length > 0) {
      return taxCardsApi.data.cards
    }
    if (isOffline) {
      return listTaxCards(lang)
    }
    return []
  }, [taxCardsApi.data, isOffline, lang])

  const r = useMemo(() => closeReadiness({ month, transactions: Array.isArray(tx.data) ? tx.data : [], debts: Array.isArray(debts.data) ? debts.data : [],
    batches: batches.data?.batches || [], wallets: wallets.data?.wallets || [] }), [month, tx.data, debts.data, batches.data, wallets.data])
  if (tx.loading || debts.loading) return <Card><Skeleton rows={6} /></Card>
  if (tx.error) return <ErrorBox error={tx.error} onRetry={tx.reload} />
  const events = complianceEvents(summary.data)
  const [y, m] = month.split('-').map(Number)
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`
  const due = events.filter((e) => String(e.due_date).slice(0, 7) === next)
  const dueSum = due.reduce((s, e) => s + (e.estimated_amount != null ? Number(e.estimated_amount) : 0), 0)
  const left = r.checks.filter((c) => !c.done)

  return (
    <div className="v2-grid-detail">
      <div className="v2-col">
        <section className="v2-hero v2-hero-plain">
          <div className="v2-hero-text">
            <span className="v2-hero-label">{t('acct.closeOf', { m: monthLabel(month, lang) })}</span>
            <h2 className="v2-hero-title">{r.percent == null ? t('acct.noRecords') : left.length === 0 ? t('acct.ready', { n: r.percent }) : t('acct.almost', { n: r.percent, k: left.length })}</h2>
            <p className="v2-hero-p v2-show">{t('acct.recordsComplete', { n: r.complete, m: r.records })}</p>
            <div className="v2-row-gap v2-row-start">
              <NotYet note={t('acct.reviewSoon')}>{t('acct.sendToAccountant')}</NotYet>
              <NotYet note={t('acct.packageSoon')}>{t('acct.download')}</NotYet>
            </div>
          </div>
        </section>
        <Card title={t('acct.toFinish', { m: monthLabel(month, lang) })}>
          <ul className="v2-check">
            {r.checks.map((c) => (
              <li key={c.key} className={c.done ? 'is-done' : ''}>
                <span className="v2-check-mark" aria-hidden="true">{c.done ? <I.check size={14} /> : null}</span>
                <span className="v2-check-text">
                  <span>{t(`acct.check.${c.key}`, { ok: c.ok, n: c.total })}<span className="v2-sr"> — {c.done ? t('acct.done') : t('acct.notDone')}</span></span>
                  {!c.done && c.missing.length > 0 && <span className="v2-muted v2-small">{c.missing.slice(0, 3).join(', ')}{c.missing.length > 3 ? ` +${c.missing.length - 3}` : ''}</span>}
                </span>
                {c.done ? <Pill tone="good">{t('acct.done')}</Pill>
                  : c.key === 'categories' ? <Link to="/business/transactions">{t('pulse.review')}</Link>
                  : c.key === 'statements' ? <Link to="/business/bank-import">{t('acc.import')}</Link>
                  : <Link to="/business/accountant?tab=packages">{t('acct.seePackages')}</Link>}
              </li>
            ))}
            <li>
              <span className="v2-check-mark" aria-hidden="true" />
              <span className="v2-check-text"><span>{t('acct.check.review')}</span><span className="v2-muted v2-small">{t('bill.doc.notTracked')}</span></span>
            </li>
          </ul>
        </Card>
      </div>
      <div className="v2-col">
        <Card title={t('acct.taxesDue', { m: monthLabel(next, lang) })} aside={<Link to="/business/accountant?tab=taxes">{t('acct.fullCalendar')}</Link>}>
          {dueSum > 0 && <p className="v2-stat-mid v2-num">{money(dueSum)}</p>}
          <TaxList events={due} lang={lang} t={t} limit={8} />
          <p className="v2-muted v2-small">{t('acct.taxNote')}</p>
        </Card>
        <AskBox externalQuery={askQuery} onQueryChange={setAskQuery} />
      </div>

      <div style={{ gridColumn: '1 / -1', marginTop: 14 }}>
        <Card title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {t('acct.taxReference')}
            <InfoTooltip term="tax_data_status" lang={lang} />
          </span>
        }>
          <p className="v2-muted v2-small" style={{ margin: '0 0 14px' }}>
            {t('acct.taxReferenceSub')}
          </p>
          {isForbidden && (
            <div className="v2-inline-err" role="alert" style={{ marginBottom: 12 }}>
              {t('acct.taxAccessDenied')}
            </div>
          )}
          {isOffline && (
            <div className="v2-banner v2-tone-warn" style={{ marginBottom: 12 }}>
              <I.warn size={16} />
              <span className="v2-banner-text">{t('acct.taxOfflineNotice')}</span>
            </div>
          )}
          {isServerError && (
            <div className="v2-inline-err" role="alert" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{t('acct.taxServerErr')}</span>
              <button type="button" className="v2-btn v2-btn-sm" onClick={taxCardsApi.reload}>
                {t('acct.taxRetry')}
              </button>
            </div>
          )}
          {isMalformed && (
            <div className="v2-inline-err" role="alert" style={{ marginBottom: 12 }}>
              {t('acct.taxMalformed')}
            </div>
          )}
          {taxCardsApi.loading && <Skeleton rows={4} />}
          {isEmpty && (
            <p className="v2-muted" style={{ padding: '20px 0', textAlign: 'center' }}>
              {t('acct.taxEmpty')}
            </p>
          )}
          {!taxCardsApi.loading && !isForbidden && !isServerError && !isMalformed && !isEmpty && (taxCards.length > 0 || isOffline) && (
            <div className="tax-cards-grid">
              {taxCards.map(card => (
                <TaxKnowledgeCard
                  key={card.topic_id}
                  card={card}
                  lang={lang}
                  onAskAccountant={(qText) => {
                    setAskQuery(qText)
                    const input = document.getElementById('acc-ask')
                    if (input) {
                      input.focus()
                    }
                  }}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function PackagesTab({ month }) {
  const t = useT()
  const lang = useLang()
  const [filter, setFilter] = useState('all')
  const [sel, setSel] = useState(null)
  const tx = useApi('/transactions?period=all')
  const debts = useApi('/debts')
  const rules = useApi('/accountant/rules')
  // A slip is expected only when the verified engine has a withholding rate (as on Bill detail).
  const slipNeeded = findWithholdingRule(rules.data?.rules || [])?.rate != null
  const slips = useApi('/withholding-slips')
  const rows = useMemo(() => packages({ month, slipNeeded, slips: slips.data, transactions: Array.isArray(tx.data) ? tx.data : [], debts: Array.isArray(debts.data) ? debts.data : [] }), [month, tx.data, debts.data, slipNeeded, slips.data])
  if (tx.loading || debts.loading) return <Card><Skeleton rows={6} /></Card>
  if (tx.error) return <ErrorBox error={tx.error} onRetry={tx.reload} />
  const s = packageSummary(rows)
  const shown = rows.filter((r) => filter === 'all' || (filter === 'incomplete' ? r.status !== 'complete' : r.kind === filter))
  const cur = rows.find((r) => r.key === sel) || shown.find((r) => r.status !== 'complete') || null

  return (
    <div className="v2-page">
      <div className="v2-tiles">
        <div className="v2-tile"><span className="v2-tile-label">{t('acct.pk.complete')}</span><span className="v2-tile-val v2-num">{s.complete}</span><span className="v2-tile-sub">{t('acct.pk.ofN', { n: s.total })}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('acct.pk.missing')}</span><span className="v2-tile-val v2-num">{s.missing}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('acct.pk.nocat')}</span><span className="v2-tile-val v2-num">{s.nocat}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('acct.pk.slips')}</span>
          {s.slipsToMake == null
            ? <><span className="v2-tile-val v2-muted">—</span><span className="v2-tile-sub">{t('bill.doc.notTracked')}</span></>
            : <span className="v2-tile-val v2-num">{s.slipsToMake}</span>}</div>
      </div>
      <div className="v2-grid-detail">
        <Card className="v2-col">
          <div className="v2-chips" role="group" aria-label={t('acct.pk.filter')}>
            {['all', 'incomplete', 'out', 'in', 'payroll'].map((k) => (
              <button key={k} type="button" className="v2-chip v2-chip-sel" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {k === 'all' ? t('acct.pk.f.allN', { n: rows.length }) : k === 'incomplete' ? t('acct.pk.f.incompleteN', { n: rows.length - s.complete }) : t(`acct.pk.f.${k}`)}
              </button>
            ))}
          </div>
          {shown.length === 0 ? <Empty icon={<I.documents size={28} />} title={t('acct.pk.emptyTitle')} text={t('acct.pk.emptyText')} /> : (
            <ul className="v2-pklist">
              {shown.map((r) => (
                <li key={r.key}>
                  <button type="button" className={`v2-pkrow${cur?.key === r.key ? ' is-on' : ''}`} onClick={() => setSel(r.key)} aria-pressed={cur?.key === r.key}>
                    <span className="v2-num v2-pk-date">{shortDate(r.date, lang)}</span>
                    <span className="v2-pk-what"><strong>{r.label || '—'}</strong>{r.note && <span className="v2-muted v2-small">{r.note}</span>}</span>
                    <span className={`v2-num v2-r ${r.kind === 'in' ? 'v2-pos' : ''}`}>{money(r.kind === 'in' ? r.amount : -r.amount, { sign: true })}</span>
                    <Pill tone={r.status === 'complete' ? 'good' : r.status === 'missing' ? 'warn' : r.status === 'nocat' ? 'crit' : 'neutral'}>
                      {r.status === 'missing' ? t('acct.pk.st.missingN', { n: r.missing }) : t(`acct.pk.st.${r.status}`)}</Pill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <aside className="v2-col">
          {cur && (
            <Card title={cur.label || '—'}>
              <p className="v2-muted v2-small">{shortDate(cur.date, lang)} · {money(cur.amount)}</p>
              <ul className="v2-check">
                {cur.items.map((i) => (
                  <li key={i.key} className={i.done ? 'is-done' : ''}>
                    <span className="v2-check-mark" aria-hidden="true">{i.done ? <I.check size={14} /> : null}</span>
                    <span className="v2-check-text"><span>{t(`acct.pk.item.${i.key}`)}</span>
                      <span className="v2-muted v2-small">{i.done ? t('bill.doc.have') : i.unknown ? t('bill.doc.notTracked') : i.pending ? t('bill.doc.proofSub') : i.review ? t('bill.ck.notChecked') : t('bill.doc.missing')}</span></span>
                    {!i.done && !i.unknown && !i.pending && (i.review || i.key === 'slip'
                      ? <Link to={`/business/${cur.kind === 'in' ? 'receivables' : 'payables'}/${cur.id}`}>{t('bills.open')}</Link>
                      : i.key === 'category'
                      ? <Link to="/business/transactions">{t('tx.chooseCategory')}</Link>
                      : <Link to="/business/documents">{t('bill.upload')}</Link>)}
                  </li>
                ))}
              </ul>
              {cur.key.startsWith('debt:') && <Link to={`/business/${cur.kind === 'in' ? 'receivables' : 'payables'}/${cur.id}`}>{t('bills.open')}</Link>}
              <NotYet note={t('acct.packageSoon')}>{t('acct.pk.downloadFolder')}</NotYet>
            </Card>
          )}
          <Card title={t('acct.pk.whatTitle')}><p className="v2-sec">{t('acct.pk.what')}</p></Card>
        </aside>
      </div>
    </div>
  )
}

function TaxesTab({ month }) {
  const t = useT()
  const lang = useLang()
  const summary = useApi('/accountant/summary')
  if (summary.loading) return <Card><Skeleton rows={6} /></Card>
  if (summary.error) return <ErrorBox error={summary.error?.status === 403 ? t('dec.forbidden') : summary.error} onRetry={summary.reload} />
  const events = complianceEvents(summary.data)
  const inM = events.filter((e) => String(e.due_date).slice(0, 7) === month)
  const today = new Date().toISOString().slice(0, 10)
  const nextDue = events.find((e) => e.due_date >= today && eventStage(e) !== 'done')
  const later = events.filter((e) => String(e.due_date).slice(0, 7) > month)
  const missing = summary.data?.missing_profile_fields || []

  return (
    <div className="v2-grid-detail">
      <div className="v2-col">
        <Card title={monthLabel(month, lang)}>
          {missing.length > 0 && (
            <div className="v2-banner v2-tone-warn"><I.warn size={18} /><span className="v2-banner-text">{t('acct.profileMissing', { n: missing.length })}</span><Btn to="/business/accountant/tax-profile">{t('acct.tab.profile')}</Btn></div>
          )}
          <table className="v2-cal">
            <caption className="v2-sr">{t('acct.calCaption', { m: monthLabel(month, lang) })}</caption>
            <thead><tr>{[1, 2, 3, 4, 5, 6, 0].map((d) => <th key={d} scope="col">{new Date(2024, 0, d === 0 ? 7 : d).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { weekday: 'short' })}</th>)}</tr></thead>
            <tbody>
              {monthGrid(month).map((w, i) => (
                <tr key={i}>
                  {w.map((c, j) => {
                    if (!c) return <td key={j} className="v2-cal-empty" />
                    const evs = inM.filter((e) => String(e.due_date).slice(0, 10) === c.iso)
                    return (
                      <td key={j} className={`${c.iso === today ? 'is-today' : ''}${evs.length ? ' has-ev' : ''}`}>
                        <span className="v2-cal-day">{c.day}</span>
                        {evs.map((e) => <span key={e.id || e.rule_code} className={`v2-cal-ev v2-tone-${eventStage(e) === 'overdue' ? 'crit' : 'warn'}`}>{e.title || e.rule_code}</span>)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={t('acct.stepByStep')}>
          <TaxList events={inM} lang={lang} t={t} limit={50} />
          <p className="v2-muted v2-small">{t('acct.calNote')}</p>
        </Card>
        <Card title={t('acct.ahead')}>
          <TaxList events={later} lang={lang} t={t} limit={12} empty="acct.noLater" />
          {/* No link to /accountant/calendar: that page calls the write-on-read endpoint (DECISIONS Q5). */}
        </Card>
      </div>
      <aside className="v2-col">
        <Card title={t('acct.nextDeadline')}>
          {nextDue ? (
            <>
              <p className="v2-dec-title">{nextDue.title || nextDue.rule_code} · {shortDate(nextDue.due_date, lang)}</p>
              <p className="v2-stat-mid v2-num">{nextDue.estimated_amount != null ? money(nextDue.estimated_amount) : t('acct.amountByEngine')}</p>
            </>
          ) : <p className="v2-muted">{t('acct.noEvents')}</p>}
          <NotYet note={t('placeholder.soon')}>{t('acct.billingCodes')}</NotYet>
        </Card>
        <Card title={t('acct.reminders')}>
          <p className="v2-sec">{t('acct.remindersText')}</p>
          <NotYet note={t('placeholder.soon')}>{t('acct.reminderSettings')}</NotYet>
        </Card>
      </aside>
    </div>
  )
}

export default function Accountant() {
  const t = useT()
  const [sp, setSp] = useSearchParams()
  const tab = ['packages', 'taxes'].includes(sp.get('tab')) ? sp.get('tab') : 'close'
  // Read from the URL on every render: validated, and reset to the tab's default on a tab
  // switch (the tab links carry no month).
  const month = accountantMonth(sp.get('month'), tab)
  const pickMonth = (m) => { const n = new URLSearchParams(sp); n.set('month', m); setSp(n, { replace: true }) }
  const sub = t(`acct.sub.${tab}`)
  return (
    <div className="v2-page">
      <PageHead title={t('nav.accountant')} sub={sub} actions={<><MonthPicker value={month} onChange={pickMonth} /><Btn to="/business/accountant/classic">{t('bills.classic')}</Btn></>} />
      <AccountantTabs active={tab} />
      {tab === 'close' && <CloseTab month={month} />}
      {tab === 'packages' && <PackagesTab month={month} />}
      {tab === 'taxes' && <TaxesTab month={month} />}
    </div>
  )
}
