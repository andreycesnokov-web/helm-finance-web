// Add asset (designs/AddAsset.dc.html). The asset register does not exist yet
// (PROPOSALS P-11), so nothing can be saved as an asset. What works today: the purchase
// invoice can be uploaded through the existing DocumentIntakeModal, so it is on file when
// the register lands. The document checklist per asset type is shown as guidance; useful
// life and depreciation come from the tax rules once the register exists — no rate is
// shown here.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import DocumentIntakeModal from '../../components/DocumentIntakeModal'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import I from '../icons'
import { PageHead, Card, Btn, NotYet } from '../ui'
import { useT } from '../i18n'

const TYPES = ['machines', 'vehicles', 'computers', 'furniture', 'buildings', 'imported']

export default function AddAsset() {
  const t = useT()
  const { active } = useWorkspace()
  const [upload, setUpload] = useState(false)
  const [type, setType] = useState('machines')
  return (
    <div className="v2-page">
      <PageHead title={t('screen.addAsset')} sub={t('addAsset.sub')} back={{ to: '/business/assets', label: t('nav.assets') }}
        actions={<><Btn to="/business/assets">{t('dec.cancel')}</Btn><NotYet note={t('addAsset.registerSoon')}>{t('addAsset.save')}</NotYet></>} />
      <ol className="v2-steps v2-card">
        {['s1', 's2', 's3', 's4'].map((k, i) => (
          <li key={k}><span className="v2-step-n" aria-hidden="true">{i + 1}</span>
            <span className="v2-check-text"><strong>{t(`addAsset.${k}`)}</strong><span className="v2-muted v2-small">{t(`addAsset.${k}Hint`)}</span></span></li>
        ))}
      </ol>
      <div className="v2-grid-detail">
        <div className="v2-col">
          <Card title={t('addAsset.invoice')}>
            <button type="button" className="v2-drop" onClick={() => setUpload(true)}>
              <I.upload size={24} /><strong>{t('docs.drop')}</strong><span className="v2-muted v2-small">{t('addAsset.invoiceHint')}</span>
              <span className="v2-btn v2-btn-primary">{t('docs.choose')}</span>
            </button>
          </Card>
          <Card title={t('addAsset.details')}>
            <div className="v2-banner v2-tone-warn"><I.info size={18} /><span className="v2-banner-text">{t('addAsset.registerNote')}</span></div>
            <div className="v2-field">
              <span className="v2-field-label" id="asset-type">{t('addAsset.type')}</span>
              <div className="v2-chips" role="radiogroup" aria-labelledby="asset-type">
                {TYPES.map((k) => <button key={k} type="button" role="radio" aria-checked={type === k} aria-pressed={type === k} className="v2-chip v2-chip-sel" onClick={() => setType(k)}>{t(`addAsset.t.${k}`)}</button>)}
              </div>
            </div>
            <p className="v2-muted v2-small">{t('addAsset.lifeNote')}</p>
          </Card>
        </div>
        <aside className="v2-col">
          <Card title={t('addAsset.docsFor', { type: t(`addAsset.t.${type}`) })}>
            <ul className="v2-check">
              {t(`addAsset.docs.${type}`).split('|').map((d) => (
                <li key={d}><span className="v2-check-mark" aria-hidden="true" /><span className="v2-check-text"><span>{d}</span></span><Link to="/business/documents">{t('bill.upload')}</Link></li>
              ))}
            </ul>
            <p className="v2-muted v2-small">{t('addAsset.docsNote')}</p>
          </Card>
        </aside>
      </div>
      {upload && <DocumentIntakeModal business={active} uploadSource="invoice_upload" defaultType="invoice" onClose={() => setUpload(false)} onUploaded={() => {}} />}
    </div>
  )
}
