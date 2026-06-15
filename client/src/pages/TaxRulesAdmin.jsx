import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'

const STATUS_COLOR = {
  draft:        ['#6B7280', '#F3F4F6'],
  under_review: ['#92400E', '#FEF3C7'],
  active:       ['#085041', '#E1F5EE'],
  deprecated:   ['#6B7280', '#F3F4F6'],
  superseded:   ['#6B7280', '#F3F4F6'],
  rejected:     ['#991B1B', '#FEE2E2'],
  verified:     ['#085041', '#E1F5EE'],
  outdated:     ['#991B1B', '#FEE2E2'],
  unavailable:  ['#991B1B', '#FEE2E2'],
  replaced:     ['#6B7280', '#F3F4F6'],
}
const Badge = ({ s }) => {
  const [fg, bg] = STATUS_COLOR[s] || ['#374151', '#F3F4F6']
  return <span style={{ background: bg, color: fg, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{s}</span>
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function TaxRulesAdmin() {
  const { token } = useAuth()
  const [tab, setTab] = useState('rules')
  const [rules, setRules] = useState([])
  const [sources, setSources] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch('/admin/tax-rules', token),
      apiFetch('/admin/official-sources', token),
    ]).then(([r, s]) => { setRules(r.rules || []); setSources(s.sources || []); setLoading(false) })
      .catch(e => { setError(e); setLoading(false) })
  }, [token])
  useEffect(() => { if (token) load() }, [token, load])

  const act = async (fn) => { setBusy(true); try { await fn(); load() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const ruleAction = (id, action) => act(() => apiFetch(`/admin/tax-rules/${id}/${action}`, token, { method: 'POST' }))
  const verifySource = (id) => act(() => apiFetch(`/admin/official-sources/${id}/verify`, token, { method: 'POST' }))

  const newSource = () => {
    const authority = prompt('Authority (e.g. Direktorat Jenderal Pajak)'); if (!authority) return
    const title = prompt('Source title'); if (!title) return
    const url = prompt('Official URL'); if (!url) return
    act(() => apiFetch('/admin/official-sources', token, { method: 'POST', body: { jurisdiction: 'ID', authority, title, url, source_type: 'portal' } }))
  }

  if (error) {
    const is403 = /access required|Forbidden/i.test(error.message || '')
    return <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{is403 ? '🔒' : '⚠️'}</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{is403 ? 'Platform admin only' : 'Error'}</div>
        <div style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 8 }}>{is403 ? 'The tax rules registry is managed by CFO AI platform admins only.' : error.message}</div>
      </div>
    </div>
  }
  if (loading) return <div style={{ padding: 40, color: 'var(--text-3)' }}>Loading registry…</div>

  const srcById = Object.fromEntries(sources.map(s => [s.id, s]))

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🧮 Tax Rules Registry</h1>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>Platform-level versioned rules &amp; official sources · Indonesia</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['rules', 'sources'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer',
            background: tab === t ? 'var(--accent,#4F46E5)' : 'var(--bg-3)', color: tab === t ? '#fff' : 'var(--text-2)', fontWeight: 600 }}>
            {t === 'rules' ? `Rules · ${rules.length}` : `Sources · ${sources.length}`}
          </button>
        ))}
      </div>

      {tab === 'rules' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--bg-3)', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Rule</th><th style={{ padding: 8 }}>v</th><th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Source</th><th style={{ padding: 8 }}>Review</th><th style={{ padding: 8 }}>Activation blockers</th><th style={{ padding: 8 }}>Actions</th>
            </tr></thead>
            <tbody>
              {rules.map(r => {
                const src = r.official_sources || srcById[r.official_source_id]
                const sourceOk = src && src.last_verified_at && ['verified', 'active'].includes(src.status)
                const blockers = r.activation_blockers || []
                const canActivate = blockers.length === 0
                const rev = r.latest_review
                return (
                  <tr key={r.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <td style={{ padding: 8 }}><b>{r.rule_code}</b><div style={{ color: 'var(--text-3)' }}>{r.title}</div></td>
                    <td style={{ padding: 8 }}>{r.version}</td>
                    <td style={{ padding: 8 }}><Badge s={r.status} /></td>
                    <td style={{ padding: 8 }}>{src ? <span title={src.url}>{src.title?.slice(0, 20)}… {sourceOk ? '✓' : '⚠'}</span> : <span style={{ color: 'var(--red-dark)' }}>none</span>}</td>
                    <td style={{ padding: 8 }}>{rev ? <Badge s={rev.review_status} /> : <span style={{ color: 'var(--text-4)' }}>none</span>}</td>
                    <td style={{ padding: 8, maxWidth: 220 }}>
                      {canActivate ? <span style={{ color: 'var(--green-dark)' }}>✓ none</span>
                        : blockers.map(b => <span key={b} style={{ display: 'inline-block', background: '#FEE2E2', color: '#991B1B', borderRadius: 5, padding: '1px 6px', margin: 1, fontSize: 10 }}>{b}</span>)}
                    </td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                      {r.status === 'draft' && <button disabled={busy} onClick={() => ruleAction(r.id, 'submit')} style={btn}>Submit</button>}
                      {['draft', 'under_review'].includes(r.status) && <button disabled={busy || !canActivate} title={canActivate ? '' : `Blocked: ${blockers.join(', ')}`} onClick={() => ruleAction(r.id, 'activate')} style={btn}>Activate</button>}
                      {r.status === 'active' && <button disabled={busy} onClick={() => ruleAction(r.id, 'deprecate')} style={btn}>Deprecate</button>}
                      <button disabled={busy} onClick={() => ruleAction(r.id, 'new-version')} style={btn}>New version</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sources' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
            <button disabled={busy} onClick={newSource} style={{ ...btn, background: 'var(--accent,#4F46E5)', color: '#fff', border: 'none' }}>+ New source</button>
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--bg-3)', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Authority / Title</th><th style={{ padding: 8 }}>Status</th><th style={{ padding: 8 }}>Verified</th><th style={{ padding: 8 }}>Actions</th>
            </tr></thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                  <td style={{ padding: 8 }}><b>{s.authority}</b><div style={{ color: 'var(--text-3)' }}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></div></td>
                  <td style={{ padding: 8 }}><Badge s={s.status} /></td>
                  <td style={{ padding: 8 }}>{fmtDate(s.last_verified_at)}</td>
                  <td style={{ padding: 8 }}>{!s.last_verified_at && <button disabled={busy} onClick={() => verifySource(s.id)} style={btn}>Verify</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 12 }}>
        A rule can be activated only after its official source is verified. Active rules are immutable — edit by creating a new version.
      </div>
    </div>
  )
}
const btn = { fontSize: 11, padding: '3px 8px', marginRight: 4, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer' }
