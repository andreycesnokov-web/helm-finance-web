import { useId, useMemo, useRef, useState } from 'react'
import { useT, useLang } from '../i18n'
import { money, shortCalendarDate } from '../lib/format'
import { filterAndRankTransactions, transactionAmount, transactionCounterparty,
  transactionCurrency, transactionDate, transactionDirection } from '../lib/transactionPickerModel'

export function TransactionSummary({ tx, wallets = [], fullDescription = false }) {
  const t = useT()
  const lang = useLang()
  const wallet = wallets.find(w => String(w.id) === String(tx.wallet_id))
  const direction = transactionDirection(tx)
  const amount = transactionAmount(tx)
  const currency = transactionCurrency(tx)
  const counterparty = transactionCounterparty(tx)
  return <>
    <span className="v2-txp-main">
      <span className="v2-num">{shortCalendarDate(transactionDate(tx), lang)}</span>
      <span>{t(`docs.txPicker.direction.${direction}`)}</span>
      <strong className="v2-num">{currency && Number.isFinite(amount) ? money(amount, { currency, full: true, sign: false }) : '—'}</strong>
    </span>
    <span className="v2-txp-secondary">
      <span>{counterparty || t('docs.txPicker.unknownCounterparty')}</span>
      <span>{wallet?.name || t('docs.txPicker.unknownAccount')}</span>
    </span>
    <span className={`v2-txp-description${fullDescription ? ' is-full' : ''}`} title={tx.description || ''}>{tx.description || t('docs.txPicker.noDescription')}</span>
  </>
}

