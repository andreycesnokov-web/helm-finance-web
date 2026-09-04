// Counterparty Directory V1 — the financial memory for vendors and customers.
//
// WHAT THIS PAGE NEVER DOES:
//   * create a counterparty without an explicit click;
//   * merge two records. A likely duplicate is shown with its reasons and the user
//     chooses: use the existing one, or create anyway. Merging is irreversible in
//     practice, so it is not offered;
//   * invent activity counts. Where a link does not exist yet, the section says so
//     rather than showing a zero that reads as "nothing owed".
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { PageHeader, Card, Btn, StatusBadge, Icon } from '../../shell/ui'
import './Counterparties.css'

// Internal role values are unchanged; only the words on screen are friendlier.
// "Vendor / Supplier" reads more naturally than "Vendor" in an Indonesian context.
const ROLE_OPTIONS = [
  { value: 'customer', label: 'Customer', hint: 'they pay us' },
  { value: 'vendor', label: 'Vendor / Supplier', hint: 'we pay them' },
  { value: 'both', label: 'Both', hint: 'can be customer and vendor' },
  { value: 'tax_authority', label: 'Tax authority', hint: '' },
  { value: 'bank', label: 'Bank', hint: '' },
  { value: 'employee', label: 'Employee', hint: '' },
  { value: 'other', label: 'Other', hint: '' },
]
const OTHER_ROLES = ['tax_authority', 'bank', 'employee', 'other']

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'customer', label: 'Customers', match: (c) => c.role === 'customer' },
  { key: 'vendor', label: 'Vendors / Suppliers', match: (c) => c.role === 'vendor' },
  { key: 'both', label: 'Both', match: (c) => c.role === 'both' },
  { key: 'other', label: 'Other', match: (c) => OTHER_ROLES.includes(c.role) || !c.role },
  { key: 'archived', label: 'Archived', match: (c) => c.status === 'archived', archived: true },
]

const PKP = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'pkp', label: 'PKP' },
  { value: 'non_pkp', label: 'Non-PKP' },
]

const roleLabel = (r) => (ROLE_OPTIONS.find((x) => x.value === r) || {}).label || 'Role not set'
const roleTone = (r) => (r === 'customer' ? 'success' : r === 'vendor' ? 'info' : r === 'both' ? 'warning' : 'neutral')
const pkpLabel = (p) => (PKP.find((x) => x.value === p) || {}).label || 'Unknown'

const BLANK = {
  legal_name: '', display_name: '', role: 'vendor', npwp: '', pkp_status: 'unknown',
  address: '', email: '', phone: '', aliases: '', notes: '',
  default_category: '', default_tax_treatment: '', status: 'active',
  bank_name: '', account_number: '', account_name: '',
}

const fromRecord = (c) => ({
  legal_name: c.legal_name || '', display_name: c.display_name || '',
  role: c.role || '', npwp: c.npwp || '', pkp_status: c.pkp_status || 'unknown',
  address: c.address || '', email: c.email || '', phone: c.phone || '',
  aliases: (c.aliases || []).join(', '), notes: c.notes || '',
  default_category: c.default_category || '', default_tax_treatment: c.default_tax_treatment || '',
  status: c.status || 'active',
  bank_name: '', account_number: '', account_name: '',
})

