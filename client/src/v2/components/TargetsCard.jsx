// Settings → Targets & alerts (P-01 runway target, P-08 minimum cash and weekly brief).
// Reads GET /api/business/targets; writes PATCH /api/business/targets (owner/ceo/admin/cfo,
// audited on the server). Before migrations 058/059 are applied the server says
// available:false — the card shows the defaults and explains why it cannot save yet.
// The weekly brief is only a stored choice: nothing sends it yet (no scheduler exists).
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useApi, useInvalidate } from '../data'
import { updateBusinessTargets, actionError } from '../lib/actions'
import { runwayTarget, minCash } from '../lib/pulseModel'
import { money } from '../lib/format'
import { useT, useLang } from '../i18n'
import { Card, Btn, NotYet, Skeleton } from '../ui'
import I from '../icons'

const DAYS = [1, 2, 3, 4, 5, 6, 0]                 // Monday first
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const loc = (lang) => (lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB')
// 4 Jan 2026 is a Sunday, so 4 + d is weekday d.
export const dayName = (d, lang) => new Date(2026, 0, 4 + d).toLocaleDateString(loc(lang), { weekday: 'long' })
const hh = (h) => `${String(h).padStart(2, '0')}:00`

export default function TargetsCard() {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const q = useApi('/business/targets')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  const tg = q.data?.targets || null
  const available = q.data?.available === true
  const canEdit = q.data?.can_edit === true
  const target = runwayTarget(tg)
  const floor = minCash(tg)
  const brief = tg?.weekly_brief || null

  const open = () => {
    setSaved(false); setErr(null)
    setForm({
      runway: tg?.runway_target_days ?? '',
      minCash: floor ?? '',
      day: brief ? String(brief.day) : '',
      hour: brief ? String(brief.hour) : '8',
    })
  }
  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await updateBusinessTargets(token, {
        runway_target_days: form.runway === '' ? null : Number(form.runway),
        min_cash_idr: form.minCash === '' ? null : String(form.minCash),
        weekly_brief: form.day === '' ? null : { day: Number(form.day), hour: Number(form.hour), minute: 0 },
      })
      setForm(null); setSaved(true); invalidate()
    } catch (x) {
      const code = actionError(x)
      setErr(code === 'forbidden' ? t('set.tg2.forbidden') : code === 'notApplied' ? t('set.tg2.notApplied') : (x?.data?.error ? t('set.tg2.invalid') : code))
    } finally { setBusy(false) }
  }

  return (
    <Card id="set-targets" title={t('set.s.targets')}>
      <p className="v2-sec">{t('set.targetsHint')}</p>
      {q.loading ? <Skeleton rows={3} /> : form ? (
        <form className="v2-form" onSubmit={save}>
          <div className="v2-field-row">
            <label className="v2-field">
              <span className="v2-field-label">{t('set.runway')}</span>
              <input className="v2-input" type="number" inputMode="numeric" min={1} max={730} step={1} value={form.runway}
                placeholder={String(tg?.default_runway_target_days || 60)} onChange={(e) => setForm({ ...form, runway: e.target.value })} />
              <span className="v2-muted v2-small">{t('set.tg2.runwayHint')}</span>
            </label>
            <label className="v2-field">
              <span className="v2-field-label">{t('set.minCash')} (IDR)</span>
              <input className="v2-input" type="number" inputMode="numeric" min={0} step="0.01" value={form.minCash}
                onChange={(e) => setForm({ ...form, minCash: e.target.value })} />
              <span className="v2-muted v2-small">{form.minCash !== '' && Number(form.minCash) >= 0 ? money(Number(form.minCash)) : t('set.tg2.minCashHint')}</span>
            </label>
          </div>
          <fieldset className="v2-fieldset">
            <legend className="v2-field-label">{t('set.brief')}</legend>
            <div className="v2-field-row">
              <label className="v2-field">
                <span className="v2-sr">{t('set.tg2.day')}</span>
                <select className="v2-select" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>
                  <option value="">{t('set.tg2.off')}</option>
                  {DAYS.map((d) => <option key={d} value={String(d)}>{dayName(d, lang)}</option>)}
                </select>
              </label>
              <label className="v2-field">
                <span className="v2-sr">{t('set.tg2.time')}</span>
                <select className="v2-select" value={form.hour} disabled={form.day === ''} onChange={(e) => setForm({ ...form, hour: e.target.value })}>
                  {HOURS.map((h) => <option key={h} value={String(h)}>{hh(h)}</option>)}
                </select>
              </label>
            </div>
            <p className="v2-muted v2-small">{t('set.tg2.briefNote')}</p>
          </fieldset>
          <div className="v2-decide-row">
            <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setForm(null)} disabled={busy}>{t('dec.cancel')}</button>
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy}>{t('set.tg2.save')}</button>
          </div>
          {err && <p className="v2-inline-err" role="alert">{err}</p>}
        </form>
      ) : (
        <>
          <dl className="v2-dl">
            <dt>{t('set.runway')}</dt>
            <dd>{t('pulse.daysN', { n: target })}{tg?.runway_target_days == null && <span className="v2-muted v2-small"> · {t('set.tg2.default')}</span>}</dd>
            <dt>{t('set.minCash')}</dt>
            <dd>{floor != null ? <span className="v2-num">{money(floor)}</span> : <span className="v2-muted">{t('set.tg2.notSet')}</span>}</dd>
            <dt>{t('set.brief')}</dt>
            <dd>{brief ? t('set.tg2.briefAt', { day: dayName(brief.day, lang), time: hh(brief.hour) }) : <span className="v2-muted">{t('set.tg2.off')}</span>}
              {brief && <span className="v2-muted v2-small"> · {t('set.tg2.notSending')}</span>}</dd>
          </dl>
          {saved && <p className="v2-dec-done" role="status"><I.check size={16} />{t('set.tg2.saved')}</p>}
          {!available
            ? <NotYet note={t('set.tg2.notApplied')}>{t('set.editTargets')}</NotYet>
            : canEdit
              ? <Btn onClick={open}>{t('set.editTargets')}</Btn>
              : <p className="v2-muted v2-small">{t('set.tg2.whoEdits')}</p>}
        </>
      )}
    </Card>
  )
}
