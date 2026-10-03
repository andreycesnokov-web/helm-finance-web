// Profit groups (P-10) — /business/performance/groups.
// Every category of this business belongs to one of 9 groups. Suggestions come from the
// industry templates for the business's KBLI codes (migration 062); NOTHING counts until a
// person confirms: "Use suggestions" only fills the form, Save sends PATCH /api/pnl-mapping
// (owner/ceo/admin/cfo, audited). Before 062 the server says available:false and this page
// says so. Business only; the server refuses Personal.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { PageHead, Card, Pill, Btn, NotYet, Skeleton, ErrorBox, Empty } from '../ui'
import { useT } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { updatePnlMapping, actionError } from '../lib/actions'
import { GROUPS } from '../lib/pnl'
import I from '../icons'

export default function ProfitGroups() {
  const t = useT()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const q = useApi('/pnl-mapping')
  const cats = q.data?.categories || []
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => { setForm(Object.fromEntries(cats.map((c) => [c.id, c.pnl_group || '']))) }, [q.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const changed = useMemo(() => cats.filter((c) => (form[c.id] ?? '') !== (c.pnl_group || '')), [cats, form])
  const withSuggestion = cats.filter((c) => c.suggestion && !form[c.id])
  const canEdit = q.data?.can_edit === true

  const head = <PageHead title={t('perf.groups.title')} sub={t('perf.groups.sub')} back={{ to: '/business/performance', label: t('nav.performance') }} />
  if (q.loading) return <>{head}<Card><Skeleton rows={8} /></Card></>
  if (q.error) return <>{head}<ErrorBox error={q.error?.status === 403 ? t('perf.forbidden') : q.error} onRetry={q.reload} /></>
  if (q.data && q.data.available === false) {
    return <>{head}<Card><Empty icon={<I.performance size={28} />} title={t('perf.groups.notAppliedTitle')} text={t('perf.groups.notApplied')}
      action={<NotYet note={t('perf.groups.notAppliedNote')}>{t('perf.groups.save')}</NotYet>} /></Card></>
  }

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      await updatePnlMapping(token, { mappings: changed.map((c) => ({ category_id: c.id, pnl_group: form[c.id] || null })) })
      setMsg({ ok: true, text: t('perf.groups.saved', { n: changed.length }) })
      invalidate()
    } catch (e) {
      const code = actionError(e)
      setMsg({ ok: false, text: code === 'forbidden' ? t('perf.groups.forbidden') : code === 'notApplied' ? t('perf.groups.notApplied') : code })
    } finally { setBusy(false) }
  }

  return (
    <div className="v2-page">
      {head}
      <div className="v2-banner v2-tone-info" role="note">
        <I.cfo size={18} />
        <span className="v2-banner-text">
          {t('perf.groups.how')}{' '}
          {q.data?.kbli?.length ? t('perf.groups.kbli', { codes: q.data.kbli.join(', ') }) : t('perf.groups.noKbli')}
        </span>
        {!q.data?.kbli?.length && <Btn to="/business/accountant/tax-profile">{t('set.openProfile')}</Btn>}
      </div>

      <Card title={t('perf.groups.listTitle', { n: cats.length })}
        aside={q.data?.confirmed ? <Pill tone="good">{t('perf.groups.confirmed')}</Pill> : <Pill tone="warn">{t('perf.groups.notConfirmed')}</Pill>}>
        {cats.length === 0 ? (
          <Empty title={t('perf.groups.emptyTitle')} text={t('perf.groups.emptyText')} action={<Btn to="/business/settings/classic">{t('perf.groups.manageCats')}</Btn>} />
        ) : (
          <>
            <ul className="v2-grouplist">
              {cats.map((c) => (
                <li key={c.id} className="v2-grouprow">
                  <span className="v2-group-name">
                    <strong>{c.name}</strong>
                    <span className="v2-muted v2-small">{c.group_type === 'inflow' ? t('perf.groups.in') : c.group_type === 'outflow' ? t('perf.groups.out') : ''}
                      {c.suggestion && ` · ${t('perf.groups.suggested', { g: t(`perf.g.${c.suggestion.pnl_group}`) })}`}</span>
                    {c.suggestion?.note && <span className="v2-muted v2-small">{c.suggestion.note}</span>}
                  </span>
                  <label className="v2-field v2-group-pick">
                    <span className="v2-sr">{t('perf.groups.groupFor', { name: c.name })}</span>
                    <select className="v2-select" value={form[c.id] ?? ''} disabled={!canEdit || busy} onChange={(e) => setForm((f) => ({ ...f, [c.id]: e.target.value }))}>
                      <option value="">{t('perf.groups.none')}</option>
                      {GROUPS.map((g) => <option key={g} value={g}>{t(`perf.g.${g}`)}</option>)}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
            {canEdit ? (
              <div className="v2-row-gap v2-row-end">
                {withSuggestion.length > 0 && (
                  <Btn onClick={() => setForm((f) => ({ ...f, ...Object.fromEntries(withSuggestion.map((c) => [c.id, c.suggestion.pnl_group])) }))}>
                    {t('perf.groups.useSuggestions', { n: withSuggestion.length })}</Btn>
                )}
                <Btn variant="primary" onClick={save} disabled={busy || changed.length === 0}>{t('perf.groups.saveN', { n: changed.length })}</Btn>
              </div>
            ) : <p className="v2-muted v2-small">{t('perf.groups.whoEdits')}</p>}
            {msg && <p className={msg.ok ? 'v2-dec-done' : 'v2-inline-err'} role={msg.ok ? 'status' : 'alert'}>{msg.ok && <I.check size={16} />}{msg.text}</p>}
          </>
        )}
      </Card>

      {(q.data?.missing_from_template || []).length > 0 && (
        <Card title={t('perf.groups.missingTitle')} aside={<Link to="/business/settings/classic">{t('perf.groups.manageCats')}</Link>}>
          <p className="v2-sec">{t('perf.groups.missingText')}</p>
          <ul className="v2-moves">
            {q.data.missing_from_template.map((m) => (
              <li key={m.name}><span>{m.name}{m.note && <span className="v2-muted"> · {m.note}</span>}</span><Pill tone="neutral">{t(`perf.g.${m.pnl_group}`)}</Pill></li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('perf.groups.rulesTitle')}>
        <ul className="v2-bullets">{['r1', 'r2', 'r3', 'r4', 'r5'].map((k) => <li key={k}>{t(`perf.groups.rules.${k}`)}</li>)}</ul>
      </Card>
    </div>
  )
}
