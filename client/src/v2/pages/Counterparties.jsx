// Counterparties v2 (designs/Counterparties). GET /api/counterparties (existing,
// business-scoped) joined in the browser with open balances from GET /api/debts.
// The full editing directory (edit, archive, bank accounts, documents) is the
// existing page, one click away under "Manage" — nothing it did is lost.
// Duplicates are never merged here: the server's duplicate check runs on create.
import { useMemo, useState } from 'react'
import CounterpartiesLegacy from '../../pages/business/Counterparties'
import { Page, Card, Btn, Pill, Tabs, Loading, ErrorBox, Empty, ViewSwitch } from '../ui'
import { useV2T } from '../lib/i18n'
import { useV2Data } from '../lib/data'
import { useView } from '../lib/useView'
import { asList } from '../lib/debts'
import { money } from '../lib/format'
import { P } from '../routes'
import { balancesByCounterparty, missingDetails } from '../lib/derive'

const ROLE_KEY = { customer: 'cp.customer', vendor: 'cp.supplier', both: 'cp.both', tax_authority: 'cp.taxOffice', bank: 'cp.bank', employee: 'cp.employee', other: 'cp.other' }




export default function Counterparties() {
  const { t } = useV2T()
  const [view, setView] = useView()
  const [filter, setFilter] = useState('all')
  const cpQ = useV2Data(view === 'overview' ? '/counterparties' : null)
  const debtsQ = useV2Data(view === 'overview' ? '/debts' : null, { silent: true })
  const cps = cpQ.data?.counterparties || []
  const bal = useMemo(() => balancesByCounterparty(cps, asList(debtsQ.data)), [cps, debtsQ.data])

  const isCustomer = (c) => c.role === 'customer' || c.role === 'both'
  const isSupplier = (c) => c.role === 'vendor' || c.role === 'both'
  const counts = { all: cps.length, customers: cps.filter(isCustomer).length, suppliers: cps.filter(isSupplier).length, missing: cps.filter(missingDetails).length }
  const rows = cps.filter((c) => filter === 'all' || (filter === 'customers' ? isCustomer(c) : filter === 'suppliers' ? isSupplier(c) : missingDetails(c)))

  const actions = <>
    <ViewSwitch view={view} onChange={setView} overviewLabel={t('view.overview')} manageLabel={t('view.manage')} />
    <Btn variant="primary" icon="plus" to={P.counterpartyNew}>{t('cp.add')}</Btn>
  </>
  if (view === 'manage') return <Page title={t('nav.counterparties')} sub={t('cp.sub')} actions={actions}><div className="v2-legacy-embed"><CounterpartiesLegacy /></div></Page>

  return (
    <Page title={t('nav.counterparties')} sub={t('cp.sub')} actions={actions}>
      {cpQ.error ? <ErrorBox error={cpQ.error} onRetry={cpQ.reload} /> : cpQ.loading ? <Card><Loading rows={6} /></Card> : <>
        <Tabs label={t('cp.filter')} active={filter} onChange={setFilter} items={[
          { key: 'all', label: t('cp.fAll', { n: counts.all }) }, { key: 'customers', label: t('cp.fCustomers', { n: counts.customers }) },
          { key: 'suppliers', label: t('cp.fSuppliers', { n: counts.suppliers }) }, { key: 'missing', label: t('cp.fMissing', { n: counts.missing }) }]} />
        <Card flush className="v2-pad-table">
          {rows.length === 0 ? <Empty icon="users" title={t('cp.empty')} action={<Btn variant="primary" icon="plus" to={P.counterpartyNew}>{t('cp.add')}</Btn>} /> : <>
            <div className="v2-table-wrap"><table className="v2-table v2-table-cp">
              <thead><tr><th>{t('cp.colName')}</th><th>{t('cp.colType')}</th><th>{t('cp.colBalance')}</th><th>{t('cp.colTax')}</th><th><span className="v2-sr">{t('bills.colAction')}</span></th></tr></thead>
              <tbody>{rows.map((c) => { const b = bal[c.id] || {}; return (
                <tr key={c.id}>
                  <td className="ellipsis"><span className="v2-strong">{c.display_name || c.name}</span>{c.legal_name && c.legal_name !== (c.display_name || c.name) ? <div className="is-muted v2-small">{c.legal_name}</div> : null}</td>
                  <td>{t(ROLE_KEY[c.role] || 'cp.other')}</td>
                  <td>{b.owesYou ? <span className={b.late ? 'is-neg' : ''}>{t('cp.owes', { v: money(b.owesYou) })}{b.late ? ` · ${t('cp.late')}` : ''}</span>
                    : b.youOwe ? t('cp.youOwe', { v: money(b.youOwe) }) : <span className="is-muted">—</span>}</td>
                  <td className="v2-small">{[c.pkp_status === 'pkp' ? 'PKP' : c.pkp_status === 'non_pkp' ? 'Non-PKP' : null,
                    c.npwp ? t('cp.npwpOnFile') : t('cp.noNpwp')].filter(Boolean).join(' · ')}</td>
                  <td className="r">{missingDetails(c) ? <Pill tone="warning">{t('cp.missingDetails')}</Pill> : null}</td>
                </tr>) })}</tbody>
            </table></div>
          </>}
        </Card>
        <p className="v2-cardsub">{t('cp.payHistoryGap')}</p>
      </>}
    </Page>
  )
}

