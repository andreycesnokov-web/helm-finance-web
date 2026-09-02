// Document preview — show the user the actual file, or say honestly why we cannot.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
// This is NOT OCR and NOT extraction. It renders the file the browser already knows
// how to render. Nothing here reads values off a document, and nothing it displays is
// ever written back to `extracted_json`. A spreadsheet table below is the file's own
// cells, shown verbatim — not parsed accounting data.
//
// ── HOW THE URL IS OBTAINED ──────────────────────────────────────────────────
// Through the caller's `getSignedUrl(doc, mode)` — the existing audited route
// POST /api/documents/:id/signed-url. No new route, and the component never holds a
// storage path. `mode: 'download'` is the same route's existing download flag.
//
// ── FILE TYPE vs DOCUMENT TYPE ───────────────────────────────────────────────
// `document_type` (vendor_invoice, npwp…) is ACCOUNTING meaning and is deliberately
// never consulted here. Rendering is decided by MIME first, file extension second —
// the same precedence lib/documentPreview.js already uses.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Btn, Icon, LoadingSkeleton } from '../../shell/ui'
import { formatFileSize, formatUploadedAt, fileKindLabel } from '../../lib/documentPreview'
import './DocumentPreview.css'

/* ── renderable kind, MIME first then extension ───────────────────────────── */

const EXT_KIND = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', svg: 'image',
  csv: 'sheet', tsv: 'sheet', xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet',
  txt: 'text', md: 'text', json: 'text',
}

const extOf = (name) => (/\.([a-z0-9]{1,5})$/i.exec(String(name || ''))?.[1] || '').toLowerCase()

/**
 * @returns 'pdf' | 'image' | 'sheet' | 'text' | 'gsheet' | 'other'
 * MIME wins; a missing or generic MIME (very common for uploads) falls back to the
 * extension. Never guesses from the accounting document_type.
 */
export function previewKind(file = {}) {
  const mime = String(file.mime_type || '').toLowerCase().trim()
  const ext = extOf(file.file_name)

  // A real Google Sheets link, if the row ever carries one (see gsheetUrlOf).
  if (gsheetUrlOf(file)) return 'gsheet'

  if (mime && !/octet-stream/.test(mime)) {
    if (/^application\/pdf$/.test(mime)) return 'pdf'
    if (/^image\/(png|jpe?g|webp|gif|bmp|svg\+xml)$/.test(mime)) return 'image'
    if (/spreadsheet|excel|^text\/csv$|^text\/tab-separated/.test(mime)) return 'sheet'
    if (/^text\/(plain|markdown)$|^application\/json$/.test(mime)) return 'text'
    // A known-but-unrenderable MIME still gets the extension a chance below only if
    // the MIME told us nothing useful; otherwise it is genuinely unsupported.
    if (EXT_KIND[ext]) return EXT_KIND[ext]
    return 'other'
  }
  return EXT_KIND[ext] || 'other'
}

/**
 * A REAL Google Sheets URL, or null.
 * `financial_documents` has no external-URL column and the API file whitelist
 * (PUBLIC_FILE_FIELDS) returns none, so in practice this is always null today. It is
 * written as a genuine check rather than a hardcoded "unsupported" so that it starts
 * working the day such a field exists — and it never pretends to have one.
 */
export function gsheetUrlOf(file = {}) {
  const raw = file.external_url || file.source_url || file.web_url || null
  if (!raw || typeof raw !== 'string') return null
  return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(raw) ? raw : null
}

/* Spreadsheets are parsed in the browser; a huge file would freeze the tab. */
const MAX_SHEET_BYTES = 4 * 1024 * 1024
/* Hard ceilings so the card can never sit on "Loading preview…" indefinitely. A hung
   signed-url call, a storage request that never settles, or an <object> that neither
   loads nor errors all resolve to an honest fallback instead. */
const URL_TIMEOUT_MS = 12000
const EMBED_TIMEOUT_MS = 15000
const MAX_ROWS = 50
const MAX_COLS = 12

/** Reject a promise that never settles, so "loading" is always a temporary state. */
function withTimeout(promise, ms, message) {
  let t
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms) }),
  ])
}

/* ── the component ────────────────────────────────────────────────────────── */

/**
 * @param doc            the financial_documents row (with .file)
 * @param getSignedUrl   (doc, mode) => Promise<string>  — the existing audited route
 * @param compact        smaller frame for tight columns
 * @param autoLoad       fetch the URL on mount (panels do; collapsed rows should not)
 */
