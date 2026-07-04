# Decisions - CFO AI / Helm Finance

Last updated: 2026-07-04.

## D1 - Email is Primary Identity

Decision:

- Email registration/login is a free identity entry.
- Product usage can be gated by plan/trial after identity is created.

Reason:

- Email is universal and works before Telegram or business workspace setup.

Impact:

- Do not block email registration behind payment.
- Do not make Telegram the primary login again.

## D2 - Telegram is Legacy Login and Future Paid/Add-on Channel

Decision:

- Telegram login remains for existing users.
- Telegram bot/channel is future paid/add-on for new flows.

Reason:

- Telegram is useful for lightweight employee submissions and notifications, but should not be the identity foundation.

Impact:

- Keep `/login/telegram` as legacy access.
- Future Telegram linking/cutover requires explicit plan.

## D3 - Personal and Business Money Are Separate

Decision:

- Personal wallets and business wallets are different financial contexts.
- No implicit transfer between personal and business.

Reason:

- Legal/accounting separation and trust.

Impact:

- Personal rows use personal workspace + `scope='personal'`.
- Business rows use business workspace + `scope='business'`.
- Bridge flows must be explicit and audited later.

## D4 - Personal Workspace Uses a `businesses.type='personal'` Row

Decision:

- Personal finance reuses existing workspace tables, but with a personal type and strict scope.

Reason:

- Reuse wallet/transaction/category infrastructure while preserving isolation.

Impact:

- Business resolver must reject personal workspaces.
- Personal resolver must reject business workspace ids.

## D5 - Premium UI Must Be Flagged

Decision:

- Premium Business UI and Personal v1 UI ship behind flags.

Reason:

- Allows safe dark deploys without production behavior changes.

Impact:

- Build OFF and ON when applicable.
- Production flag changes require explicit owner go.

## D6 - Engine Calculates, AI Explains

Decision:

- Deterministic engine computes financial/tax values.
- AI explains, summarizes, and guides.

Reason:

- Avoid fake or hallucinated financial numbers.

Impact:

- If source data is missing, show `insufficient_data` or `unavailable`.
- Do not invent tax values.

## D7 - Canonical Docs Are Local `_specs/`

Decision:

- Local `_specs/` is the source of truth for specs/roadmap.
- Google Drive docs are final exports only after explicit approval.

Reason:

- Avoid fragmented memory between AI agents and Drive copies.

