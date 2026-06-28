// Personal Account Dashboard (Phase 2) — UI for the dark /api/personal/* backend.
// Gated by VITE_PERSONAL_ACCOUNT_V1_ENABLED; rendered inside /account above the
// (secondary) Business workspaces block. Personal balance, MTD income/expense,
// net saved, CFO-Lite insight, wallets, recent transactions, and add modals.
//
// Uses RAW fetch with Authorization only — deliberately NOT apiFetch, which would
// attach x-business-id from localStorage and trip the backend's "personal route
// rejects a business id" guard. Personal endpoints are workspace-self-resolving.
import { useState, useEffect } from 'react'

const WALLET_TYPES = [
  ['cash', 'Cash'], ['bank', 'Bank'], ['card', 'Card'], ['ewallet', 'E-wallet'],
  ['wise_paypal', 'Wise / PayPal'], ['other', 'Other'],
]

function money(n, cur = 'IDR') {
  const v = Number(n || 0)
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v) }
  catch { return `${cur} ${v.toLocaleString('en-US')}` }
}

export default function PersonalDashboard({ token }) {
  const [summary, setSummary] = useState(null)
  const [wallets, setWallets] = useState([])
  const [cats, setCats] = useState({ income: [], expense: [], business_related: [] })
  const [loading, setLoading] = useState(true)
  const [disabled, setDisabled] = useState(false) // backend flag off → 404
  const [error, setError] = useState('')
  const [showTx, setShowTx] = useState(false)
  const [showWallet, setShowWallet] = useState(false)

  const pf = (path, opts = {}) => fetch(`/api/personal${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  const load = async () => {
    setLoading(true); setError('')
    try {
      const sRes = await pf('/summary') // first call provisions the personal workspace
      if (sRes.status === 404) { setDisabled(true); return } // backend flag off
      const s = await sRes.json()
      const [w, c] = await Promise.all([
        pf('/wallets').then(r => r.json()).catch(() => ({})),
        pf('/categories').then(r => r.json()).catch(() => ({})),
      ])
      setSummary(s)
      setWallets(Array.isArray(w.wallets) ? w.wallets : [])
      setCats({ income: c.income || [], expense: c.expense || [], business_related: c.business_related || [] })
    } catch { setError('Could not load personal finance.') } finally { setLoading(false) }
  }
  useEffect(() => { if (token) load() }, [token]) // eslint-disable-line

  const baseCur = summary?.workspace?.base_currency || 'IDR'

  const card = { border: '1px solid var(--border-2,#e3e8ee)', borderRadius: 14, padding: 18, background: 'var(--bg,#fff)' }
  const primary = { padding: '12px 16px', borderRadius: 10, border: 'none', background: 'var(--brand,#3399FF)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
  const ghost = { padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'none', color: 'var(--text,#111)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }
  const stat = { flex: 1, minWidth: 0, padding: '12px 14px', borderRadius: 10, background: 'var(--bg-2,#f7f9fb)', textAlign: 'center' }
  const statLbl = { fontSize: 11, color: 'var(--text-3,#888)', textTransform: 'uppercase', letterSpacing: 0.4 }
  const statVal = { fontSize: 16, fontWeight: 700, marginTop: 4, color: 'var(--text,#111)' }

  if (loading) return <div style={{ ...card, textAlign: 'center', color: 'var(--text-3,#777)' }}>Loading personal finance…</div>
  if (disabled) return null // backend gate off → hide silently (business block still shows)
  if (error) return <div style={{ ...card, color: 'var(--red-dark,#b3261e)' }}>{error} <button style={{ ...ghost, marginLeft: 8, padding: '4px 10px' }} onClick={load}>Retry</button></div>

  const hasWallet = wallets.length > 0
  const recent = summary?.recent || []
  const t = summary?.totals || {}
  const insight = summary?.insight || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      {/* Balance + stats */}
      <div style={card}>
        <div style={{ fontSize: 12, color: 'var(--text-3,#888)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Total personal balance</div>
        <div style={{ fontSize: 30, fontWeight: 800, margin: '4px 0 14px', color: 'var(--text,#111)' }}>{money(t.balance, baseCur)}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={stat}><div style={statLbl}>Income (mo)</div><div style={{ ...statVal, color: 'var(--green-dark,#1a7f37)' }}>{money(t.income_mtd, baseCur)}</div></div>
          <div style={stat}><div style={statLbl}>Expenses (mo)</div><div style={{ ...statVal, color: 'var(--red-dark,#b3261e)' }}>{money(t.expense_mtd, baseCur)}</div></div>
          <div style={stat}><div style={statLbl}>Net saved</div><div style={statVal}>{money(t.net_saved, baseCur)}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button style={{ ...primary, flex: 1 }} onClick={() => setShowTx(true)} disabled={!hasWallet}>+ Add transaction</button>
          <button style={{ ...ghost, flex: 1 }} onClick={() => setShowWallet(true)}>+ Add wallet</button>
        </div>
        {!hasWallet && <div style={{ fontSize: 12, color: 'var(--text-4,#999)', marginTop: 8, textAlign: 'center' }}>Add a wallet first to start tracking transactions.</div>}
      </div>

      {/* CFO AI Lite insight */}
      {hasWallet && (
        <div style={{ ...card, background: 'var(--bg-2,#f7f9fb)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand,#3399FF)', marginBottom: 6 }}>CFO AI · Lite</div>
          <div style={{ fontSize: 13, color: 'var(--text-2,#555)', lineHeight: 1.5 }}>
            {insight.spending_faster
              ? 'You are spending faster than the same point last month.'
              : 'Your spending is on track vs last month.'}
            {insight.vs_last_month_pct != null && ` (${insight.vs_last_month_pct > 0 ? '+' : ''}${insight.vs_last_month_pct}% vs last month)`}
            {' '}Safe to spend this month: <b>{money(insight.safe_to_spend, baseCur)}</b>.
          </div>
          {Array.isArray(insight.top_categories) && insight.top_categories.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3,#888)', marginTop: 8 }}>
              Top: {insight.top_categories.map(c => `${c.name} (${money(c.amount, baseCur)})`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* Wallets */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Wallets</div>
          <button style={{ ...ghost, padding: '6px 12px' }} onClick={() => setShowWallet(true)}>+ Add</button>
        </div>
        {!hasWallet ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Create your first personal wallet</div>
            <button style={primary} onClick={() => setShowWallet(true)}>+ Add personal wallet</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {wallets.map(w => (
              <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2,#f7f9fb)' }}>
                <span><span style={{ fontWeight: 600, fontSize: 14 }}>{w.name}</span><span style={{ color: 'var(--text-3,#888)', fontSize: 12, marginLeft: 8 }}>{(WALLET_TYPES.find(x => x[0] === w.type) || [, w.type])[1]}</span></span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{money(w.balance, w.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent transactions */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Recent transactions</div>
        {recent.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 14, color: 'var(--text-3,#777)', marginBottom: 10 }}>Your personal transactions will appear here</div>
            <button style={primary} onClick={() => setShowTx(true)} disabled={!hasWallet}>+ Add transaction</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.map(tx => (
              <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, borderBottom: '1px solid var(--border-2,#eef1f5)' }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 14, color: 'var(--text,#111)' }}>{tx.category || tx.description || (tx.source?.startsWith('xfer:') ? 'Transfer' : '—')}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3,#888)' }}>{tx.transaction_date || ''}</span>
                </span>
                <span style={{ fontWeight: 700, fontSize: 14, color: tx.type === 'income' ? 'var(--green-dark,#1a7f37)' : 'var(--text,#111)' }}>
                  {tx.type === 'income' ? '+' : '−'}{money(tx.amount_original, tx.currency_original || baseCur)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showWallet && <WalletModal pf={pf} baseCur={baseCur} onClose={() => setShowWallet(false)} onSaved={() => { setShowWallet(false); load() }} />}
      {showTx && <TxModal pf={pf} wallets={wallets} cats={cats} onClose={() => setShowTx(false)} onSaved={() => { setShowTx(false); load() }} />}
    </div>
  )
}

// ── Add Wallet modal ─────────────────────────────────────────────────────────
function WalletModal({ pf, baseCur, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', type: 'cash', currency: baseCur, color: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const res = await pf('/wallets', { method: 'POST', body: { name: form.name, type: form.type, currency: form.currency, color: form.color || undefined } })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(d.message || d.error || 'Could not add wallet.'); return }
      onSaved()
    } catch { setErr('Network error.') } finally { setBusy(false) }
  }
  return <Modal title="Add personal wallet" onClose={onClose}>
    <form onSubmit={submit}>
      <Field label="NAME"><input style={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cash, BCA, Wise" autoFocus /></Field>
      <Field label="TYPE"><select style={inp} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{WALLET_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="CURRENCY"><input style={inp} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} placeholder="IDR" maxLength={5} /></Field>
      {err && <div style={{ color: 'var(--red-dark,#b3261e)', fontSize: 13, marginTop: 8 }}>{err}</div>}
      <ModalActions busy={busy} onClose={onClose} label="Add wallet" />
    </form>
  </Modal>
}

// ── Add Transaction modal ────────────────────────────────────────────────────
function TxModal({ pf, wallets, cats, onClose, onSaved }) {
  const [kind, setKind] = useState('expense')
  const [form, setForm] = useState({ amount: '', wallet_id: wallets[0]?.id || '', to_wallet_id: '', category: '', date: new Date().toISOString().slice(0, 10), note: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const catList = kind === 'income' ? cats.income : [...cats.expense, ...cats.business_related]
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const body = { kind, amount: Number(form.amount), wallet_id: form.wallet_id, date: form.date, note: form.note || undefined }
      if (kind === 'transfer') body.to_wallet_id = form.to_wallet_id
      else body.category = form.category || undefined
      const res = await pf('/transactions', { method: 'POST', body })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(d.message || d.error || 'Could not add transaction.'); return }
      onSaved()
    } catch { setErr('Network error.') } finally { setBusy(false) }
  }
  const seg = (v, l) => <button type="button" onClick={() => setKind(v)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid var(--border-2,#ccc)', background: kind === v ? 'var(--brand,#3399FF)' : 'none', color: kind === v ? '#fff' : 'var(--text,#111)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>{l}</button>
  return <Modal title="Add transaction" onClose={onClose}>
    <form onSubmit={submit}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>{seg('expense', 'Expense')}{seg('income', 'Income')}{seg('transfer', 'Transfer')}</div>
      <Field label="AMOUNT"><input style={inp} type="number" min="0" step="any" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" autoFocus /></Field>
      <Field label={kind === 'transfer' ? 'FROM WALLET' : 'WALLET'}><select style={inp} value={form.wallet_id} onChange={e => setForm({ ...form, wallet_id: e.target.value })}>{wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      {kind === 'transfer'
        ? <Field label="TO WALLET"><select style={inp} value={form.to_wallet_id} onChange={e => setForm({ ...form, to_wallet_id: e.target.value })}><option value="">—</option>{wallets.filter(w => w.id !== form.wallet_id).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        : <Field label="CATEGORY"><select style={inp} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="">—</option>{catList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></Field>}
      <Field label="DATE"><input style={inp} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
      <Field label="NOTE"><input style={inp} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Optional" /></Field>
      {err && <div style={{ color: 'var(--red-dark,#b3261e)', fontSize: 13, marginTop: 8 }}>{err}</div>}
      <ModalActions busy={busy} onClose={onClose} label="Add transaction" />
    </form>
  </Modal>
}

// ── Small shared modal primitives ────────────────────────────────────────────
const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'var(--bg,#fff)', color: 'var(--text,#111)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
function Field({ label, children }) {
  return <div style={{ marginBottom: 10 }}><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2,#555)', display: 'block', marginBottom: 6 }}>{label}</label>{children}</div>
}
function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: 'var(--bg,#fff)', borderRadius: 14, padding: 20, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-3,#888)', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
function ModalActions({ busy, onClose, label }) {
  return <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
    <button type="submit" disabled={busy} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: 'var(--brand,#3399FF)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{busy ? 'Saving…' : label}</button>
    <button type="button" onClick={onClose} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>Cancel</button>
  </div>
}
