// Payroll windows (designs w2/F1 employee, F2 pay a month) — replace payroll/manage in v2.
// Employees: POST / PATCH / DELETE (archive) /api/payroll/employees. A month: one
// POST /api/payroll/payments per person with item lines — salary and bonus (addition), PPh 21,
// employee BPJS and other deductions (deduction). The tax engine reads the PPh 21 line for the
// tax calendar (GET /api/accountant/obligations); CFO AI does not compute the rate itself.
// PTKP status, NIK / NPWP and BPJS registration wait for a database update (not shown as saved).
import { useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useT } from '../i18n'
import { money } from '../lib/format'
import Modal from './Modal'
import { createEmployee, updateEmployee, archiveEmployee, recordPayrollPayment } from '../lib/actions'

const num = (v) => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(/[\s.](?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const thisMonth = () => new Date().toISOString().slice(0, 7)
const today = () => new Date().toISOString().slice(0, 10)

export function EmployeeDialog({ employee = null, wallets = [], onClose, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const [f, setF] = useState({ name: employee?.name || '', role: employee?.role || '', default_salary: employee?.default_salary ? String(employee.default_salary) : '',
    pay_day: employee?.pay_day ? String(employee.pay_day) : '25', default_wallet_id: employee?.default_wallet_id ? String(employee.default_wallet_id) : '', notes: employee?.notes || '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [askArchive, setAskArchive] = useState(false)
  const salary = num(f.default_salary)
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); onSaved?.(); onClose() } catch (x) { setErr(x?.status === 403 ? t('dec.forbidden') : (x?.data?.error || x?.message)) } finally { setBusy(false) } }
  const body = () => ({ name: f.name.trim(), role: f.role.trim() || null, default_salary: salary || null, currency: 'IDR', pay_day: Number(f.pay_day) || null, default_wallet_id: f.default_wallet_id || null, notes: f.notes.trim() || null })
  if (askArchive) {
    return (
      <Modal title={t('payd.archTitle', { name: employee.name })} onClose={() => setAskArchive(false)}
        footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setAskArchive(false)}>{t('set.cancel')}</button>
          <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => run(() => archiveEmployee(token, employee.id))}>{t('payd.archive')}</button></>}>
        <p className="v2-sec">{t('payd.archP')}</p>
        {err && <p className="v2-inline-err" role="alert">{err}</p>}
      </Modal>
    )
  }
  return (
    <Modal title={employee ? employee.name : t('payd.newTitle')} onClose={onClose}
      footer={<>{employee && <button type="button" className="v2-btn v2-btn-ghost v2-mr-auto" onClick={() => setAskArchive(true)}>{t('payd.archive')}</button>}
        <button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !f.name.trim() || Number.isNaN(salary)}
          onClick={() => run(() => (employee ? updateEmployee(token, employee.id, body()) : createEmployee(token, body())))} data-payd-save>{employee ? t('set.save') : t('payd.add')}</button></>}>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('payd.name')}</span><input className="v2-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('payd.role')}</span><input className="v2-input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></label>
      </div>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('payd.salary')}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={f.default_salary} aria-invalid={Number.isNaN(salary)} onChange={(e) => setF({ ...f, default_salary: e.target.value })} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('payd.payDay')}</span>
          <input className="v2-input" type="number" min={1} max={31} value={f.pay_day} onChange={(e) => setF({ ...f, pay_day: e.target.value })} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('payd.wallet')}</span>
          <select className="v2-select" value={f.default_wallet_id} onChange={(e) => setF({ ...f, default_wallet_id: e.target.value })}>
            <option value="">—</option>{wallets.map((w) => <option key={w.id} value={String(w.id)}>{w.name} · {w.currency || 'IDR'}</option>)}
          </select></label>
      </div>
      <label className="v2-field"><span className="v2-field-label">{t('payd.notes')}</span><input className="v2-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <p className="v2-muted v2-small">{t('payd.ptkpLater')}</p>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}