export default function TransactionPicker({ doc, transactions = [], wallets = [], counterparties = [],
  linkedIds = new Set(), linkedToCurrent = new Set(), statusComplete = false, loading = false, error = null,
  hasMore = false, onRetry, onLoadMore, value, onSelect, disabled = false, linkedHereLabel = null, linkedLabel = null }) {
  const t = useT()
  const listId = useId()
  const trigger = useRef(null)
  const searchRef = useRef(null)
  const optionsRef = useRef([])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [direction, setDirection] = useState('all')
  const [wallet, setWallet] = useState('all')
  const [unmatched, setUnmatched] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [limit, setLimit] = useState(60)
  const rows = useMemo(() => filterAndRankTransactions(transactions, doc,
    { search, from, to, direction, wallet, unmatched: statusComplete && unmatched }, counterparties, linkedIds),
  [transactions, doc, search, from, to, direction, wallet, unmatched, statusComplete, counterparties, linkedIds])
  const visible = rows.slice(0, limit)
  const activeFilterCount = Number(!!from) + Number(!!to) + Number(direction !== 'all')
    + Number(wallet !== 'all') + Number(unmatched && statusComplete)
  const selected = transactions.find(tx => String(tx.id) === String(value))
  const close = () => { setOpen(false); trigger.current?.focus() }
  const choose = tx => { if (linkedToCurrent.has(String(tx.id))) return; onSelect(String(tx.id)); close() }
  // Disabled rows remain visible as evidence, but must not trap arrow-key navigation.
  const focusOption = (start, step) => {
    for (let i = start; i >= 0 && i < visible.length; i += step) {
      const option = optionsRef.current[i]
      if (option && !option.disabled) { option.focus(); return }
    }
  }
  const move = (event, index) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : null
    if (next != null && visible.length) {
      event.preventDefault()
      focusOption(next, event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1)
    }
  }
  return <div className="v2-txp">
    <button ref={trigger} type="button" className="v2-btn v2-btn-secondary" disabled={disabled}
      aria-expanded={open} aria-controls={listId} onClick={() => { setOpen(!open); if (!open) setTimeout(() => searchRef.current?.focus(), 0) }}>
      {selected ? t('docs.txPicker.change') : t('docs.txPicker.open')}
    </button>
    {selected && !open && <div className="v2-txp-picked"><TransactionSummary tx={selected} wallets={wallets} /></div>}
    {open && <div id={listId} className="v2-txp-panel" onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    }}>
      <label className="v2-field"><span className="v2-field-label">{t('docs.txPicker.search')}</span>
        <input ref={searchRef} className="v2-input" type="search" value={search} placeholder={t('docs.txPicker.searchHint')}
          onChange={e => { setSearch(e.target.value); setLimit(60) }}
          onKeyDown={e => { if (e.key === 'ArrowDown' && visible.length) { e.preventDefault(); focusOption(0, 1) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }} /></label>
      <button type="button" className="v2-btn-link v2-txp-filter-toggle" aria-expanded={filtersOpen}
        aria-controls={`${listId}-filters`} onClick={() => setFiltersOpen(open => !open)}>
        {t('docs.txPicker.filters')}{activeFilterCount ? ` · ${activeFilterCount}` : ''}
      </button>
      <div id={`${listId}-filters`} className={`v2-txp-filter-body${filtersOpen ? ' is-open' : ''}`}>
      <div className="v2-txp-filters">
        <label className="v2-field"><span className="v2-field-label">{t('docs.txPicker.from')}</span><input className="v2-input" type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('docs.txPicker.to')}</span><input className="v2-input" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('docs.txPicker.directionLabel')}</span><select className="v2-select" value={direction} onChange={e => setDirection(e.target.value)}>
          <option value="all">{t('docs.txPicker.allDirections')}</option>{['in', 'out', 'transfer', 'other'].map(k => <option key={k} value={k}>{t(`docs.txPicker.direction.${k}`)}</option>)}
        </select></label>
        <label className="v2-field"><span className="v2-field-label">{t('docs.txPicker.account')}</span><select className="v2-select" value={wallet} onChange={e => setWallet(e.target.value)}>
          <option value="all">{t('docs.txPicker.allAccounts')}</option>{wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select></label>
      </div>
      <label className="v2-txp-check"><input type="checkbox" checked={unmatched && statusComplete} disabled={!statusComplete}
        onChange={e => setUnmatched(e.target.checked)} />{t('docs.txPicker.unmatched')}</label>
      {!statusComplete && <p className="v2-muted v2-small">{t('docs.txPicker.statusPartial')}</p>}
      </div>
      {loading && <p role="status">{t('docs.txPicker.loading')}</p>}
      {error && <p role="alert" className="v2-inline-err">{t('docs.txPicker.failed')} <button type="button" className="v2-btn-link" onClick={onRetry}>{t('docs.txPicker.retry')}</button></p>}
      {hasMore && <p className="v2-muted v2-small" role="status">{t('docs.txPicker.partialTransactions', { n: transactions.length })}</p>}
      {rows.length === 0 && !loading && !error && <p className="v2-muted" role="status">{hasMore ? t('docs.txPicker.emptyLoaded') : t('docs.txPicker.empty')}</p>}
      {rows.length > 0 && <>
            <p className="v2-muted v2-small" role="status">{t('docs.txPicker.count', { n: visible.length, total: rows.length })}</p>
            <ul className="v2-txp-results" aria-label={t('docs.txPicker.results')}>
              {visible.map((tx, i) => <li key={tx.id} className="v2-txp-result">
                <button ref={el => { optionsRef.current[i] = el }} type="button" className="v2-txp-option"
                  disabled={linkedToCurrent.has(String(tx.id))} aria-pressed={String(value) === String(tx.id)}
                  onKeyDown={e => move(e, i)} onClick={() => choose(tx)}>
                  <TransactionSummary tx={tx} wallets={wallets} />
                  <span className="v2-txp-status">{linkedToCurrent.has(String(tx.id)) ? (linkedHereLabel || t('docs.txPicker.linkedHere'))
                    : linkedIds.has(String(tx.id)) ? (linkedLabel || t('docs.txPicker.linked'))
                      : statusComplete ? t('docs.txPicker.unlinked') : t('docs.txPicker.unknownStatus')}</span>
                </button>
                {tx.description && <details className="v2-txp-details"><summary>{t('docs.txPicker.fullDescription')}</summary><p>{tx.description}</p></details>}
              </li>)}
            </ul>
            {rows.length > limit && <button type="button" className="v2-btn-link" onClick={() => setLimit(n => n + 60)}>{t('docs.txPicker.more')}</button>}
          </>}
      {hasMore && !loading && !error && <button type="button" className="v2-btn-link" onClick={onLoadMore}>{t('docs.txPicker.loadOlder')}</button>}
    </div>}
  </div>
}
