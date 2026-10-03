// Designed placeholder for a v2 screen that is not built yet. Always offers a way
// back — never a dead end.
import { Page, Card, Empty, Btn } from '../ui'
import { useV2T } from '../lib/i18n'
import { P } from '../routes'

export default function Placeholder({ titleKey, icon = 'clock' }) {
  const { t } = useV2T()
  const screen = t(titleKey)
  return (
    <Page title={screen}>
      <Card>
        <Empty icon={icon} title={t('ph.title')} body={t('ph.body', { screen })}
          action={<Btn variant="primary" to={P.pulse}>{t('ph.back')}</Btn>} />
      </Card>
    </Page>
  )
}