export default function DocumentPreview({ doc, getSignedUrl, compact = false, autoLoad = true }) {
  const file = doc?.file || {}
  const kind = previewKind(file)
  const gsheet = gsheetUrlOf(file)

  // 'idle' | 'loading' | 'ready' | 'unavailable' | 'parse_error'
  const [state, setState] = useState('idle')
  const [url, setUrl] = useState(null)
  const [detail, setDetail] = useState(null)
  const [sheet, setSheet] = useState(null)          // { rows, cols, truncated, sheetName }
  const alive = useRef(true)
  // Guards against a slow response for a PREVIOUS row landing in the current panel.
  const reqFor = useRef(null)

  // MUST re-arm on mount, not only clear on unmount. React StrictMode (and any remount)
  // runs mount → cleanup → mount; a cleanup-only ref would leave `alive` false forever,
  // making every response look stale and freezing the card on "Loading preview…".
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const stale = (id) => !alive.current || reqFor.current !== id

  // Reset whenever the row changes, so a panel never shows the previous file.
  useEffect(() => {
    setState('idle'); setUrl(null); setSheet(null); setDetail(null)
  }, [doc?.id])

  const load = useCallback(async () => {
    if (!doc?.id || typeof getSignedUrl !== 'function') {
      setState('unavailable'); setDetail('No preview source is configured for this document.')
      return
    }
    const id = doc.id
    reqFor.current = id
    setState('loading'); setDetail(null)
    try {
      const signed = await withTimeout(getSignedUrl(doc, 'view'), URL_TIMEOUT_MS,
        'The document URL took too long to arrive.')
      if (stale(id)) return
      if (!signed) { setState('unavailable'); setDetail('The document URL could not be issued.'); return }
      setUrl(signed)

      if (kind === 'sheet') {
        await loadSheet(signed, id)
        return
      }
      setState('ready')
    } catch (e) {
      if (stale(id)) return
      setState('unavailable')
      setDetail(e?.message || 'The document could not be loaded.')
    }
  }, [doc, getSignedUrl, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // Spreadsheet preview is REAL: `xlsx` is already a client dependency (used by
  // BankImport), so no new package is introduced. It handles csv/tsv/xls/xlsx alike.
  const loadSheet = async (signed, id) => {
    try {
      const res = await withTimeout(fetch(signed), URL_TIMEOUT_MS,
        'Storage took too long to respond.')
      if (!res.ok) throw new Error(`Storage responded ${res.status}`)
      const buf = await withTimeout(res.arrayBuffer(), URL_TIMEOUT_MS,
        'Reading the file took too long.')
      if (stale(id)) return
      if (buf.byteLength > MAX_SHEET_BYTES) {
        setState('unavailable')
        setDetail('This spreadsheet is too large to preview in the browser. Open or download it instead.')
        return
      }
      const XLSX = await import('xlsx')
      const wb = XLSX.read(buf, { type: 'array', cellDates: false })
      const sheetName = wb.SheetNames?.[0]
      const ws = sheetName ? wb.Sheets[sheetName] : null
      if (!ws) throw new Error('The file contains no readable sheet')
      const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      const rows = all.slice(0, MAX_ROWS).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS) : []))
      // reduce(), not Math.max(...spread) — a sheet with tens of thousands of rows would
      // overflow the call stack on the spread.
      const widest = all.reduce((m, r) => (Array.isArray(r) && r.length > m ? r.length : m), 0)
      if (stale(id)) return
      setSheet({
        rows,
        truncatedRows: Math.max(0, all.length - rows.length),
        truncatedCols: Math.max(0, widest - MAX_COLS),
        sheetName: sheetName || null,
        sheetCount: wb.SheetNames?.length || 1,
      })
      setState('ready')
    } catch (e) {
      if (stale(id)) return
      // A CORS refusal is the realistic failure here, and it is not the user's fault.
      setState('parse_error')
      setDetail(/failed to fetch|networkerror|cors/i.test(e?.message || '')
        ? 'The browser was not allowed to read this file directly from storage.'
        : (e?.message || 'The spreadsheet could not be read.'))
    }
  }

  useEffect(() => {
    if (autoLoad && state === 'idle' && kind !== 'gsheet' && kind !== 'other') load()
  }, [autoLoad, state, kind, load])

  // An <object>/<iframe> can silently render nothing without firing load or error (a PDF
  // storage refuses to frame is the common case). Without this the stage would sit empty
  // and the user would never be told. `embedOk` flips true on the element's own load.
  const [embedOk, setEmbedOk] = useState(false)
  useEffect(() => { setEmbedOk(false) }, [url, doc?.id])
  useEffect(() => {
    const framed = kind === 'pdf' || kind === 'text'
    if (state !== 'ready' || !framed || !url || embedOk) return undefined
    const t = setTimeout(() => {
      setState('unavailable')
      setDetail('The document could not be displayed inline in this browser.')
    }, EMBED_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [state, kind, url, embedOk])

  const open = async (mode) => {
    try {
      const u = await getSignedUrl?.(doc, mode)
      if (u) window.open(u, '_blank', 'noopener')
    } catch (e) { setDetail(e?.message || 'Could not open the document.') }
  }

  const kindTag = fileKindLabel(file)
  const size = formatFileSize(file.file_size)
  const uploaded = formatUploadedAt(file.created_at || doc?.created_at)
  const name = file.file_name || doc?.document_number || 'Document'

  const actions = (
    <div className="dp-acts">
      <Btn sm variant="ghost" onClick={() => open('view')}>View document</Btn>
      <Btn sm variant="ghost" onClick={() => open('download')}>Download</Btn>
    </div>
  )

  const meta = (
    <div className="dp-meta">
      {kindTag && <span className="dp-tag">{kindTag}</span>}
      {size && <span>{size}</span>}
      {uploaded && <span>Uploaded {uploaded}</span>}
    </div>
  )

  return (
    <div className={`dp${compact ? ' dp--compact' : ''}`}>
      <div className="dp-stage">
        {state === 'loading' && (
          <div className="dp-msg">
            <LoadingSkeleton rows={compact ? 3 : 5} height={14} />
            <p className="dp-msg-text">Loading preview…</p>
          </div>
        )}

        {state === 'idle' && (kind === 'gsheet' || kind === 'other') && (
          <FileCard name={name} kindTag={kindTag}
            text={kind === 'gsheet'
              ? 'This document links to Google Sheets.'
              : 'No inline preview for this file type.'} />
        )}

        {state === 'idle' && kind !== 'gsheet' && kind !== 'other' && (
          <div className="dp-msg">
            <p className="dp-msg-text">Preview not loaded.</p>
            <Btn sm variant="ghost" onClick={load}>Load preview</Btn>
          </div>
        )}

        {state === 'ready' && kind === 'pdf' && url && (
          // A PDF that storage refuses to frame renders as an empty box; the fallback
          // actions below the stage always remain, so there is never a dead end.
          <object className="dp-frame" data={url} type="application/pdf" aria-label={`Preview of ${name}`}
            onLoad={() => setEmbedOk(true)}
            onError={() => { setState('unavailable'); setDetail('This browser could not display the PDF inline.') }}>
            <div className="dp-msg">
              <p className="dp-msg-text">This browser cannot display the PDF inline.</p>
              {actions}
            </div>
          </object>
        )}

        {state === 'ready' && kind === 'image' && url && (
          <img className="dp-img" src={url} alt={`Preview of ${name}`}
            onError={() => { setState('unavailable'); setDetail('The image could not be displayed.') }} />
        )}

        {state === 'ready' && kind === 'text' && url && (
          <iframe className="dp-frame" src={url} title={`Preview of ${name}`}
            onLoad={() => setEmbedOk(true)}
            onError={() => { setState('unavailable'); setDetail('This browser could not display the file inline.') }} />
        )}

        {state === 'ready' && kind === 'sheet' && sheet && (
          <div className="dp-sheet">
            <table className="dp-table">
              <tbody>
                {sheet.rows.map((row, i) => (
                  <tr key={i} className={i === 0 ? 'is-head' : ''}>
                    {row.map((cell, j) => <td key={j}>{cell === '' ? '' : String(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {sheet.rows.length === 0 && <p className="dp-msg-text">This sheet has no rows.</p>}
          </div>
        )}

        {state === 'unavailable' && (
          <FileCard name={name} kindTag={kindTag}
            text="Preview unavailable. You can still open or download the document."
            detail={detail} />
        )}

        {state === 'parse_error' && (
          <FileCard name={name} kindTag={kindTag}
            text="Spreadsheet preview could not be read." detail={detail} />
        )}
      </div>

      <div className="dp-foot">
        <span className="dp-name" title={name}>{name}</span>
        {meta}
        {kind === 'gsheet' && gsheet ? (
          <div className="dp-acts">
            <a className="dp-link" href={gsheet} target="_blank" rel="noopener noreferrer">Open in Google Sheets</a>
          </div>
        ) : actions}
      </div>

      {/* Honest limits, stated once and only where they apply. */}
      {kind === 'sheet' && state === 'ready' && sheet && (
        <p className="dp-note">
          Showing the file’s own cells{sheet.sheetName ? ` from “${sheet.sheetName}”` : ''}
          {sheet.sheetCount > 1 ? ` (first of ${sheet.sheetCount} sheets)` : ''}
          {sheet.truncatedRows > 0 ? ` · first ${sheet.rows.length} rows, ${sheet.truncatedRows} more not shown` : ''}
          {sheet.truncatedCols > 0 ? ` · ${sheet.truncatedCols} more columns not shown` : ''}.
          Nothing here is read into accounting fields.
        </p>
      )}
      {kind === 'gsheet' && !gsheet && (
        <p className="dp-note">Google Sheets preview requires Drive/Sheets integration.</p>
      )}
      {kind === 'other' && (
        <p className="dp-note">
          No inline preview exists for this file type. You can still open or download it.
        </p>
      )}
    </div>
  )
}

/* ── fallback card — always offers a way to reach the real file ───────────── */
function FileCard({ name, kindTag, text, detail }) {
  return (
    <div className="dp-msg">
      <span className="dp-file-ic"><Icon.doc width="20" height="20" aria-hidden="true" /></span>
      <p className="dp-msg-text">{text}</p>
      {detail && <p className="dp-msg-detail">{detail}</p>}
      <span className="dp-msg-file">{kindTag ? `${kindTag} · ` : ''}{name}</span>
    </div>
  )
}
