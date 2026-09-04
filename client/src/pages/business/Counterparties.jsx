// Counterparty Directory V1 — the financial memory for vendors and customers.
//
// WHAT THIS PAGE NEVER DOES:
//   * create a counterparty without an explicit click;
//   * merge two records. A likely duplicate is shown with its reasons and the user
//     chooses: use the existing one, or create anyway. Merging is irreversible in
//     practice, so it is not offered.
//
// Suggestions come from documents elsewhere in the app; this is the directory and
// the manual create/edit surface.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { PageHeader, Card, Btn, StatusBadge, Icon } from '../../shell/ui'
import './Counterparties.css'

const ROLES = [
  { value: '', label: 'Not set' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'customer', label: 'Customer' },
  { value: 'both', label: 'Vendor & customer' },
  { value: 'tax_authority', label: 'Tax authority' },
  { value: 'bank', label: 'Bank' },
  { value: 'employee', label: 'Employee' },
  { value: 'other', label: 'Other' },
]
const PKP = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'pkp', label: 'PKP' },
  { value: 'non_pkp', label: 'Non-PKP' },
]
const BLANK = {
  legal_name: '', display_name: '', role: '', npwp: '', pkp_status: 'unknown',
  address: '', email: '', phone: '', aliases: '', notes: '',
  default_category: '', default_tax_treatment: '',
  bank_name: '', account_number: '', account_name: '',
}

const roleLabel = (r) => (ROLES.find((x) => x.value === r) || {}).label || r || 'Not set'

