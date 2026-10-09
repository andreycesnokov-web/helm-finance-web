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
import { identifyDocument, confirmDocumentKind } from '../lib/actions'
import { VAULT_TYPES, intakeTypeOf, intakeStatusOf } from '../../pages/business/companyVault'

// A document date carries its year ("27 February 2026"), unlike the list's short dates.
const docDate = (d, lang) => new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export const kindLabel = (t, k) => (VAULT_TYPES.includes(k) ? t(`docs.vault.${k}`) : t(`docs.kind.${k || 'unknown'}`))

export default function DocumentIdentity({ doc, sheetText, waitForSheet = false, onApplied }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const stored = doc?.extracted_json?.ai_identify?.[lang] || null
  const [result, setResult] = useState(stored)
  const [state, setState] = useState(stored ? 'ready' : 'idle')   // idle | loading | ready | error
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const asked = useRef(null)

  const run = async (force = false) => {
    setState('loading'); setErr(null)
    try {
      const body = { lang, force }
      if (sheetText) body.sheet_text = sheetText
      const r = await identifyDocument(token, doc.id, body)
      setResult(r?.identify || null); setState('ready')
    } catch (e) {
      setErr(e?.data?.error || e?.message || 'failed'); setState('error')
    }
  }

  // New document (or language): take the stored reading, or read it once by itself.
  useEffect(() => {
    const s = doc?.extracted_json?.ai_identify?.[lang] || null
    setResult(s); setState(s ? 'ready' : 'idle'); setErr(null)
  }, [doc?.id, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = `${doc?.id}|${lang}`
    if (!doc?.id || state !== 'idle' || asked.current === key) return
    if (waitForSheet && sheetText === undefined) return   // the preview is still reading the sheet's cells
    asked.current = key
    run(false)
  }, [doc?.id, lang, state, waitForSheet, sheetText]) // eslint-disable-line react-hooks/exhaustive-deps

  const x = result?.explanation || null
  const type = result?.suggested_type || null
  const isVault = VAULT_TYPES.includes(type)
  const already = type && intakeTypeOf(doc) === type && intakeStatusOf(doc) === 'manually_confirmed'
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
          <button type="button" className="v2-btn-link v2-small" onClick={() => run(true)}>{t('docs.id.again')}</button>
        </>
      )}
      {state === 'error' && <button type="button" className="v2-btn-link v2-small" onClick={() => run(true)}>{t('docs.id.retry')}</button>}
    </section>
  )
}
