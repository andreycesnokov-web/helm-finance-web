// The file itself, shown inside the Documents review panel, so the user can see what a document
// is BEFORE linking or classifying it (owner 2026-10-09). Rendering only: nothing here reads
// values off the file or writes anything back. The URL is the existing audited signed-url route
// (lib/actions.js documentFileUrl); the kind is decided by MIME, then extension (previewKind from
// the classic preview, one rule for both).
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { Skeleton } from '../ui'
import { useT } from '../i18n'
import { documentFileUrl } from '../lib/actions'
import { previewKind } from '../../lib/documentPreview'

const MAX_SHEET_BYTES = 4 * 1024 * 1024
const MAX_ROWS = 50
const MAX_COLS = 12
const TIMEOUT_MS = 15000

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

export default function DocumentPreview({ doc }) {
  const t = useT()
  const { token } = useAuth()
  const file = doc?.file || {}
  const kind = previewKind(file)
  // 'loading' | 'ready' | 'none' (no inline preview for this type) | 'error'
  const [state, setState] = useState('loading')
  const [url, setUrl] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [detail, setDetail] = useState(null)
  const [framed, setFramed] = useState(false)
  const reqFor = useRef(null)

  useEffect(() => {
    let on = true
    const id = doc?.id
    reqFor.current = id
    setUrl(null); setSheet(null); setDetail(null); setFramed(false)
    if (!id) { setState('error'); return undefined }
    if (kind === 'other' || kind === 'gsheet') { setState('none'); return undefined }
    setState('loading')
    const live = () => on && reqFor.current === id
    ;(async () => {
      try {
        const r = await withTimeout(documentFileUrl(token, id, 'view'), TIMEOUT_MS)
        if (!live()) return
        if (!r?.url) throw new Error('no_url')
        if (kind !== 'sheet') { setUrl(r.url); setState('ready'); return }
        const res = await withTimeout(fetch(r.url), TIMEOUT_MS)
        if (!res.ok) throw new Error(`storage ${res.status}`)
        const buf = await withTimeout(res.arrayBuffer(), TIMEOUT_MS)
        if (!live()) return
        if (buf.byteLength > MAX_SHEET_BYTES) { setDetail(t('docs.pv.tooBig')); setState('error'); return }
        const XLSX = await import('xlsx')
        const wb = XLSX.read(buf, { type: 'array', cellDates: false })
        const name = wb.SheetNames?.[0]
        const all = name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }) : []
        if (!live()) return
        setSheet({
          name, count: wb.SheetNames?.length || 1,
          rows: all.slice(0, MAX_ROWS).map((x) => (Array.isArray(x) ? x.slice(0, MAX_COLS) : [])),
          moreRows: Math.max(0, all.length - MAX_ROWS),
        })
        setState('ready')
      } catch (e) {
        if (!live()) return
        setDetail(e?.data?.error || e?.message || null)
        setState('error')
      }
    })()
    return () => { on = false }
  }, [doc?.id, kind, token]) // eslint-disable-line react-hooks/exhaustive-deps

  // A PDF the browser will not frame can render nothing and fire no event; say so instead.
  useEffect(() => {
    if (state !== 'ready' || !url || framed || !(kind === 'pdf' || kind === 'text')) return undefined
    const timer = setTimeout(() => { setDetail(null); setState('error') }, TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [state, url, framed, kind])

  const name = file.file_name || doc?.document_number || t('docs.dr.title')
  return (
    <div className="v2-docpv" data-preview-kind={kind} data-preview-state={state}>
      {state === 'loading' && <div className="v2-docpv-msg"><Skeleton rows={4} /><span className="v2-muted v2-small">{t('docs.pv.loading')}</span></div>}
      {state === 'ready' && kind === 'pdf' && url && (
        <iframe className="v2-docpv-frame" src={`${url}#view=FitH&navpanes=0`} title={t('docs.pv.of', { name })} onLoad={() => setFramed(true)} />
      )}
      {state === 'ready' && kind === 'text' && url && (
        <iframe className="v2-docpv-frame" src={url} title={t('docs.pv.of', { name })} onLoad={() => setFramed(true)} />
      )}
      {state === 'ready' && kind === 'image' && url && (
        <img className="v2-docpv-img" src={url} alt={t('docs.pv.of', { name })} onError={() => setState('error')} />
      )}
      {state === 'ready' && kind === 'sheet' && sheet && (
        <div className="v2-docpv-sheet">
          <table>
            <tbody>
              {sheet.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c === '' ? '' : String(c)}</td>)}</tr>)}
            </tbody>
          </table>
          {sheet.rows.length === 0 && <p className="v2-muted v2-small">{t('docs.pv.emptySheet')}</p>}
          <p className="v2-muted v2-small">{t('docs.pv.sheetNote', { name: sheet.name || '—', n: sheet.count })}{sheet.moreRows > 0 ? ` ${t('docs.pv.moreRows', { n: sheet.moreRows })}` : ''}</p>
        </div>
      )}
      {state === 'none' && <div className="v2-docpv-msg"><span className="v2-sec">{t('docs.pv.none')}</span></div>}
      {state === 'error' && (
        <div className="v2-docpv-msg">
          <span className="v2-sec">{t('docs.pv.failed')}</span>
          {detail && <span className="v2-muted v2-small">{detail}</span>}
        </div>
      )}
    </div>
  )
}
