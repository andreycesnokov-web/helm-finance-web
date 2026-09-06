// The Wallets zero-state: what the page says before a workspace has any accounts.
//
// It lives in its own module for one reason: the design preview has to be able to
// photograph the REAL thing. Previously the empty state existed twice — once as
// production markup in Accounts.jsx and once as a hand-copied concept block in
// DesignPreview.jsx — and the concept drifted immediately, ending up showing
// "Add your first wallet" underneath a card claiming four wallets and a balance of
// Rp 152 450 000. A state that cannot exist is worse evidence than no evidence.
// One component, imported by both, so the screenshot is the product.
//
// It is a zero state, not a marketing panel: one line on what this page will hold,
// one line on what to do, and the page's real Add-wallet control. No illustration
// beyond the official symbol, no feature list, no second call to action.
import { EmptyState, Btn, Icon } from '../shell/ui'

// The official mark, from the asset pipeline the rest of the product uses.
export const WALLETS_EMPTY_SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'

/**
 * @param t          the page's translation function — the copy stays in the i18n
 *                   layer rather than being frozen into this component
 * @param onAddWallet the page's EXISTING add-wallet action. This component must
 *                   never open a wallet form of its own: there is one wallet
 *                   creation flow and this is a button that calls it.
 */
export function WalletsEmptyState({ t, onAddWallet }) {
  return (
    <EmptyState
      symbol={WALLETS_EMPTY_SYMBOL}
      title={t('accounts.noWallets')}
      description={t('accounts.noWalletsSub')}
      actions={
        <Btn variant="primary" icon={<Icon.plus />} onClick={onAddWallet}>
          {t('accounts.addFirstWallet')}
        </Btn>
      }
    />
  )
}

export default WalletsEmptyState
