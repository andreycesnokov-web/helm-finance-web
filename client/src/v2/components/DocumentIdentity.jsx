// "What is this document?" — shown at the top of the document window. The reading is done on
// the server (POST /api/documents/:id/identify): the content classifier decides the type when
// it is confident, the model explains in the user's language. It runs by itself the first time
// a document is opened in a language and is stored, so the next open is instant and free.
// The suggested type is only APPLIED when the user presses "Accept" (existing classification route).
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { Pill, Skeleton } from '../ui'
import { useT, useLang } from '../i18n'
import { identifyDocument, confirmDocumentKind, fileDocument, recordDocumentTax } from '../lib/actions'
import { money } from '../lib/format'
import { filingText } from '../lib/obligations'
import { VAULT_TYPES, intakeTypeOf, intakeStatusOf } from '../../pages/business/companyVault'

// A document date carries its year ("27 February 2026"), unlike the list's short dates.
const docDate = (d, lang) => new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

const monthName = (p, lang) => { const [y, m] = String(p).split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { month: 'long', year: 'numeric' }) }

export const kindLabel = (t, k) => (VAULT_TYPES.includes(k) ? t(`docs.vault.${k}`) : t(`docs.kind.${k || 'unknown'}`))

export default function DocumentIdentity({ doc, sheetText, waitForSheet = false, onApplied }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const fresh = (r) => (r && r.v >= 3 ? r : null)   // older readings carry no filing / tax findings: read once more
  const stored = fresh(doc?.extracted_json?.ai_identify?.[lang])
  const [result, setResult] = useState(stored)
  const [state, setState] = useState(stored ? 'ready' : 'idle')   // idle | loading | ready | error
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const asked = useRef(null)

  const run = async (force = false, quiet = false) => {
    if (!quiet) setState('loading')
    setErr(null)
    try {
      const body = { lang, force: force || !!doc?.extracted_json?.ai_identify?.[lang] }
      if (sheetText) body.sheet_text = sheetText
      const r = await identifyDocument(token, doc.id, body)
      setResult(r?.identify || null); setState('ready')
    } catch (e) {
      if (quiet) return
      setErr(e?.data?.error || e?.message || 'failed'); setState('error')
    }
  }

  // New document (or language): take the stored reading, or read it once by itself.
  useEffect(() => {
    const s = fresh(doc?.extracted_json?.ai_identify?.[lang])
    setResult(s); setState(s ? 'ready' : 'idle'); setErr(null)
  }, [doc?.id, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = `${doc?.id}|${lang}`
    if (!doc?.id || asked.current === key) return
    if (state === 'ready') { asked.current = key; run(false, true); return }
    if (state !== 'idle') return
    if (waitForSheet && sheetText === undefined) return   // the preview is still reading the sheet's cells
    asked.current = key
    run(false)
  }, [doc?.id, lang, state, waitForSheet, sheetText]) // eslint-disable-line react-hooks/exhaustive-deps

  const x = result?.explanation || null
  const type = result?.suggested_type || null
  const isVault = VAULT_TYPES.includes(type)
  const already = type && intakeTypeOf(doc) === type && intakeStatusOf(doc) === 'manually_confirmed'
  const sf = result?.suggested_filing || null
  const currentFiling = doc?.extracted_json?.filing || null
  const filingReady = sf && (sf.kind !== 'bank_account_period' || (sf.wallet_id && sf.period)) && (sf.kind !== 'counterparty' || sf.counterparty_id)
  const filingSame = sf && currentFiling && currentFiling.kind === sf.kind && (currentFiling.wallet_id || null) === (sf.wallet_id || null)
    && (currentFiling.period || null) === (sf.period || null) && (currentFiling.counterparty_id || null) === (sf.counterparty_id || null)
  const acceptFiling = async () => {
    setBusy(true); setErr(null)
    try {
      const body = sf.kind === 'bank_account_period' ? { kind: sf.kind, wallet_id: sf.wallet_id, period: sf.period }
        : sf.kind === 'counterparty' ? { kind: sf.kind, counterparty_id: sf.counterparty_id }
        : { kind: 'keep', reason: sf.reason || 'other', period: sf.period || undefined }
      await fileDocument(token, doc.id, body); onApplied?.({ filed: true })
    } catch (e) { setErr(e?.status === 403 ? t('docs.dr.err.forbidden') : (e?.data?.error || e?.message || 'failed')) }
    finally { setBusy(false) }
  }
  const [taxBusy, setTaxBusy] = useState(null)
  const recordTax = async (x) => {
    setTaxBusy(`${x.tax}|${x.period}`); setErr(null)
    try { await recordDocumentTax(token, doc.id, { tax: x.tax, period: x.period }); await run(false, true); onApplied?.({ tax: true }) }
    catch (e) { setErr(e?.status === 403 ? t('docs.dr.err.forbidden') : (e?.data?.error || e?.message || 'failed')) }
    finally { setTaxBusy(null) }
  }
  const accept = async () => {
    setBusy(true); setErr(null)
    try { await confirmDocumentKind(token, doc.id, type); onApplied?.({ type, vault: isVault }) }
    catch (e) { setErr(e?.status === 403 ? t('docs.dr.err.forbidden') : (e?.data?.error || e?.message || 'failed')) }
    finally { setBusy(false) }
  }

  return (
    <section className="v2-card v2-docdrawer-sec v2-docid" aria-live="polite" data-identify-state={state}>
      <h3 className="v2-h3"><I.cfo size={16} aria-hidden="true" /> {t('docs.id.title')}</h3>
      {(state === 'idle' || state === 'loading') && <><Skeleton rows={3} /><span className="v2-muted v2-small">{t('docs.id.reading')}</span></>}
      {state === 'error' && <p className="v2-inline-err" role="alert">{t('docs.id.failed', { msg: err })}</p>}
      {state === 'ready' && result && (
        <>
          {x ? (
            <>
              {x.title && <strong className="v2-docid-title">{x.title}</strong>}
              {x.summary && <p className="v2-sec">{x.summary}</p>}
              <dl className="v2-dl v2-dl-tight">
                {x.issued_by && <><dt>{t('docs.id.issuedBy')}</dt><dd>{x.issued_by}</dd></>}
                {x.issued_on && <><dt>{t('docs.id.issuedOn')}</dt><dd>{docDate(x.issued_on, lang)}</dd></>}
                {x.number && <><dt>{t('docs.id.number')}</dt><dd>{x.number}</dd></>}
                {x.place && <><dt>{t('docs.id.place')}</dt><dd>{t(`docs.id.places.${x.place}`)}</dd></>}
              </dl>
              {x.purpose && <p className="v2-muted v2-small">{x.purpose}</p>}
              {x.next_step && <p className="v2-small"><strong>{t('docs.id.next')}</strong> {x.next_step}</p>}
              {(x.warnings || []).length > 0 && <p className="v2-muted v2-small">{x.warnings.join(' · ')}</p>}
            </>
          ) : (
            <p className="v2-muted v2-small">{t(`docs.id.why.${['ai_unavailable', 'unreadable', 'ai_timeout'].includes(result.unavailable_reason) ? result.unavailable_reason : 'other'}`)}</p>
          )}
          {type && type !== 'unknown' && (
            <div className="v2-docid-kind">
              <span className="v2-small">{t('docs.id.kind')} <strong>{kindLabel(t, type)}</strong></span>
              <Pill tone={result.suggested_source === 'classifier' ? 'good' : 'info'}>{t(result.suggested_source === 'classifier' ? 'docs.id.byText' : 'docs.id.byAi')}</Pill>
              {already ? <Pill tone="good">{t('docs.id.already')}</Pill> : (
                <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={accept}>
                  {isVault ? t('docs.id.acceptCompany') : t('docs.id.acceptType')}
                </button>
              )}
            </div>
          )}
          {(result.taxes || []).length > 0 && (
            <div className="v2-docid-tax" data-doc-taxes>
              <strong className="v2-small">{t('docs.tax.title')}</strong>
              <ul>
                {result.taxes.map((x) => {
                  const ob = x.obligation
                  const inCal = ob && (!x.amount_to_obligation || x.amount == null || Number(ob.estimated_amount) === Number(x.amount) || ['professionally_reviewed', 'owner_confirmed'].includes(ob.amount_status))
                  const linkedHere = inCal && (doc.links || []).some((l) => l.target_type === 'compliance' && String(l.target_id) === String(ob.id))
                  return (
                    <li key={`${x.tax}|${x.period}`}>
                      <span><strong>{t(`docs.tax.name.${x.tax}`)}</strong>{x.period ? ` · ${monthName(x.period, lang)}` : ''}{x.amount != null ? ` — ${money(x.amount)}` : ''}</span>
                      <span className="v2-muted v2-small">{t(`docs.tax.role.${x.role}`)}{x.amount_source ? ` · ${t(`docs.tax.src.${x.amount_source}`)}` : ''}</span>
                      {x.what && <span className="v2-small">{x.what}</span>}
                      {x.deadlines && <span className="v2-small">{t('docs.tax.deadlines', { pay: docDate(x.deadlines.pay_by, lang), file: docDate(x.deadlines.file_by, lang) })} <span className="v2-muted">{t('docs.tax.general')}</span></span>}
                      {x.rule_code ? (
                        <span className="v2-docid-taxact">
                          {ob && <span className="v2-muted v2-small">{t('docs.tax.inCalendar', { amount: ob.estimated_amount != null ? money(ob.estimated_amount) : t('docs.tax.noAmount') })}</span>}
                          {inCal && linkedHere ? <Pill tone="good">{t('docs.tax.done')}</Pill> : (
                            <button type="button" className="v2-btn v2-btn-primary" disabled={!!taxBusy} onClick={() => recordTax(x)}>
                              {x.amount_to_obligation && x.amount != null ? t('docs.tax.record') : t('docs.tax.link')}
                            </button>
                          )}
                        </span>
                      ) : <span className="v2-muted v2-small">{t('docs.tax.noRule')}</span>}
                    </li>
                  )
                })}
              </ul>
              {(x?.tax_steps || []).length > 0 && (
                <>
                  <strong className="v2-small">{t('docs.tax.steps')}</strong>
                  <ol className="v2-small">{x.tax_steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
                </>
              )}
              <p className="v2-muted v2-small">{t('docs.tax.note')}</p>
            </div>
          )}
          {sf && (
            <div className="v2-docid-kind">
              <span className="v2-small">{t('docs.id.fileAs')} <strong>{filingText(t, sf, lang) || t(`docs.fl.mode.${sf.kind === 'bank_account_period' ? 'bank' : sf.kind}`)}</strong></span>
              {filingSame ? <Pill tone="good">{t('docs.id.already')}</Pill> : filingReady ? (
                <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={acceptFiling}>{t('docs.id.acceptFiling')}</button>
              ) : <span className="v2-muted v2-small">{t(sf.kind === 'bank_account_period' ? 'docs.id.pickAccount' : 'docs.id.pickBelow')}</span>}
            </div>
          )}
          <button type="button" className="v2-btn-link v2-small" onClick={() => run(true)}>{t('docs.id.again')}</button>
        </>
      )}
      {state === 'error' && <button type="button" className="v2-btn-link v2-small" onClick={() => run(true)}>{t('docs.id.retry')}</button>}
    </section>
  )
}
