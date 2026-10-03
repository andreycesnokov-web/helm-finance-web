// Designed placeholder for a v2 screen that is not built yet. Honest: says the
// screen is coming, never shows figures, and — where an existing page covers the
// same ground — links to it so no capability is lost while the redesign lands.
import I from '../icons'
import { PageHead, Card, Empty, Btn } from '../ui'
import { useT } from '../i18n'

export default function Placeholder({ titleKey, current, icon = 'performance' }) {
  const t = useT()
  const Ic = I[icon] || I.performance
  return (
    <>
      <PageHead title={t(titleKey)} />
      <Card>
        <Empty
          icon={<Ic size={28} />}
          title={t('placeholder.soon')}
          text={t('placeholder.redesign')}
          action={
            <div className="v2-row-gap">
              {current && <Btn variant="primary" to={current}>{t('placeholder.openCurrent')}</Btn>}
              <Btn to="/business/pulse">{t('placeholder.back')}</Btn>
            </div>
          }
        />
      </Card>
    </>
  )
}
