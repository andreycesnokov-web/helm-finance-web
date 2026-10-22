// Payroll windows (designs w2/F1 employee, F2 pay a month) — replace payroll/manage in v2.
// Employee CRUD is retained. The F2 run dialog saves one draft through the atomic
// payroll run endpoint; saving or approving never transfers money.
// PTKP status, NIK / NPWP and BPJS registration wait for a database update (not shown as saved).
import { useRef, useState } from 'react'
import { useBusinessRequest } from '../lib/useBusinessRequest'
import { useT } from '../i18n'
import { money } from '../lib/format'
import Modal from './Modal'
import { createEmployee, updateEmployee, archiveEmployee } from '../lib/actions'
import { parsePayrollMoney, payrollErrorMessage } from '../lib/payrollRunModel'

const num = parsePayrollMoney

export function EmployeeDialog({ employee = null, wallets = [], onClose, onSaved }) {
  const t = useT()
  const request = useBusinessRequest()
  const inFlight = useRef(false)
  const [f, setF] = useState({ name: employee?.name || '', role: employee?.role || '', default_salary: employee?.default_salary ? String(employee.default_salary) : '',
    pay_day: employee?.pay_day ? String(employee.pay_day) : '25', default_wallet_id: employee?.default_wallet_id ? String(employee.default_wallet_id) : '', notes: employee?.notes || '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [askArchive, setAskArchive] = useState(false)
  const salary = num(f.default_salary)
  const run = async (fn) => { if(inFlight.current)return;inFlight.current=true;setBusy(true); setErr(''); try { await fn(); onSaved?.(); onClose() } catch (x) { if(x.code!=='workspace_changed')setErr(x?.status === 403 ? t('dec.forbidden') : payrollErrorMessage(x,t)) } finally { inFlight.current=false;setBusy(false) } }
  const body = () => ({ name: f.name.trim(), role: f.role.trim() || null, default_salary: salary || null, currency: employee?.currency || 'IDR', pay_day: Number(f.pay_day) || null, default_wallet_id: f.default_wallet_id || null, notes: f.notes.trim() || null, ...(employee?.updated_at ? {expected_updated_at:employee.updated_at}: {}) })
  if (askArchive) {
    return (
      <Modal title={t('payd.archTitle', { name: employee.name })} onClose={() => setAskArchive(false)}
        footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setAskArchive(false)}>{t('set.cancel')}</button>
          <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => run(() => archiveEmployee(request, employee.id, employee.updated_at ? {expected_updated_at:employee.updated_at}: {}))}>{t('payd.archive')}</button></>}>
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
          onClick={() => run(() => (employee ? updateEmployee(request, employee.id, body()) : createEmployee(request, body())))} data-payd-save>{employee ? t('set.save') : t('payd.add')}</button></>}>
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

export {default as PayrollRunDialog} from './PayrollRunDialog'
