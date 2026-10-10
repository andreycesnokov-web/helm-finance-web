// Bank statement import (designs w2/H1 file, H2 rows, H3 done; k/K4 what each row is).
//   1 · File   choose the account, drop CSV / XLS / PDF. The file is kept as a document; the server
//              engine reads it (BCA CSV, Permata PDF, the model for other formats) and checks it:
//              opening + credits − debits = closing. Several files for one statement: the first that
//              reads gives the rows, the rest are kept as evidence of the same account and month.
//   2 · Rows   the suggestion engine files each row (rules, history, bills/payroll, AI); this page adds
//              what the row is (lib/statementInsights: own transfer, intercompany, founder money,
//              private person, abroad, rent, fees) and the tax it can create. Every row is the user's call.
//   3 · Done   what was written, linked, skipped; the account reconciled to the bank.
// Money direction always follows the statement (in = income, out = expense); the category says what
// it is, so founder money and own transfers never count as revenue or cost (financialInsights keywords).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { money, shortDate } from '../lib/format'
import { insightOf } from '../lib/statementInsights'
import {
  uploadStatementFile, readStatement, createImportBatch, suggestImport, confirmImport, createClassificationRule, fileDocument, adjustWalletBalance,
} from '../lib/actions'

const STEPS = ['file', 'rows', 'done']
const BUCKETS = ['needs_review', 'suggested', 'high_confidence', 'matched_existing', 'duplicate', 'excluded']
const TAX_RATE = { pph26: 0.2, pph42: 0.1 }

function Steps({ cur }) {
  const t = useT()
  const i = STEPS.indexOf(cur)
  return (
    <ol className="v2-setup-steps" aria-label={t('imp.steps')}>
      {STEPS.map((s, k) => (
        <li key={s} className={k < i ? 'is-done' : k === i ? 'is-now' : ''} aria-current={k === i ? 'step' : undefined}>
          <span className="v2-setup-n" aria-hidden="true">{k < i ? <I.check size={14} /> : k + 1}</span>{t(`imp.step.${s}`)}
        </li>
      ))}
    </ol>
  )
}

export default function BankImport() {
  const [sp] = useSearchParams()
  const batchId = sp.get('batch')
  const done = sp.get('done')
  if (batchId && done) return <DoneStep batchId={batchId} />
  if (batchId) return <RowsStep batchId={batchId} />
  return <FileStep />
}

/* ── 1 · File ────────────────────────────────────────────────────────────── */
async function sheetText(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
}