export default function Counterparties() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [list, setList] = useState([])
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [dup, setDup] = useState(null)          // 409 payload awaiting a decision
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setBusy(true); setErr(null)
    try {
      const r = await apiFetch(`/counterparties${showArchived ? '?include_archived=true' : ''}`, token)
      setList(r.counterparties || [])
    } catch (e) { setErr(e.message || 'Could not load counterparties') }
    finally { setBusy(false) }
  }, [token, showArchived])

  useEffect(() => { load() }, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const body = (overrides = {}) => ({
    legal_name: form.legal_name.trim(),
    display_name: form.display_name.trim() || undefined,
    role: form.role || undefined,
    npwp: form.npwp.trim() || undefined,
    pkp_status: form.pkp_status || undefined,
    address: form.address.trim() || undefined,
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    notes: form.notes.trim() || undefined,
    default_category: form.default_category.trim() || undefined,
    default_tax_treatment: form.default_tax_treatment.trim() || undefined,
    aliases: form.aliases.split(',').map((a) => a.trim()).filter(Boolean),
    bank_accounts: form.account_number.trim()
      ? [{ bank_name: form.bank_name.trim() || null, account_number: form.account_number.trim(),
           account_name: form.account_name.trim() || null, is_primary: true }]
      : [],
    ...overrides,
  })

  const create = async (overrides = {}) => {
    if (!form.legal_name.trim()) { setErr('Legal name is required'); return }
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await apiFetch('/counterparties', token, { method: 'POST', body: body(overrides) })
      setMsg(`Created ${r.counterparty.display_name}.`)
      setForm(BLANK); setCreating(false); setDup(null)
      await load()
    } catch (e) {
      // A 409 is not a failure — it is the duplicate review handing the decision back.
      // apiFetch attaches the whole response body as err.data.
      if (e.status === 409 && e.code === 'possible_duplicate_counterparty') setDup(e.data)
      else setErr(e.message || 'Could not create counterparty')
    } finally { setBusy(false) }
  }

  const archive = async (cp) => {
    setBusy(true); setErr(null)
    try {
      await apiFetch(`/counterparties/${cp.id}/archive`, token, {
        method: 'POST', body: { unarchive: cp.status === 'archived' } })
      setMsg(cp.status === 'archived' ? 'Restored.' : 'Archived. Nothing was deleted.')
      await load()
      setSelected(null)
    } catch (e) { setErr(e.message || 'Could not archive') }
    finally { setBusy(false) }
  }

  const head = (
    <PageHeader eyebrow="Business Workspace" title="Counterparties"
      actions={<>
        <StatusBadge tone="neutral">{list.length} record{list.length === 1 ? '' : 's'}</StatusBadge>
        <Btn sm variant="ghost" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Btn>
        <Btn sm onClick={() => { setCreating((v) => !v); setDup(null); setErr(null) }}>
          {creating ? 'Cancel' : 'New counterparty'}
        </Btn>
      </>} />
  )

  const cp = selected && list.find((c) => c.id === selected)

  return <>{head}
    <p className="cp-note">
      <Icon.warn width="15" height="15" aria-hidden="true" />
      CFO AI suggests counterparties from your documents. Nothing is created until you
      confirm it, and two records are never merged automatically.
    </p>

    {err && <p className="cp-err">{err}</p>}
    {msg && <p className="cp-ok">{msg}</p>}

    {/* ── duplicate review ────────────────────────────────────────────── */}
    {dup && (
      <Card title="Possible duplicate">
        <p className="cp-warn">{dup.message}</p>
        {(dup.reasons || []).length > 0 && (
          <ul className="cp-reasons">{dup.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        )}
        {(dup.possible_matches || []).length > 0 && (
          <ul className="cp-matches">
            {dup.possible_matches.map((m) => (
              <li key={m.counterparty_id}>
                <span>{m.name}</span>
                <span className="cp-strength">{Math.round((m.strength || 0) * 100)}%</span>
                <Btn sm variant="ghost" onClick={() => { setSelected(m.counterparty_id); setDup(null); setCreating(false) }}>
                  Use existing
                </Btn>
              </li>
            ))}
          </ul>
        )}
        {dup.matched_counterparty_id && (
          <Btn sm variant="ghost" onClick={() => { setSelected(dup.matched_counterparty_id); setDup(null); setCreating(false) }}>
            Use existing record
          </Btn>
        )}
        <div className="cp-actions">
          <Btn sm variant="ghost" disabled={busy} onClick={() => create({ create_new_anyway: true })}>
            Create new anyway
          </Btn>
          <Btn sm variant="ghost" onClick={() => setDup(null)}>Review</Btn>
        </div>
      </Card>
    )}

    <div className="cp-grid">
      {/* ── directory ─────────────────────────────────────────────────── */}
      <Card title="Directory">
        {!busy && list.length === 0 && (
          <p className="cp-empty">
            No counterparties yet. Create one here, or upload an invoice and let CFO AI
            suggest it.
          </p>
        )}
        <ul className="cp-list">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className={`cp-item${selected === c.id ? ' is-on' : ''}`}
                onClick={() => setSelected(c.id)}>
                <span className="cp-item-top">
                  <span className="cp-item-name">{c.display_name}</span>
                  <span className="cp-item-role">{roleLabel(c.role)}</span>
                </span>
                <span className="cp-item-sub">
                  {c.npwp ? `NPWP ${c.npwp}` : 'No NPWP'}
                  {c.bank_accounts?.length ? ` · ${c.bank_accounts.length} bank account${c.bank_accounts.length === 1 ? '' : 's'}` : ''}
                  {c.status === 'archived' ? ' · archived' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* ── create ────────────────────────────────────────────────────── */}
      {creating && (
        <Card title="New counterparty">
          <div className="cp-form">
            <label className="cp-field cp-wide"><span>Legal name</span>
              <input value={form.legal_name} onChange={set('legal_name')} placeholder="PT Circleka Indonesia Utama" /></label>
            <label className="cp-field"><span>Display name <em>optional</em></span>
              <input value={form.display_name} onChange={set('display_name')} placeholder="Circleka" /></label>
            <label className="cp-field"><span>Role</span>
              <select value={form.role} onChange={set('role')}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select></label>
            <label className="cp-field"><span>NPWP</span>
              <input value={form.npwp} onChange={set('npwp')} placeholder="00.207.974.4-500.7000" /></label>
            <label className="cp-field"><span>PKP status</span>
              <select value={form.pkp_status} onChange={set('pkp_status')}>
                {PKP.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select></label>
            <label className="cp-field cp-wide"><span>Aliases <em>comma separated</em></span>
              <input value={form.aliases} onChange={set('aliases')} placeholder="Circle K, CIRCLEKA INDONESIA UTAMA" /></label>
            <label className="cp-field"><span>Bank</span>
              <input value={form.bank_name} onChange={set('bank_name')} placeholder="BCA" /></label>
            <label className="cp-field"><span>Account number</span>
              <input value={form.account_number} onChange={set('account_number')} placeholder="075-3020192" /></label>
            <label className="cp-field cp-wide"><span>Account holder</span>
              <input value={form.account_name} onChange={set('account_name')} placeholder="CIRCLEKA INDONESIA UTAMA" /></label>
            <label className="cp-field"><span>Email</span>
              <input value={form.email} onChange={set('email')} /></label>
            <label className="cp-field"><span>Phone</span>
              <input value={form.phone} onChange={set('phone')} /></label>
            <label className="cp-field cp-wide"><span>Address</span>
              <input value={form.address} onChange={set('address')} /></label>
            <label className="cp-field"><span>Default category</span>
              <input value={form.default_category} onChange={set('default_category')} placeholder="Location rent" /></label>
            <label className="cp-field"><span>Default tax treatment</span>
              <input value={form.default_tax_treatment} onChange={set('default_tax_treatment')} placeholder="Needs accountant review" /></label>
            <label className="cp-field cp-wide"><span>Notes</span>
              <input value={form.notes} onChange={set('notes')} /></label>
            <div className="cp-form-actions">
              <Btn disabled={busy} onClick={() => create()}>Create counterparty</Btn>
              <Btn variant="ghost" disabled={busy} onClick={() => { setForm(BLANK); setCreating(false); setDup(null) }}>Cancel</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* ── card ──────────────────────────────────────────────────────── */}
      {cp && !creating && (
        <Card title="Counterparty">
          <div className="cp-head">
            <div>
              <span className="cp-eyebrow">{roleLabel(cp.role)}</span>
              <h3 className="cp-title">{cp.display_name}</h3>
              {cp.legal_name !== cp.display_name && <p className="cp-sub">{cp.legal_name}</p>}
            </div>
            <StatusBadge tone={cp.status === 'archived' ? 'neutral' : 'success'}>
              {cp.status === 'archived' ? 'Archived' : 'Active'}
            </StatusBadge>
          </div>

          <section className="cp-sec">
            <div className="cp-kv"><span>NPWP</span><span className="cp-mono">{cp.npwp || '—'}</span></div>
            <div className="cp-kv"><span>PKP status</span><span>{(PKP.find((p) => p.value === cp.pkp_status) || {}).label || 'Unknown'}</span></div>
            {cp.email && <div className="cp-kv"><span>Email</span><span>{cp.email}</span></div>}
            {cp.phone && <div className="cp-kv"><span>Phone</span><span>{cp.phone}</span></div>}
            {cp.address && <div className="cp-kv"><span>Address</span><span>{cp.address}</span></div>}
          </section>

          <section className="cp-sec">
            <span className="cp-label">Bank accounts</span>
            {cp.bank_accounts?.length ? (
              <ul className="cp-banks">
                {cp.bank_accounts.map((a) => (
                  <li key={a.id || a.account_number}>
                    <span>{a.bank_name || 'Bank'} {a.account_number}</span>
                    {a.account_name && <span className="cp-bank-holder">{a.account_name}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="cp-empty">None recorded.</p>}
          </section>

          {(cp.aliases?.length > 0) && (
            <section className="cp-sec">
              <span className="cp-label">Also seen as</span>
              <ul className="cp-chips">{cp.aliases.map((a) => <li key={a}>{a}</li>)}</ul>
            </section>
          )}

          {(cp.default_category || cp.default_tax_treatment) && (
            <section className="cp-sec">
              <span className="cp-label">Defaults</span>
              {cp.default_category && <div className="cp-kv"><span>Category</span><span>{cp.default_category}</span></div>}
              {cp.default_tax_treatment && (
                <>
                  <div className="cp-kv"><span>Tax treatment</span><span>{cp.default_tax_treatment}</span></div>
                  <p className="cp-hint">A suggestion for your accountant, not an activated tax rule.</p>
                </>
              )}
            </section>
          )}

          <section className="cp-sec">
            <div className="cp-actions">
              <Btn sm variant="ghost" onClick={() => navigate('/business/payables')}>Payables</Btn>
              <Btn sm variant="ghost" onClick={() => navigate('/business/documents')}>Documents</Btn>
              <Btn sm variant="ghost" disabled={busy} onClick={() => archive(cp)}>
                {cp.status === 'archived' ? 'Restore' : 'Archive'}
              </Btn>
            </div>
            <p className="cp-hint">Archiving hides the record. Nothing is deleted and existing links stay intact.</p>
          </section>
        </Card>
      )}
    </div>
  </>
}
