import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt, fmtFull } from '../lib/api'

// ── Wallet type config ────────────────────────────────────────────────────────
const WALLET_TYPES = [
  { value: 'bank',            label: 'Bank account' },
  { value: 'cash',            label: 'Cash' },
  { value: 'ewallet',         label: 'E-Wallet' },
  { value: 'alipay',          label: 'Alipay' },
  { value: 'wechat_pay',      label: 'WeChat Pay' },
  { value: 'crypto',          label: 'Crypto wallet' },
  { value: 'payment_gateway', label: 'Payment gateway' },
  { value: 'other',           label: 'Other' },
  { value: '__custom__',      label: '✏️ Custom type…', adminOnly: true },
]

const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'THB', 'CNY']

const TYPE_ICON = {
  bank: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
  ),
  cash: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="M6 12h.01M18 12h.01"/>
    </svg>
  ),
  ewallet: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <line x1="12" y1="18" x2="12.01" y2="18"/>
    </svg>
  ),
  alipay: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M9 9h6M9 12h6"/>
      <path d="M7 15c2 1 8 2 10 0"/>
    </svg>
  ),
  wechat_pay: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <line x1="9" y1="10" x2="9.01" y2="10"/>
      <line x1="15" y1="10" x2="15.01" y2="10"/>
    </svg>
  ),
  crypto: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M9 8h4a2 2 0 0 1 0 4H9zm0 4h4.5a2 2 0 0 1 0 4H9z"/>
      <line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="18"/>
    </svg>
  ),
  payment_gateway: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  other: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
}

const CURRENCY_STYLE = {
  IDR: { bg: '#E1F5EE', color: '#085041' },
  USD: { bg: '#EEF2FF', color: '#3730a3' },
  EUR: { bg: '#FEF3C7', color: '#92400E' },
  SGD: { bg: '#FDE8FF', color: '#7E22CE' },
  MYR: { bg: '#FFF1F2', color: '#9F1239' },
  THB: { bg: '#F0F9FF', color: '#0369A1' },
  CNY: { bg: '#FFF1F0', color: '#991B1B' },
}

const getCurrencyStyle = (currency) => CURRENCY_STYLE[currency] || { bg: '#F1F5F9', color: '#475569' }
const getTypeIcon      = (type, color) => (TYPE_ICON[type] || TYPE_ICON.other)(color)

// ── Default form state ────────────────────────────────────────────────────────
const EMPTY_FORM = { name: '', currency: 'IDR', type: '', entity_name: '', opening_balance: '', sort_order: 0, custom_type: '', scope: 'business' }