export function PayrollRunDialog({ employees = [], wallets = [], payments = [], onClose, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const active = employees.filter((e) => e.status !== 'archived')
  const [period, setPeriod] = useState(thisMonth())
  const [date, setDate] = useState(today())
  const [walletId, setWalletId] = useState(String(active.find((e) => e.default_wallet_id)?.default_wallet_id || wallets[0]?.id || ''))
  // A person already paid for the chosen month starts unticked (no double salary by mistake).
  const paidIn = (p) => new Set(payments.filter((x) => (x.period_month || String(x.payment_date || '').slice(0, 7)) === p).map((x) => String(x.employee_id)))
  const [rows, setRows] = useState(() => { const paid = paidIn(thisMonth()); return active.map((e) => ({ id: e.id, name: e.name, salary: e.default_salary ? String(e.default_salary) : '', bonus: '', pph21: '', bpjs: '', other: '', on: !paid.has(String(e.id)) })) })
  const paid = useMemo(() => paidIn(period), [payments, period])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(0)
  const set = (i, k, v) => { setErr(''); setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r))) }
  const calc = (r) => { const g = num(r.salary) + num(r.bonus); const d = num(r.pph21) + num(r.bpjs) + num(r.other); return { gross: g, ded: d, net: g - d } }
  const totals = useMemo(() => rows.filter((r) => r.on).reduce((s, r) => { const c = calc(r); return { gross: s.gross + c.gross, pph: s.pph + num(r.pph21), bpjs: s.bpjs + num(r.bpjs), net: s.net + c.net } }, { gross: 0, pph: 0, bpjs: 0, net: 0 }), [rows])
  const twice = rows.some((r) => r.on && paid.has(String(r.id)))
  // An account may not go below zero (owner rule): the month's take-home must fit the balance.
  const wallet = wallets.find((w) => String(w.id) === walletId)
  const short = wallet && totals.net > Number(wallet.balance || 0) + 0.005
  const bad = rows.filter((r) => r.on).find((r) => r.pph21 === '' || Number.isNaN(calc(r).net) || calc(r).net <= 0)
  const save = async () => {
    if (short) { setErr(t('payd.err.short', { name: wallet.name, bal: money(wallet.balance, { full: true }), net: money(totals.net, { full: true }) })); return }
    if (bad) { setErr(bad.pph21 === '' ? t('payd.err.pph', { name: bad.name }) : t('payd.err.net', { name: bad.name })); return }
    setBusy(true); setErr('')
    let ok = 0
    try {
      for (const r of rows.filter((x) => x.on)) {
        const items = [{ item_type: 'salary', label: 'Salary', amount: num(r.salary), direction: 'addition' }]
        if (num(r.bonus) > 0) items.push({ item_type: 'bonus', label: 'Bonus and allowances', amount: num(r.bonus), direction: 'addition' })
        if (num(r.pph21) > 0) items.push({ item_type: 'pph21', label: 'PPh 21', amount: num(r.pph21), direction: 'deduction' })
        if (num(r.bpjs) > 0) items.push({ item_type: 'bpjs', label: 'BPJS (employee)', amount: num(r.bpjs), direction: 'deduction' })
        if (num(r.other) > 0) items.push({ item_type: 'other', label: 'Other deductions', amount: num(r.other), direction: 'deduction' })
        await recordPayrollPayment(token, { employee_id: r.id, employee_name: r.name, currency: 'IDR', period_month: period, payment_date: date, wallet_id: walletId || null, items: items.filter((x) => x.amount > 0) })
        ok++; setDone(ok)
      }
      onSaved?.(); onClose()
    } catch (x) {
      const d = x?.data
      setErr(d?.error === 'insufficient_balance' || d?.error === 'wallet_balance_negative' ? t('payd.err.money', { done: ok }) : t('payd.err.save', { done: ok, msg: d?.error || x?.message }))
      onSaved?.()
    } finally { setBusy(false) }
  }
  return (
    <Modal wide title={t('payd.runTitle')} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !rows.some((r) => r.on) || short} onClick={save} data-payd-run>{busy ? t('payd.saving', { n: done }) : t('payd.record')}</button></>}>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('payd.period')}</span><input className="v2-input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('payd.date')}</span><input className="v2-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('payd.wallet')}</span>
          <select className="v2-select" value={walletId} onChange={(e) => { setWalletId(e.target.value); setErr('') }}>{wallets.map((w) => <option key={w.id} value={String(w.id)}>{w.name} · {money(w.balance, { currency: w.currency || 'IDR', full: true })}</option>)}</select></label>
      </div>
      <div className="v2-payd-table" role="table" aria-label={t('payd.runTitle')}>
        <div className="v2-payd-row is-head" role="row">{['person', 'salary', 'bonus', 'pph21', 'bpjs', 'other', 'net'].map((k) => <span key={k} role="columnheader">{t(`payd.col.${k}`)}</span>)}</div>
        {rows.map((r, i) => {
          const c = calc(r)
          return (
            <div key={r.id} className={`v2-payd-row${r.on ? '' : ' is-off'}`} role="row">
              <label className="v2-pe-sug-row" role="cell"><input type="checkbox" checked={r.on} onChange={(e) => set(i, 'on', e.target.checked)} /><span>{r.name}{paid.has(String(r.id)) && <span className="v2-pill v2-tone-warn v2-payd-paid">{t('payd.alreadyPaid')}</span>}</span></label>
              {['salary', 'bonus', 'pph21', 'bpjs', 'other'].map((k) => (
                <input key={k} role="cell" className="v2-input v2-num" inputMode="decimal" value={r[k]} disabled={!r.on} aria-label={`${t(`payd.col.${k}`)} · ${r.name}`}
                  placeholder={k === 'pph21' ? t('payd.pphPh') : '0'} onChange={(e) => set(i, k, e.target.value)} />
              ))}
              <span role="cell" className="v2-num v2-r">{Number.isNaN(c.net) ? '—' : money(c.net, { full: true })}</span>
            </div>
          )
        })}
        <div className="v2-payd-row is-total" role="row"><span role="cell">{t('payd.total')}</span><span role="cell" className="v2-num">{money(totals.gross, { full: true })}</span><span /><span role="cell" className="v2-num">{money(totals.pph, { full: true })}</span><span role="cell" className="v2-num">{money(totals.bpjs, { full: true })}</span><span /><span role="cell" className="v2-num v2-r">{money(totals.net, { full: true })}</span></div>
      </div>
      {twice && <div className="v2-banner v2-tone-warn" role="status"><span className="v2-banner-text">{t('payd.twice', { m: period })}</span></div>}
      <div className="v2-banner v2-tone-info"><span className="v2-banner-text">{t('payd.after', { pph: money(totals.pph, { full: true }), bpjs: money(totals.bpjs, { full: true }) })}</span></div>
      <p className="v2-muted v2-small">{t('payd.pphNote')}</p>
      {short && <p className="v2-inline-err" role="alert" data-payd-short>{t('payd.err.short', { name: wallet.name, bal: money(wallet.balance, { full: true }), net: money(totals.net, { full: true }) })}</p>}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}
