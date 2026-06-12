# CFO AI Telegram Bot

Companion bot for the CFO AI web app. It is a **thin interface** — it never
touches the database, only calls the backend with the `x-bot-secret` header.

## Run

```bash
cd helm-finance-bot
npm install
cp .env.example .env   # fill BOT_TOKEN, CFO_API_URL, TELEGRAM_WEBHOOK_SECRET
npm start
```

Requires Node 18+ (uses global `fetch`).

## Environment

| Var | Where | Notes |
|---|---|---|
| `BOT_TOKEN` | bot | From @BotFather |
| `CFO_API_URL` | bot | Backend base URL, no trailing slash |
| `TELEGRAM_WEBHOOK_SECRET` | bot **and** web | Must match on both sides; falls back to `BOT_TOKEN` if unset |
| `TELEGRAM_BOT_USERNAME` | web | e.g. `HCfinance_Bot` — used to build deep links |

## Flows

1. **Connect** — user opens `https://t.me/<bot>?start=cfo_<memberId32>_<hmac10>`
   from the web tutorial → bot calls `POST /api/telegram/connect`.
2. **Training** — messages starting with `TEST:` / `ТЕСТ:` are classified
   (payable / receivable / expense_request) and sent to
   `POST /api/team/onboarding/training-submission` (`is_training=true`, no cash impact).
3. **Real** — non-TEST financial messages call `POST /api/debts/from-telegram`
   → pending-approval record (owner/admin approves in the web app).

## Limitations (V1)

- No inline Approve/Reject callback buttons (next task).
- No voice / photo / invoice OCR.
- Single-business members only; multi-business `409` is not yet disambiguated.
- Heuristic NLP parser (keywords + simple amount/date), not a full model.