export default function Accounts() {
  const { token } = useAuth()
  const { access } = useAccess()
  const navigate = useNavigate()
  const { t } = useTranslation()

  // Only owner/admin can adjust wallet balances
  const canAdjust = ['owner', 'admin'].includes(access?.membership?.role)

  const [wallets,      setWallets]      = useState([])
  const [legacySources,setLegacySources]= useState([]) // source-based accounts not yet in wallets
  const [loading,      setLoading]      = useState(true)
  const [showForm,     setShowForm]     = useState(false)
  const [editWallet,   setEditWallet]   = useState(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [scopeTab,     setScopeTab]     = useState('all')
  const [saving,       setSaving]       = useState(false)
  const [backfilling,  setBackfilling]  = useState(false)
  const [backfillDone, setBackfillDone] = useState(false)

  // ── Admin ─────────────────────────────────────────────────────────────────
  const [isAdmin,      setIsAdmin]      = useState(false)
  const [adjustWallet, setAdjustWallet] = useState(null) // wallet being adjusted
  const today = new Date().toISOString().slice(0, 10)
  const [adjustForm,   setAdjustForm]   = useState({ target_balance: '', reason: '', transaction_date: today })
  const [adjusting,    setAdjusting]    = useState(false)

  // ── Load wallets + legacy sources ─────────────────────────────────────────
  const load = async () => {
    setLoading(true)
    try {
      const [wData, pData] = await Promise.all([
        apiFetch('/wallets', token),
        apiFetch('/pulse?scope=all', token),
      ])

      const loaded = wData.wallets || []
      setWallets(loaded)

      // Legacy: source-based virtual accounts not yet migrated to wallets
      const walletNames = new Set(loaded.map(w => w.name))
      const legacy = (pData.accounts || []).filter(a => !walletNames.has(a.name))
      setLegacySources(legacy)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Load admin status silently — non-blocking, never errors visibly
    apiFetch('/admin/status', token)
      .then(d => { setIsAdmin(d.is_admin === true); console.log('[admin/status]', d) })
      .catch(e => console.warn('[admin/status] failed:', e.message))
  }, [])

  // ── Computed totals ───────────────────────────────────────────────────────
  const totalBalance    = wallets.reduce((s, w) => s + (w.balance || 0), 0)
  const businessBalance = wallets.filter(w => (w.scope || 'business') === 'business').reduce((s, w) => s + (w.balance || 0), 0)
  const personalBalance = wallets.filter(w => w.scope === 'personal').reduce((s, w) => s + (w.balance || 0), 0)

  // Filtered wallets per tab
  const filteredWallets = scopeTab === 'all'
    ? wallets
    : wallets.filter(w => (w.scope || 'business') === scopeTab)

  const filteredBalance = scopeTab === 'all' ? totalBalance
    : scopeTab === 'business' ? businessBalance
    : personalBalance

  // ── Backfill handler ──────────────────────────────────────────────────────
  const handleBackfill = async () => {
    if (!window.confirm('Import your existing account names as wallets? You can edit them afterwards.')) return
    setBackfilling(true)
    try {
      const r = await apiFetch('/wallets/backfill', token, { method: 'POST', body: {} })
      setBackfillDone(true)
      await load()
      if (r.created === 0) alert('All existing accounts are already in your wallet list.')
    } catch (e) {
      alert(e.message)
    } finally {
      setBackfilling(false)
    }
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditWallet(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (w) => {
    setEditWallet(w)
    const knownType = WALLET_TYPES.find(t => t.value === w.type && t.value !== '__custom__')
    setForm({
      name: w.name, currency: w.currency || 'IDR',
      type: knownType ? w.type : (w.type ? '__custom__' : ''),
      custom_type: knownType ? '' : (w.type || ''),
      entity_name: w.entity_name || '', opening_balance: '', sort_order: w.sort_order || 0,
      scope: w.scope || 'business',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      // Resolve custom type: if __custom__ selected, use the custom_type text
      const resolvedType = form.type === '__custom__'
        ? (form.custom_type.trim() || null)
        : (form.type || null)

      if (editWallet) {
        await apiFetch(`/wallets/${editWallet.id}`, token, {
          method: 'PUT',
          body: { name: form.name, currency: form.currency, type: resolvedType, entity_name: form.entity_name || null, scope: form.scope || 'business' },
        })
      } else {
        await apiFetch('/wallets', token, {
          method: 'POST',
          body: {
            name:            form.name,
            currency:        form.currency,
            type:            resolvedType,
            entity_name:     form.entity_name || null,
            opening_balance: Number(form.opening_balance) || 0,
            sort_order:      wallets.length,
            scope:           form.scope || 'business',
          },
        })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Adjust balance (admin only) ───────────────────────────────────────────
  const openAdjust = (w) => {
    setAdjustWallet(w)
    setAdjustForm({ target_balance: '', reason: '', transaction_date: today })
  }

  const handleAdjust = async () => {
    if (!adjustWallet) return
    const targetNum = Number(adjustForm.target_balance)
    if (isNaN(targetNum) || adjustForm.target_balance === '') return
    if (!adjustForm.reason.trim()) return
    setAdjusting(true)
    try {
      const r = await apiFetch(`/wallets/${adjustWallet.id}/adjust-balance`, token, {
        method: 'POST',
        body: {
          target_balance:   targetNum,
          reason:           adjustForm.reason.trim(),
          transaction_date: adjustForm.transaction_date || undefined,
        },
      })
      if (r.delta === 0) {
        alert('Balance is already at target — no correction needed.')
      } else {
        const sign = r.delta > 0 ? '+' : ''
        alert(`Done. Delta: ${sign}${r.delta.toLocaleString('id')} ${adjustWallet.currency}.\nTransaction ID: ${r.transaction_id}`)
      }
      setAdjustWallet(null)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setAdjusting(false)
    }
  }

  const handleDelete = async () => {
    if (!editWallet) return
    if (!window.confirm(`Archive "${editWallet.name}"? The wallet will be hidden. Transactions are not deleted.`)) return
    setSaving(true)
    try {
      await apiFetch(`/wallets/${editWallet.id}`, token, { method: 'DELETE' })
      setShowForm(false)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="hf-page">

      {/* Page header */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">{t('accounts.walletsAccounts')}</div>
          <div className="hf-page-subtitle">{t('accounts.walletsSubtitle')}</div>
        </div>
        <div className="hf-page-actions">
          <button onClick={openAdd} className="btn btn-primary btn-md">{t('accounts.addWallet')}</button>
        </div>
      </div>

      {/* Scope tabs */}
      {wallets.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {['all', 'business', 'personal'].map(s => (
            <button
              key={s}
              onClick={() => setScopeTab(s)}
              style={{
                padding: '7px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                border: '1px solid var(--border-2)', fontFamily: 'inherit', cursor: 'pointer',
                background: scopeTab === s ? 'var(--text)' : 'var(--bg-2)',
                color:      scopeTab === s ? 'var(--bg)'   : 'var(--text-2)',
                transition: 'all .15s',
              }}
            >
              {s === 'all' ? t('common.all') : s === 'business' ? t('common.business') : t('common.personal')}
            </button>
          ))}
        </div>
      )}

      {/* Total balance hero */}
      {wallets.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)', borderRadius: 20, padding: '24px 26px 20px', boxShadow: '0 8px 32px rgba(15,23,42,.22)', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 0.03, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 28px, #fff 28px, #fff 29px), repeating-linear-gradient(90deg, transparent, transparent 28px, #fff 28px, #fff 29px)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>
              {scopeTab === 'business' ? t('accounts.totalBusiness') : scopeTab === 'personal' ? t('accounts.totalPersonal') : t('accounts.totalBalance')}
            </div>
            <div style={{ fontSize: 'clamp(28px, 9vw, 38px)', fontWeight: 800, color: '#fff', letterSpacing: -1, lineHeight: 1, wordBreak: 'break-word' }}>
              {fmtFull(filteredBalance)}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>IDR · {filteredWallets.length} wallet{filteredWallets.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--text-sm)' }}>{t('accounts.loadingWallets')}</div>
      )}

      {/* Backfill banner — only when legacy accounts exist and no wallets yet */}
      {!loading && wallets.length === 0 && legacySources.length > 0 && !backfillDone && (
        <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 14, padding: '16px 18px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>💡</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#3730a3', marginBottom: 4 }}>
              {t('accounts.youHaveAccounts').replace('{n}', legacySources.length).replace('{s}', legacySources.length !== 1 ? 's' : '')}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: '#4338ca', lineHeight: 1.5, marginBottom: 12 }}>
              {t('accounts.importSub')}
            </div>
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              style={{ padding: '8px 16px', borderRadius: 8, background: '#4338ca', color: '#fff', border: 'none', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {backfilling ? t('accounts.importing') : t('accounts.importAccounts').replace('{n}', legacySources.length).replace('{s}', legacySources.length !== 1 ? 's' : '')}
            </button>
          </div>
        </div>
      )}

      {/* Empty state — no wallets and no legacy */}
      {!loading && wallets.length === 0 && legacySources.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🏦</div>
          <div className="empty-state-title">{t('accounts.noWallets')}</div>
          <div className="empty-state-sub">
            {t('accounts.noWalletsSub')}
          </div>
          <button className="empty-state-cta" onClick={openAdd}>{t('accounts.addFirstWallet')}</button>
        </div>
      )}

      {/* Wallet cards */}
      {wallets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {filteredWallets.map((w) => {
            const cs    = getCurrencyStyle(w.currency)
            const isNeg = (w.balance || 0) < 0
            const pct   = filteredBalance > 0 ? Math.round(((w.balance || 0) / filteredBalance) * 100) : 0
            const typeLabel = WALLET_TYPES.find(t => t.value === w.type && t.value !== '__custom__')?.label || (w.type ? w.type : null)
            const walletScope = w.scope || 'business'

            return (
              <div key={w.id} className="hf-card" onClick={() => navigate(`/accounts/${w.id}`)} style={{ cursor: 'pointer', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* Icon */}
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: cs.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {getTypeIcon(w.type, cs.color)}
                  </div>

                  {/* Name + badges */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{w.name}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: cs.bg, color: cs.color, fontWeight: 700 }}>{w.currency}</span>
                      {typeLabel && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: 'var(--bg-2)', color: 'var(--text-3)', fontWeight: 600 }}>{typeLabel}</span>}
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 20, fontWeight: 700,
                        background: walletScope === 'business' ? '#EEF2FF' : '#FDF2FF',
                        color:      walletScope === 'business' ? '#3730a3' : '#7E22CE',
                      }}>
                        {walletScope === 'business' ? t('accounts.scopeBusiness') : t('accounts.scopePersonal')}
                      </span>
                    </div>
                  </div>

                  {/* Balance */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 'var(--text-base)', fontWeight: 800, color: isNeg ? 'var(--red-dark)' : 'var(--text)', letterSpacing: -0.3, lineHeight: 1, whiteSpace: 'nowrap' }}>
                      {isNeg ? '−' : ''}{fmt(Math.abs(w.balance || 0))}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3, whiteSpace: 'nowrap' }}>{Math.abs(pct)}{t('accounts.share')}</div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0, marginLeft: 4 }}>
                    {canAdjust && (
                      <button onClick={(e) => { e.stopPropagation(); openAdjust(w) }} title="Adjust balance" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: 'var(--text-2)', fontFamily: 'inherit' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); openEdit(w) }} style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Share bar */}
                <div style={{ height: 3, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden', marginTop: 10 }}>
                  <div style={{ height: '100%', borderRadius: 3, background: isNeg ? 'var(--red)' : cs.color, width: `${Math.max(2, Math.min(100, Math.abs(pct)))}%`, transition: 'width .3s' }} />
                </div>
              </div>
            )
          })}

          {/* Add wallet row */}
          <div
            className="hf-card"
            onClick={openAdd}
            style={{ border: '1.5px dashed var(--border-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px' }}
          >
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', fontWeight: 500 }}>{t('accounts.addWallet')}</div>
          </div>
        </div>
      )}

      {/* Legacy unmatched sources */}
      {!loading && wallets.length > 0 && legacySources.length > 0 && (
        <div className="hf-card" style={{ marginBottom: 16, background: 'var(--bg-2)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: 10 }}>{t('accounts.legacyTitle')}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 }}>
            {t('accounts.legacySub')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {legacySources.map(a => (
              <span key={a.id} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-3)', color: 'var(--text-2)', fontWeight: 600 }}>{a.name}</span>
            ))}
          </div>
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--text)', color: 'var(--bg)', border: 'none', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {backfilling ? t('accounts.importing') : t('accounts.importAsWallets')}
          </button>
        </div>
      )}

      {/* Info card */}
      <div className="hf-card" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: 8 }}>{t('accounts.aboutWallets')}</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.6 }}>
          {t('accounts.aboutWalletsSub')}
        </div>
      </div>

      {/* ── Adjust Balance modal (admin only) ──────────────────────────────── */}
      {adjustWallet && createPortal(
        <div className="modal-overlay" onClick={() => setAdjustWallet(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-drag-handle" />
            <button className="modal-close-btn" onClick={() => setAdjustWallet(null)}>✕</button>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)' }}>{t('accounts.adjustBalance')}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>{adjustWallet.name}</div>
              </div>
            </div>

            {/* Info badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--text-3)', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px', marginBottom: 18 }}>
              {t('accounts.correctionInfo')}
            </div>

            {/* Current balance */}
            <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 4 }}>{t('accounts.currentBalance')}</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>
                {fmtFull(adjustWallet.balance || 0)}
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-3)', marginLeft: 6 }}>{adjustWallet.currency}</span>
              </div>
            </div>

            {/* Target balance */}
            <label className="modal-label">{t('accounts.targetBalance')} ({adjustWallet.currency})</label>
            <input
              type="number"
              className="modal-input"
              value={adjustForm.target_balance}
              onChange={e => setAdjustForm(p => ({ ...p, target_balance: e.target.value }))}
              placeholder="Enter target balance"
              style={{ marginBottom: 8 }}
              autoFocus
            />

            {/* Delta preview */}
            {adjustForm.target_balance !== '' && !isNaN(Number(adjustForm.target_balance)) && (() => {
              const delta = Number(adjustForm.target_balance) - (adjustWallet.balance || 0)
              if (delta === 0) return (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginBottom: 12 }}>No change needed — balance already at target.</div>
              )
              const isPos = delta > 0
              return (
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: isPos ? '#085041' : '#991B1B', background: isPos ? '#E1F5EE' : '#FEE2E2', borderRadius: 8, padding: '6px 12px', marginBottom: 12 }}>
                  Correction: {isPos ? '+' : ''}{delta.toLocaleString('id')} {adjustWallet.currency}
                </div>
              )
            })()}

            {/* Reason */}
            <label className="modal-label">{t('accounts.reason')} <span style={{ color: 'var(--red)', fontWeight: 700 }}>*</span></label>
            <input
              className="modal-input"
              value={adjustForm.reason}
              onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="e.g. Bank reconciliation, Opening balance fix"
              style={{ marginBottom: 14 }}
            />

            {/* Date */}
            <label className="modal-label">{t('accounts.transactionDate')}</label>
            <input
              type="date"
              className="modal-input"
              value={adjustForm.transaction_date}
              onChange={e => setAdjustForm(p => ({ ...p, transaction_date: e.target.value }))}
              style={{ marginBottom: 20 }}
            />

            <button
              disabled={
                adjusting ||
                adjustForm.target_balance === '' ||
                isNaN(Number(adjustForm.target_balance)) ||
                !adjustForm.reason.trim()
              }
              onClick={handleAdjust}
              className="btn btn-primary btn-block btn-lg"
              style={{ marginBottom: 8, background: '#92400E', borderColor: '#92400E' }}
            >
              {adjusting ? t('accounts.creatingCorrection') : t('accounts.createCorrection')}
            </button>
            <button onClick={() => setAdjustWallet(null)} className="btn btn-ghost btn-block btn-lg">
              {t('common.cancel')}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Add / Edit modal */}
      {showForm && createPortal(
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-drag-handle" />
            <button className="modal-close-btn" onClick={() => setShowForm(false)}>✕</button>

            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 18 }}>
              {editWallet ? `${t('accounts.editWallet')}${editWallet.name}` : t('accounts.addWallet')}
            </div>

            {/* Name */}
            <label className="modal-label">{t('accounts.walletName')}</label>
            <input
              className="modal-input"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. BCA IDR, Cash Office, Wise USD"
              style={{ marginBottom: 14 }}
              autoFocus
            />

            {/* Currency */}
            <label className="modal-label">{t('accounts.currency')}</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {CURRENCIES.map(c => {
                const cs = getCurrencyStyle(c)
                return (
                  <button key={c} onClick={() => setForm(p => ({ ...p, currency: c }))} style={{
                    padding: '8px 14px', borderRadius: 10, fontSize: 'var(--text-sm)',
                    border: '0.5px solid var(--border-2)', fontFamily: 'inherit', fontWeight: 700,
                    background: form.currency === c ? cs.bg : 'none',
                    color:      form.currency === c ? cs.color : 'var(--text-3)',
                    cursor: 'pointer', transition: 'all .1s',
                  }}>{c}</button>
                )
              })}
            </div>

            {/* Type */}
            <label className="modal-label">{t('accounts.type')} <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
            <select
              className="modal-input"
              value={form.type}
              onChange={e => setForm(p => ({ ...p, type: e.target.value, custom_type: '' }))}
              style={{ marginBottom: form.type === '__custom__' ? 8 : 14 }}
            >
              <option value="">{t('accounts.selectType')}</option>
              {WALLET_TYPES
                .filter(t => t.value !== '__custom__' || canAdjust)
                .map(t => <option key={t.value} value={t.value}>{t.label}</option>)
              }
            </select>

            {/* Custom type input — visible only when __custom__ selected (owner/admin only) */}
            {form.type === '__custom__' && canAdjust && (
              <>
                <input
                  className="modal-input"
                  value={form.custom_type}
                  onChange={e => setForm(p => ({ ...p, custom_type: e.target.value }))}
                  placeholder="e.g. Stripe, Dana, PayPal, USDT wallet…"
                  style={{ marginBottom: 6 }}
                  autoFocus
                />
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14 }}>
                  {t('accounts.customType')}
                </div>
              </>
            )}

            {/* Entity name */}
            <label className="modal-label">{t('accounts.company')} <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
            <input
              className="modal-input"
              value={form.entity_name}
              onChange={e => setForm(p => ({ ...p, entity_name: e.target.value }))}
              placeholder="e.g. PT Siberian BG, Personal"
              style={{ marginBottom: 14 }}
            />

            {/* Wallets created in the Business Workspace are always business-scoped.
                The Business/Personal selector was removed — Personal Workspace is gated
                off, so business pages must not create personal wallets. form.scope stays
                'business' (see EMPTY_FORM). */}

            {/* Opening balance — only for new wallets */}
            {!editWallet && (
              <>
                <label className="modal-label">{t('accounts.openingBalanceOpt')} <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
                <input
                  type="number"
                  className="modal-input"
                  value={form.opening_balance}
                  onChange={e => setForm(p => ({ ...p, opening_balance: e.target.value }))}
                  placeholder="0"
                  style={{ marginBottom: 18 }}
                />
              </>
            )}

            {editWallet && <div style={{ marginBottom: 18 }} />}

            <button
              disabled={!form.name.trim() || saving}
              onClick={handleSave}
              className="btn btn-primary btn-block btn-lg"
              style={{ marginBottom: 8 }}
            >
              {saving ? t('accounts.saving') : editWallet ? t('accounts.saveChanges') : t('accounts.addWallet')}
            </button>

            <button onClick={() => setShowForm(false)} className="btn btn-ghost btn-block btn-lg" style={{ marginBottom: editWallet ? 8 : 0 }}>
              {t('common.cancel')}
            </button>

            {editWallet && canAdjust && (
              <button
                onClick={() => { setShowForm(false); openAdjust(editWallet) }}
                disabled={saving}
                className="btn btn-block btn-lg"
                style={{ marginBottom: 8, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', fontWeight: 600 }}
              >
                {t('accounts.adjustBalance')}
              </button>
            )}

            {editWallet && (
              <button onClick={handleDelete} disabled={saving} className="btn btn-danger btn-block btn-lg">
                {t('accounts.archiveDelete')}
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