export default function Counterparties() {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const navigate = useNavigate()

  const [list, setList] = useState([])
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [mode, setMode] = useState(null)         // null | 'create' | 'edit'
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [dup, setDup] = useState(null)
  const alive = useRef(true)

  // Re-arm on mount as well as clear on unmount: StrictMode runs mount → cleanup →
  // mount, and a cleanup-only ref would leave this false for the rest of the session.
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // Refetch whenever the data could have changed underneath us: first render, a
  // workspace switch, or a scope bump. Every successful write also calls load()
  // directly, so the directory is never left showing a stale row.
  const load = useCallback(async (opts = {}) => {
    if (!token || !active) return
    setBusy(true); if (!opts.quiet) setErr(null)
    try {
      // Archived rows are fetched once and filtered client-side, so switching to the
      // Archived tab does not need another round trip.
      const r = await apiFetch('/counterparties?include_archived=true', token)
      if (alive.current) setList(r.counterparties || [])
    } catch (e) { if (alive.current) setErr(e.message || 'Could not load counterparties') }
    finally { if (alive.current) setBusy(false) }
  }, [token, active])

  useEffect(() => { load() }, [load, scopeKey])

  // A workspace switch must not leave another business's record selected.
  useEffect(() => { setSelectedId(null); setMode(null); setDup(null) }, [active?.id])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const payload = (overrides = {}) => {
    const body = {
      legal_name: form.legal_name.trim() || form.display_name.trim(),
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
      ...overrides,
    }
    if (form.account_number.trim()) {
      body.bank_accounts = [{
        bank_name: form.bank_name.trim() || null,
        account_number: form.account_number.trim(),
        account_name: form.account_name.trim() || null,
        is_primary: true,
      }]
    }
    return body
  }

  const create = async (overrides = {}) => {
    if (!form.legal_name.trim() && !form.display_name.trim()) { setErr('A name is required'); return }
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await apiFetch('/counterparties', token, { method: 'POST', body: payload(overrides) })
      setMsg(`Created ${r.counterparty.display_name}.`)
      setForm(BLANK); setMode(null); setDup(null)
      await load()
      setSelectedId(r.counterparty.id)        // land on what was just created
    } catch (e) {
      // A 409 is not a failure — it is the duplicate review handing the decision back.
      if (e.status === 409 && e.code === 'possible_duplicate_counterparty') setDup(e.data)
      else setErr(e.message || 'Could not create counterparty')
    } finally { setBusy(false) }
  }

  const saveEdit = async () => {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const body = payload({ status: form.status })
      const r = await apiFetch(`/counterparties/${selectedId}`, token, { method: 'PATCH', body })
      setMsg(`Saved ${r.counterparty.display_name}.`)
      setMode(null)
      await load()
    } catch (e) { setErr(e.message || 'Could not save changes') }
    finally { setBusy(false) }
  }

  const archive = async (cp) => {
    setBusy(true); setErr(null)
    try {
      await apiFetch(`/counterparties/${cp.id}/archive`, token, {
        method: 'POST', body: { unarchive: cp.status === 'archived' } })
      setMsg(cp.status === 'archived' ? 'Restored.' : 'Archived. Nothing was deleted.')
      await load()
    } catch (e) { setErr(e.message || 'Could not archive') }
    finally { setBusy(false) }
  }

  const removeAccount = async (cp, acct) => {
    setBusy(true); setErr(null)
    try {
      await apiFetch(`/counterparties/${cp.id}/bank-accounts/${acct.id}`, token, { method: 'DELETE' })
      setMsg('Bank account removed.')
      await load()
    } catch (e) { setErr(e.message || 'Could not remove the bank account') }
    finally { setBusy(false) }
  }

  const activeFilter = FILTERS.find((f) => f.key === filter) || FILTERS[0]
  const visible = list
    .filter((c) => (activeFilter.archived ? true : c.status !== 'archived'))
    .filter(activeFilter.match)
  const countFor = (f) => list
    .filter((c) => (f.archived ? true : c.status !== 'archived'))
    .filter(f.match).length

  const cp = selectedId && list.find((c) => c.id === selectedId)

  const head = (
    <PageHeader eyebrow="Business Workspace" title="Counterparties"
      actions={<>
        <StatusBadge tone="neutral">{list.filter((c) => c.status !== 'archived').length} active</StatusBadge>
        <Btn sm variant="ghost" disabled={busy} onClick={() => load()}>Refresh</Btn>
        <Btn sm onClick={() => {
          setMode(mode === 'create' ? null : 'create'); setForm(BLANK); setDup(null); setErr(null)
        }}>{mode === 'create' ? 'Cancel' : 'New counterparty'}</Btn>
      </>} />
  )

  const roleField = (
    <label className="cp-field cp-wide"><span>Role</span>
      <select value={form.role} onChange={set('role')}>
        <option value="">Not set</option>
        {ROLE_OPTIONS.map((r) => (
          <option key={r.value} value={r.value}>{r.hint ? `${r.label} — ${r.hint}` : r.label}</option>
        ))}
      </select></label>
  )

  const formFields = (
    <>
      <label className="cp-field"><span>Display name</span>
        <input value={form.display_name} onChange={set('display_name')} placeholder="Circleka" /></label>
      <label className="cp-field"><span>Legal name</span>
        <input value={form.legal_name} onChange={set('legal_name')} placeholder="PT Circleka Indonesia Utama" /></label>
      {roleField}
      <label className="cp-field"><span>NPWP</span>
        <input value={form.npwp} onChange={set('npwp')} placeholder="00.207.974.4-500.7000" /></label>
      <label className="cp-field"><span>PKP status</span>
        <select value={form.pkp_status} onChange={set('pkp_status')}>
          {PKP.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select></label>
      <label className="cp-field cp-wide"><span>Aliases <em>comma separated</em></span>
        <input value={form.aliases} onChange={set('aliases')} placeholder="Circle K, CIRCLEKA INDONESIA UTAMA" /></label>
      <label className="cp-field"><span>Bank <em>optional</em></span>
        <input value={form.bank_name} onChange={set('bank_name')} placeholder="BCA" /></label>
      <label className="cp-field"><span>Account number <em>optional</em></span>
        <input value={form.account_number} onChange={set('account_number')} placeholder="075-3020192" /></label>
      <label className="cp-field cp-wide"><span>Account holder <em>optional</em></span>
        <input value={form.account_name} onChange={set('account_name')} /></label>
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
    </>
  )

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
                <Btn sm variant="ghost" onClick={() => { setSelectedId(m.counterparty_id); setDup(null); setMode(null) }}>
                  Use existing
                </Btn>
              </li>
            ))}
          </ul>
        )}
        {dup.matched_counterparty_id && (
          <Btn sm variant="ghost" onClick={() => { setSelectedId(dup.matched_counterparty_id); setDup(null); setMode(null) }}>
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

    {/* ── role filters ────────────────────────────────────────────────── */}
    <nav className="cp-tabs" aria-label="Filter by role">
      {FILTERS.map((f) => (
        <button key={f.key} type="button"
          className={`cp-tab${filter === f.key ? ' is-on' : ''}`}
          aria-pressed={filter === f.key}
          onClick={() => setFilter(f.key)}>
          {f.label}<span className="cp-tab-n">{countFor(f)}</span>
        </button>
      ))}
    </nav>

    <div className="cp-grid">
      <Card title="Directory">
        {!busy && visible.length === 0 && (
          <p className="cp-empty">
            {filter === 'all'
              ? 'No counterparties yet. Create one here, or upload an invoice and let CFO AI suggest it.'
              : `No counterparties in ${activeFilter.label.toLowerCase()}.`}
          </p>
        )}
        <ul className="cp-list">
          {visible.map((c) => (
            <li key={c.id}>
              <button type="button" className={`cp-item${selectedId === c.id ? ' is-on' : ''}`}
                onClick={() => { setSelectedId(c.id); setMode(null) }}>
                <span className="cp-item-top">
                  <span className="cp-item-name">{c.display_name}</span>
                  <span className={`cp-item-role cp-role-${c.role || 'none'}`}>{roleLabel(c.role)}</span>
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
      {mode === 'create' && (
        <Card title="New counterparty">
          <div className="cp-form">
            {formFields}
            <div className="cp-form-actions">
              <Btn disabled={busy} onClick={() => create()}>Create counterparty</Btn>
              <Btn variant="ghost" disabled={busy} onClick={() => { setForm(BLANK); setMode(null); setDup(null) }}>Cancel</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* ── detail ────────────────────────────────────────────────────── */}
      {cp && mode !== 'create' && (
        <Card title={mode === 'edit' ? 'Edit counterparty' : 'Counterparty'}>
          <div className="cp-head">
            <div className="cp-head-main">
              <h3 className="cp-title">{cp.display_name}</h3>
              {cp.legal_name && cp.legal_name !== cp.display_name && <p className="cp-sub">{cp.legal_name}</p>}
              <div className="cp-badges">
                <StatusBadge tone={roleTone(cp.role)}>{roleLabel(cp.role)}</StatusBadge>
                {cp.pkp_status && cp.pkp_status !== 'unknown' && (
                  <StatusBadge tone="neutral">{pkpLabel(cp.pkp_status)}</StatusBadge>
                )}
                {cp.bank_accounts?.length > 0 && (
                  <StatusBadge tone="neutral">
                    {cp.bank_accounts.length} bank account{cp.bank_accounts.length === 1 ? '' : 's'}
                  </StatusBadge>
                )}
                {cp.default_tax_treatment && <StatusBadge tone="warning">Needs accountant review</StatusBadge>}
                <StatusBadge tone={cp.status === 'archived' ? 'neutral' : 'success'}>
                  {cp.status === 'archived' ? 'Archived' : 'Active'}
                </StatusBadge>
              </div>
            </div>
            {/* The icon set has no close glyph, so use a real × with an accessible label. */}
            <button type="button" className="cp-close" aria-label="Close details"
              onClick={() => { setSelectedId(null); setMode(null) }}>
              <span aria-hidden="true">×</span>Close
            </button>
          </div>

          {mode === 'edit' ? (
            <div className="cp-form">
              {formFields}
              <label className="cp-field"><span>Status</span>
                <select value={form.status} onChange={set('status')}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select></label>
              <div className="cp-form-actions">
                <Btn disabled={busy} onClick={saveEdit}>Save changes</Btn>
                <Btn variant="ghost" disabled={busy} onClick={() => setMode(null)}>Cancel</Btn>
              </div>
              <p className="cp-hint cp-wide">
                Adding a bank account here keeps the existing ones. Remove an account from
                the detail view — it is a matching key, so removing it can change which
                counterparty a future payment resolves to.
              </p>
            </div>
          ) : (
            <>
              <section className="cp-sec">
                <span className="cp-label">Identity</span>
                <div className="cp-kv"><span>Legal name</span><span>{cp.legal_name || '—'}</span></div>
                {cp.email && <div className="cp-kv"><span>Email</span><span>{cp.email}</span></div>}
                {cp.phone && <div className="cp-kv"><span>Phone</span><span>{cp.phone}</span></div>}
                {cp.address && <div className="cp-kv"><span>Address</span><span>{cp.address}</span></div>}
                {cp.notes && <div className="cp-kv"><span>Notes</span><span>{cp.notes}</span></div>}
              </section>

              <section className="cp-sec">
                <span className="cp-label">Tax profile</span>
                <div className="cp-kv"><span>NPWP</span><span className="cp-mono">{cp.npwp || '—'}</span></div>
                <div className="cp-kv"><span>PKP status</span><span>{pkpLabel(cp.pkp_status)}</span></div>
              </section>

              <section className="cp-sec">
                <span className="cp-label">Bank accounts</span>
                {cp.bank_accounts?.length ? (
                  <ul className="cp-banks">
                    {cp.bank_accounts.map((a) => (
                      <li key={a.id || a.account_number}>
                        <span className="cp-mono">{a.bank_name || 'Bank'} {a.account_number}</span>
                        {a.account_name && <span className="cp-bank-holder">{a.account_name}</span>}
                        {a.id && (
                          <button type="button" className="cp-remove" disabled={busy}
                            onClick={() => removeAccount(cp, a)}>Remove</button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <p className="cp-empty">None recorded.</p>}
              </section>

              {cp.aliases?.length > 0 && (
                <section className="cp-sec">
                  <span className="cp-label">Also seen as</span>
                  <ul className="cp-chips">{cp.aliases.map((a) => <li key={a}>{a}</li>)}</ul>
                  <p className="cp-hint">Alternate spellings that resolve to this record when matching documents.</p>
                </section>
              )}

              <section className="cp-sec">
                <span className="cp-label">Defaults</span>
                <div className="cp-kv"><span>Category</span><span>{cp.default_category || '—'}</span></div>
                <div className="cp-kv"><span>Tax treatment</span><span>{cp.default_tax_treatment || '—'}</span></div>
                {cp.default_tax_treatment && (
                  <p className="cp-hint">A suggestion for your accountant, not an activated tax rule.</p>
                )}
              </section>

              {/* Honest placeholders: these links do not exist yet, and a zero here
                  would read as "nothing outstanding" rather than "not connected". */}
              <section className="cp-sec">
                <span className="cp-label">Activity</span>
                <ul className="cp-activity">
                  {['Payables', 'Receivables', 'Documents', 'Payments', 'Tax reviews'].map((k) => (
                    <li key={k}><span>{k}</span><span className="cp-soon">Not linked yet</span></li>
                  ))}
                </ul>
                <p className="cp-hint">
                  Records are not yet linked to counterparties, so no totals are shown. A
                  zero here would be misleading rather than empty.
                </p>
              </section>

              <section className="cp-sec">
                <span className="cp-label">Actions</span>
                <div className="cp-actions">
                  <Btn sm disabled={busy} onClick={() => { setForm(fromRecord(cp)); setMode('edit'); setErr(null) }}>Edit</Btn>
                  <Btn sm variant="ghost" onClick={() => navigate('/business/payables')}>Payables</Btn>
                  <Btn sm variant="ghost" onClick={() => navigate('/business/documents')}>Documents</Btn>
                  <Btn sm variant="ghost" disabled={busy} onClick={() => archive(cp)}>
                    {cp.status === 'archived' ? 'Restore' : 'Archive'}
                  </Btn>
                </div>
                <p className="cp-hint">Archiving hides the record. Nothing is deleted and existing links stay intact.</p>
              </section>
            </>
          )}
        </Card>
      )}

      {!cp && mode !== 'create' && (
        <Card title="Counterparty">
          <p className="cp-empty">Select a counterparty to view details.</p>
        </Card>
      )}
    </div>
  </>
}