function FileStep() {
  const t = useT()
  const lang = useLang()
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const wallets = useApi('/wallets')
  const batches = useApi('/bank-import/batches')
  // Arriving from month close with ?wallet_id=&month=: the target period, and a statement for it
  // that is uploaded but not yet confirmed (an undated one never counts as that month).
  const targetMonth = /^\d{4}-\d{2}$/.test(sp.get('month') || '') ? sp.get('month') : null
  const [walletId, setWalletId] = useState(sp.get('wallet_id') || sp.get('wallet') || '')
  const [files, setFiles] = useState([])      // { name, state, read?, documentId?, error? }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const input = useRef(null)
  const list = wallets.data?.wallets || []
  const main = files.find((f) => f.state === 'read' && f.read?.ok)
  const st = main?.read?.statement
  const wallet = list.find((w) => String(w.id) === String(walletId))
  useEffect(() => { if (!walletId && main?.read?.suggested_wallet_id) setWalletId(String(main.read.suggested_wallet_id)) }, [main, walletId])

  const add = async (picked) => {
    setErr('')
    const arr = [...picked].slice(0, 4)
    const base = files.length
    setFiles((xs) => [...xs, ...arr.map((f) => ({ name: f.name, state: 'uploading' }))])
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]; const k = base + i
      const set = (p) => setFiles((xs) => xs.map((x, j) => (j === k ? { ...x, ...p } : x)))
      let documentId
      try { documentId = (await uploadStatementFile(token, f))?.document?.id } catch (x) {
        if (x?.status === 409 && x?.data?.existing_document_id) documentId = x.data.existing_document_id
        else { set({ state: 'failed', error: x?.data?.error || x?.message }); continue }
      }
      set({ state: 'reading', documentId })
      try {
        const st2 = /\.(xlsx|xls)$/i.test(f.name) ? await sheetText(f) : null
        const r = await readStatement(token, documentId, st2)
        set({ state: r.ok ? 'read' : 'unread', read: r })
      } catch (x) { set({ state: 'failed', documentId, error: x?.data?.error || x?.message }) }
    }
    invalidate()
  }

  const start = async () => {
    if (!main || !wallet) return
    setBusy(true); setErr('')
    try {
      const s = main.read.statement
      const month = String(s.period_end || s.period_start || '').slice(0, 7)
      const b = await createImportBatch(token, {
        wallet_id: wallet.id, file_name: main.name, file_type: main.read.method, currency: s.currency || wallet.currency,
        opening_balance: s.opening, closing_balance: s.closing, statement_start: s.period_start, statement_end: s.period_end,
        document_id: main.documentId, rows: s.rows,
      })
      // The other files of the same statement are kept with this account and month.
      for (const f of files) {
        if (f === main || !f.documentId || !month) continue
        try { await fileDocument(token, f.documentId, { kind: 'bank_account_period', wallet_id: wallet.id, period: month }) } catch { /* evidence stays in Documents */ }
      }
      if (month) try { await fileDocument(token, main.documentId, { kind: 'bank_account_period', wallet_id: wallet.id, period: month }) } catch { /* idem */ }
      await suggestImport(token, b.batch.id)
      invalidate()
      nav(`/business/bank-import?batch=${b.batch.id}`)
    } catch (x) { setErr(t('imp.err.create', { msg: x?.data?.message || x?.data?.error || x?.message })) } finally { setBusy(false) }
  }

  const ccy = (wallet?.currency || st?.currency || 'IDR')
  const pending = targetMonth && walletId ? (batches.data?.batches || []).find((b) => String(b.wallet_id) === String(walletId)
    && b.statement_start && b.statement_end && String(b.statement_start).slice(0, 7) <= targetMonth && String(b.statement_end).slice(0, 7) >= targetMonth) : null
  // The account should hold the statement's opening balance before its rows are added.
  const openGap = wallet && st && st.opening != null && Math.abs(Number(wallet.balance || 0) - Number(st.opening)) >= 1
    && !(main?.read?.overlapping_batches || []).some((b) => String(b.wallet_id) === String(wallet.id))
  const setOpening = async () => {
    setBusy(true); setErr('')
    try {
      const d = new Date(`${st.period_start}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1)
      await adjustWalletBalance(token, wallet.id, { target_balance: Number(st.opening), transaction_date: d.toISOString().slice(0, 10), reason: 'Opening balance per bank statement' })
      invalidate(); wallets.reload()
    } catch (x) { setErr(x?.status === 403 ? t('accd.noRights') : (x?.data?.error || x?.message)) } finally { setBusy(false) }
  }
  const wrongCurrency = wallet && st && st.currency && String(wallet.currency || 'IDR') !== String(st.currency)
  const overlap = (main?.read?.overlapping_batches || []).filter((b) => wallet && String(b.wallet_id) === String(wallet.id))
  return (
    <div className="v2-page">
      <PageHead title={t('imp.title')} sub={t('imp.sub')} back={{ to: '/business/accounts', label: t('nav.accounts') }} />
      <Steps cur="file" />
      {targetMonth && <div className="v2-banner v2-tone-info" role="status"><I.info size={18} /><span className="v2-banner-text">{t('imp.period', { m: new Date(`${targetMonth}-01T00:00:00Z`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) })}</span></div>}
      {pending && (
        <div className="v2-banner v2-tone-warn" role="status" data-imp-pending><I.warn size={18} />
          <span className="v2-banner-text">{t(pending.status === 'imported' ? 'imp.already' : 'imp.pending', { file: pending.file_name || '—' })}</span>
          <Btn variant="primary" to={`/business/bank-import?batch=${pending.id}${pending.status === 'imported' ? '&done=1' : ''}`}>{pending.status === 'imported' ? t('first.open') : t('imp.continue')}</Btn>
        </div>
      )}
      <Card>
        <div className="v2-field-row">
          <label className="v2-field"><span className="v2-field-label">{t('imp.account')}</span>
            <select className="v2-select" value={walletId} onChange={(e) => setWalletId(e.target.value)} data-imp-wallet>
              <option value="">{t('pe.choose')}</option>
              {list.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.currency || 'IDR'}</option>)}
            </select>
            {list.length === 0 && !wallets.loading && <span className="v2-inline-err v2-small">{t('imp.noAccounts')} <Link to="/business/accounts">{t('acc.add')}</Link></span>}
          </label>
        </div>
        <div className={`v2-setup-drop${drag ? ' is-over' : ''}`} role="button" tabIndex={0}
          onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) add(e.dataTransfer.files) }}>
          <I.upload size={26} /><strong>{t('imp.drop')}</strong><span className="v2-muted v2-small">{t('imp.dropHint')}</span>
          <input ref={input} type="file" multiple accept=".csv,.xlsx,.xls,.pdf" hidden data-imp-file onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = '' }} />
        </div>
        {files.length > 0 && (
          <ul className="v2-setup-files" aria-live="polite">
            {files.map((f, i) => (
              <li key={i} className={`is-${f.state === 'read' && f.read?.ok ? 'read' : f.state === 'unread' && main ? 'other' : f.state === 'unread' || f.state === 'failed' ? 'unreadable' : 'reading'}`} data-imp-item={f.state}>
                <span className="v2-setup-fic" aria-hidden="true">{f.state === 'read' ? <I.check size={16} /> : f.state === 'unread' || f.state === 'failed' ? <I.close size={16} /> : <I.clock size={16} />}</span>
                <span className="v2-setup-ftext"><strong>{f.name}</strong>
                  <span className="v2-muted v2-small">
                    {f.state === 'uploading' && t('imp.st.uploading')}
                    {f.state === 'reading' && t('imp.st.reading')}
                    {f.state === 'failed' && t('imp.st.failed', { msg: f.error || '' })}
                    {f.state === 'unread' && (main ? t('imp.st.extra') : t(f.read?.is_sheet ? 'imp.st.sheetUnread' : 'imp.st.unread'))}
                    {f.state === 'read' && f === main && t('imp.st.main', { how: t(`imp.how.${f.read.method}`) })}
                    {f.state === 'read' && f !== main && t('imp.st.extra')}
                  </span></span>
                <Pill tone={f.state === 'read' ? 'good' : f.state === 'unread' && main ? 'neutral' : f.state === 'unread' || f.state === 'failed' ? 'crit' : 'info'}>{f.state === 'unread' && main ? t('imp.pill.evidence') : t(`imp.pill.${f.state}`)}</Pill>
              </li>
            ))}
          </ul>
        )}
        {st && (
          <div className={`v2-banner v2-tone-${st.checks?.balances === false ? 'warn' : 'good'}`} role="status" data-imp-summary>
            <I.info size={18} />
            <span className="v2-banner-text">
              {t('imp.read', { n: st.rows.length, from: st.period_start ? shortDate(st.period_start, lang) : '—', to: st.period_end ? shortDate(st.period_end, lang) : '—',
                open: st.opening != null ? money(st.opening, { currency: ccy, full: true }) : '—', close: st.closing != null ? money(st.closing, { currency: ccy, full: true }) : '—' })}
              {' '}{st.checks?.balances === true ? t('imp.balances') : st.checks?.balances === false ? t('imp.noBalance', { exp: money(st.checks.expected_closing, { currency: ccy, full: true }) }) : t('imp.noTotals')}
              {st.account_number && <> {t('imp.accNo', { no: st.account_number })}</>}
            </span>
          </div>
        )}
        {openGap && !wrongCurrency && (
          <div className="v2-banner v2-tone-warn" role="status" data-imp-opengap><I.warn size={18} />
            <span className="v2-banner-text">{t('imp.openGap', { name: wallet.name, now: money(wallet.balance, { currency: ccy, full: true }), open: money(st.opening, { currency: ccy, full: true }) })}</span>
            <button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={setOpening}>{t('imp.setOpening')}</button>
          </div>
        )}
        {wrongCurrency && <p className="v2-inline-err" role="alert">{t('imp.err.currency', { a: wallet.currency || 'IDR', f: st.currency })}</p>}
        {overlap.length > 0 && <div className="v2-banner v2-tone-warn" role="status"><I.warn size={18} /><span className="v2-banner-text">{t('imp.overlap', { d: shortDate(overlap[0].created_at, lang) })}</span></div>}
        {err && <p className="v2-inline-err" role="alert">{err}</p>}
        <div className="v2-setup-actions">
          <Link to="/business/accounts" className="v2-btn v2-btn-ghost">{t('set.cancel')}</Link>
          <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !main || !wallet || wrongCurrency} onClick={start} data-imp-start>{busy ? t('imp.parsing') : t('imp.parse')}</button>
        </div>
      </Card>
      <RecentBatches />
    </div>
  )
}

function RecentBatches() {
  const t = useT()
  const lang = useLang()
  const b = useApi('/bank-import/batches')
  const w = useApi('/wallets')
  const rows = (b.data?.batches || []).slice(0, 8)
  if (!rows.length) return null
  const name = (id) => (w.data?.wallets || []).find((x) => String(x.id) === String(id))?.name || '—'
  return (
    <Card title={t('imp.recent')}>
      <ul className="v2-set-cats">
        {rows.map((x) => (
          <li key={x.id}>
            <span>{name(x.wallet_id)} · {x.statement_start ? `${shortDate(x.statement_start, lang)} – ${shortDate(x.statement_end, lang)}` : shortDate(x.created_at, lang)} · {x.row_count} {t('imp.rowsWord')}</span>
            {x.status === 'imported' ? <Pill tone="good">{t('imp.imported')}</Pill> : <Link to={`/business/bank-import?batch=${x.id}`}>{t('imp.continue')}</Link>}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ── 2 · Rows ────────────────────────────────────────────────────────────── */
function RowsStep({ batchId }) {
  const t = useT()
  const lang = useLang()
  const nav = useNavigate()
  const { token, user } = useAuth()
  const { active, workspaces } = useWorkspace()
  const invalidate = useInvalidate()
  const rev = useApi(`/bank-imports/${batchId}/review`)
  const me = useApi('/me/profile')
  const [dec, setDec] = useState({})          // row id → { category_id, exclude, ok }
  const [tab, setTab] = useState('all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [rule, setRule] = useState(null)      // { text, category_id }
  const data = rev.data
  const cats = data?.categories || []
  const catByName = useMemo(() => new Map(cats.map((c) => [String(c.name).toLowerCase(), c])), [cats])
  const ctx = useMemo(() => ({
    company: active?.name || '',
    otherCompanies: (workspaces?.business || []).filter((b) => String(b.id) !== String(active?.id)).map((b) => b.name),
    ownerNames: [me.data?.profile?.display_name, user?.firstName].filter(Boolean),
  }), [active, workspaces, me.data, user])
  if (rev.loading) return <div className="v2-page"><PageHead title={t('imp.title')} /><Steps cur="rows" /><Card><Skeleton rows={8} /></Card></div>
  if (rev.error) return <div className="v2-page"><PageHead title={t('imp.title')} /><ErrorBox error={rev.error} onRetry={rev.reload} /></div>
  const batch = data.batch
  if (batch.status === 'imported') { nav(`/business/bank-import?batch=${batchId}&done=1`, { replace: true }); return null }
  const rows = (data.rows || []).slice().sort((a, b) => (a.row_index ?? 0) - (b.row_index ?? 0))
  const bucketOf = (r) => (dec[r.id]?.exclude ? 'excluded' : r.match_status === 'duplicate' ? 'duplicate'
    : r.review_status === 'matched_existing' && r.suggested_match_type === 'transfer' ? 'suggested'   // a same-amount pair in this statement
    : r.review_status || 'needs_review')
  const catFor = (r, ins) => dec[r.id]?.category_id ?? r.final_category_id ?? r.suggested_category_id ?? catByName.get(String(ins.category || '').toLowerCase())?.id ?? ''
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, rows.filter((r) => bucketOf(r) === b).length]))
  const shown = tab === 'all' ? rows : rows.filter((r) => bucketOf(r) === tab)
  const ccy = batch.currency || 'IDR'
  const signed = rows.filter((r) => !['excluded', 'duplicate'].includes(bucketOf(r))).reduce((s, r) => s + (r.direction === 'in' ? 1 : -1) * Number(r.amount), 0)
  const balances = batch.opening_balance != null && batch.closing_balance != null ? Math.abs(Number(batch.opening_balance) + signed - Number(batch.closing_balance)) < 1 : null
  const set = (id, p) => setDec((d) => ({ ...d, [id]: { ...(d[id] || {}), ...p } }))

  const confirm = async () => {
    setBusy(true); setErr('')
    try {
      const payload = rows.filter((r) => !r.linked_transaction_id).map((r) => {
        const b = bucketOf(r)
        if (b === 'excluded' || b === 'duplicate') return { row_id: r.id, match_action: 'exclude' }
        if (b === 'matched_existing' && (r.suggested_match_type === 'existing_tx' || r.matched_transaction_id)) return { row_id: r.id, match_action: 'link' }
        const ins = insightOf(r, ctx)
        const cid = catFor(r, ins)
        // Direction from the statement: in = income, out = expense — the category says what it is.
        return { row_id: r.id, transaction_type: r.direction === 'in' ? 'income' : 'expense', category_id: cid || null, scope: 'business' }
      })
      if (rule?.save && rule.text && rule.category_id) {
        try { await createClassificationRule(token, { rule_name: rule.text, match_type: 'contains', match_value: rule.text, category_id: rule.category_id, created_from: 'bank_import' }) } catch { /* the import does not depend on the rule */ }
      }
      await confirmImport(token, batchId, payload)
      invalidate()
      nav(`/business/bank-import?batch=${batchId}&done=1`)
    } catch (x) {
      setErr(x?.status === 409 ? t('imp.err.changed') : t('imp.err.confirm', { msg: x?.data?.message || x?.data?.error || x?.message }))
    } finally { setBusy(false) }
  }

  return (
    <div className="v2-page">
      <PageHead title={t('imp.rowsTitle', { n: rows.length })} sub={t('imp.rowsSub')} back={{ to: '/business/bank-import', label: t('imp.step.file') }}
        actions={<button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={confirm} data-imp-confirm>{busy ? t('imp.confirming') : t('imp.confirm')}</button>} />
      <Steps cur="rows" />
      <nav className="v2-seg v2-set-tabs" aria-label={t('imp.filter')}>
        <button type="button" className="v2-seg-btn" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>{t('imp.all')} · {rows.length}</button>
        {BUCKETS.filter((b) => counts[b] > 0).map((b) => <button key={b} type="button" className="v2-seg-btn" aria-pressed={tab === b} onClick={() => setTab(b)}>{t(`imp.b.${b}`)} · {counts[b]}</button>)}
      </nav>
      <Card>
        <ul className="v2-imp-rows" data-imp-rows>
          {shown.map((r) => {
            const ins = insightOf(r, ctx)
            const b = bucketOf(r)
            const cid = catFor(r, ins)
            const taxAmt = TAX_RATE[ins.tax] ? Math.round(Number(r.amount) * TAX_RATE[ins.tax]) : null
            return (
              <li key={r.id} className={`is-${b}`} data-imp-row={ins.kind} data-bucket={b}>
                <span className="v2-num v2-imp-date">{shortDate(r.tx_date, lang)}</span>
                <span className="v2-imp-text"><strong>{ins.counterparty || r.description}</strong>
                  <span className="v2-muted v2-small v2-block">{ins.counterparty ? r.description : ''}</span>
                  <span className="v2-small v2-block">{t(`imp.k.${ins.kind}`, { other: ins.other || '' })}{r.suggestion_source && r.suggestion_source !== 'none' && <span className="v2-muted"> · {t(`imp.src.${r.suggestion_source}`) !== `imp.src.${r.suggestion_source}` ? t(`imp.src.${r.suggestion_source}`) : r.suggestion_source}</span>}</span>
                  {ins.tax && <span className="v2-imp-tax v2-small v2-block">{t(`imp.tax.${ins.tax}`, { v: taxAmt != null ? money(taxAmt, { currency: ccy, full: true }) : '' })}</span>}
                </span>
                <span className={`v2-num v2-imp-amt ${r.direction === 'in' ? 'is-in' : 'is-out'}`}>{r.direction === 'in' ? '+' : '−'} {money(r.amount, { currency: ccy, full: true })}</span>
                <span className="v2-imp-what">
                  {b === 'duplicate' ? <span className="v2-muted v2-small">{t('imp.dupNote')}</span>
                    : b === 'matched_existing' ? <span className="v2-small">{t('imp.existingNote')}</span>
                    : (
                      <select className="v2-select" value={cid} aria-label={t('imp.category')} disabled={b === 'excluded'}
                        onChange={(e) => { set(r.id, { category_id: e.target.value, ok: true }); if (ins.kind === 'bank_fee' || ins.kind === 'gateway') setRule({ text: (r.description || '').split(/\s{2,}| \d/)[0].trim().slice(0, 40), category_id: e.target.value, save: false }) }}>
                        <option value="">{t('imp.choose')}</option>
                        {['inflow', 'outflow'].map((g) => (
                          <optgroup key={g} label={t(`set.books.${g}`)}>{cats.filter((c) => c.group_type === g && (g === 'inflow') === (r.direction === 'in')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                        ))}
                      </select>
                    )}
                  {ins.ask && b !== 'excluded' && !dec[r.id]?.ok && <span className="v2-imp-ask v2-small">{t(`imp.ask.${ins.kind}`)}</span>}
                </span>
                <span className="v2-imp-acts">
                  {b !== 'duplicate' && b !== 'matched_existing' && (
                    <button type="button" className="v2-btn-link v2-small" onClick={() => set(r.id, { exclude: !dec[r.id]?.exclude })}>{dec[r.id]?.exclude ? t('imp.include') : t('imp.exclude')}</button>
                  )}
                  {b !== 'excluded' && b !== 'duplicate' && <button type="button" className={`v2-btn-link v2-small${dec[r.id]?.ok ? ' is-ok' : ''}`} onClick={() => set(r.id, { ok: true })}>{dec[r.id]?.ok ? '✓ ' : ''}{t('imp.ok')}</button>}
                </span>
              </li>
            )
          })}
        </ul>
      </Card>
      {rule && (
        <Card title={t('imp.ruleTitle')}>
          <label className="v2-pe-sug-row"><input type="checkbox" checked={!!rule.save} onChange={(e) => setRule({ ...rule, save: e.target.checked })} />
            <span>{t('imp.rule', { text: rule.text, cat: cats.find((c) => String(c.id) === String(rule.category_id))?.name || '' })}</span></label>
          <p className="v2-muted v2-small">{t('imp.ruleNote')}</p>
        </Card>
      )}
      <Card title={t('imp.checkTitle')}>
        <p className={balances === false ? 'v2-inline-err' : 'v2-sec'} data-imp-balance={balances === null ? 'unknown' : balances ? 'ok' : 'off'}>
          {balances === null ? t('imp.check.none') : balances ? t('imp.check.ok') : t('imp.check.off', { v: money(Number(batch.opening_balance) + signed, { currency: ccy, full: true }), bank: money(batch.closing_balance, { currency: ccy, full: true }) })}
        </p>
        <p className="v2-muted v2-small">{t('imp.atomic')}</p>
        {err && <p className="v2-inline-err" role="alert">{err}</p>}
      </Card>
    </div>
  )
}

/* ── 3 · Done ────────────────────────────────────────────────────────────── */
function DoneStep({ batchId }) {
  const t = useT()
  const lang = useLang()
  const rev = useApi(`/bank-imports/${batchId}/review`)
  const w = useApi('/wallets')
  if (rev.loading) return <div className="v2-page"><PageHead title={t('imp.title')} /><Steps cur="done" /><Card><Skeleton rows={4} /></Card></div>
  if (rev.error) return <div className="v2-page"><ErrorBox error={rev.error} onRetry={rev.reload} /></div>
  const { batch, rows = [], reconciliation } = rev.data
  const n = (f) => rows.filter(f).length
  const wallet = (w.data?.wallets || []).find((x) => String(x.id) === String(batch.wallet_id))
  return (
    <div className="v2-page">
      <PageHead title={t('imp.title')} />
      <Steps cur="done" />
      <Card>
        <h2 className="v2-h2" data-imp-done>{t('imp.doneTitle', { p: batch.statement_end ? shortDate(batch.statement_end, lang) : '' })}</h2>
        <ul className="v2-set-cats">
          <li><span>{t('imp.d.new')}</span><strong className="v2-num" data-imp-new>{n((r) => ['imported', 'confirmed'].includes(r.review_status) && r.suggested_match_type !== 'existing_tx')}</strong></li>
          <li><span>{t('imp.d.linked')}</span><strong className="v2-num">{n((r) => r.review_status === 'matched_existing' || (r.review_status === 'imported' && r.suggested_match_type === 'existing_tx'))}</strong></li>
          <li><span>{t('imp.d.dup')}</span><strong className="v2-num">{n((r) => r.match_status === 'duplicate')}</strong></li>
          <li><span>{t('imp.d.excluded')}</span><strong className="v2-num">{n((r) => r.review_status === 'excluded')}</strong></li>
        </ul>
        {wallet && batch.closing_balance != null && (
          <div className={`v2-banner v2-tone-${Math.abs(Number(wallet.balance) - Number(batch.closing_balance)) < 1 ? 'good' : 'warn'}`} role="status" data-imp-acc={Math.abs(Number(wallet.balance) - Number(batch.closing_balance)) < 1 ? 'ok' : 'off'}>
            <span className="v2-banner-text">{Math.abs(Number(wallet.balance) - Number(batch.closing_balance)) < 1
              ? t('imp.acc.ok', { name: wallet.name, v: money(wallet.balance, { currency: batch.currency || 'IDR', full: true }) })
              : t('imp.acc.off', { name: wallet.name, v: money(wallet.balance, { currency: batch.currency || 'IDR', full: true }), bank: money(batch.closing_balance, { currency: batch.currency || 'IDR', full: true }) })}</span>
            {Math.abs(Number(wallet.balance) - Number(batch.closing_balance)) >= 1 && <Btn to="/business/accounts">{t('acc.balance')}</Btn>}
          </div>
        )}
        {reconciliation && (
          <div className={`v2-banner v2-tone-${reconciliation.status === 'balanced' ? 'good' : 'warn'}`} role="status" data-imp-recon={reconciliation.status}>
            <span className="v2-banner-text">{reconciliation.status === 'balanced'
              ? t('imp.recon.ok', { name: wallet?.name || '', d: shortDate(batch.statement_end, lang) })
              : t('imp.recon.off', { name: wallet?.name || '', v: money(reconciliation.difference ?? 0, { currency: batch.currency || 'IDR', full: true }) })}</span>
          </div>
        )}
        <div className="v2-setup-actions">
          <Btn to="/business/documents?tab=look">{t('imp.d.docs')}</Btn>
          <Btn to="/business/bank-import">{t('imp.d.another')}</Btn>
          <Btn variant="primary" to="/business/accounts">{t('imp.d.accounts')}</Btn>
        </div>
      </Card>
    </div>
  )
}
