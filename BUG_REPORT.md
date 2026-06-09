# Helm Finance Web — Bug Report

Generated: 2026-06-09  
Verified: 2026-06-09 (all bugs confirmed against source code with exact line citations)

---

## CRITICAL — App breaks at runtime or is completely invisible

### BUG-01 · CSS color variables never defined
**Status: ✅ CONFIRMED**  
**Files:** `client/src/index.css`, `client/index.html`

The `:root` block in `index.css` only defines three layout tokens:
```css
:root {
  --sidebar-width: 220px;
  --right-panel: 300px;
  --radius: 12px;
}
```
There are no definitions for any color-bearing variables. `grep` confirms the variables are **used** but never defined:
- `index.css:13` — `color: var(--text)`
- `index.css:26` — `background: var(--bg)`
- `index.css:31` — `border-top: 0.5px solid var(--border)`
- Every component uses `var(--bg)`, `var(--bg-2)`, `var(--text)`, `var(--text-2)`, `var(--text-3)`, `var(--border)`, `var(--border-2)`, `var(--green)`, `var(--green-dark)`, `var(--green-light)`, `var(--red)`, `var(--red-dark)`, `var(--red-light)`, `var(--amber)`, `var(--amber-dark)`.

There is only **one** CSS file in `client/src/` (`index.css`). No other source CSS files exist.

**Impact:** All themed backgrounds, text colors, and borders render as transparent or browser-default. The UI is visually broken from first load.

---

### BUG-02 · `/api/transactions` references non-existent `categories` table
**Status: ✅ CONFIRMED**  
**File:** `server/index.js:208`

```js
let query = supabase.from('transactions').select('*, categories(name, emoji)')
```

`grep` on `migration_v3.sql` returns zero results for `categories`. Only `debts`, `reminders`, and an `ALTER TABLE accounts` exist in the migration. No `categories` table is defined anywhere in the repo.

PostgREST interprets `categories(name, emoji)` as a join on a foreign key relationship. Without the table, Supabase returns a schema error on every request to this endpoint.

**Impact:** `GET /api/transactions` is completely broken. Any page or feature calling it receives a server error.

---

### BUG-03 · AI parse prompt corrupted (mojibake encoding)
**Status: ✅ CONFIRMED**  
**File:** `server/index.js:249`

The message `content` string reads (verbatim from the file):
```
????? ??? ?????????? ? ??????. ????? ?????? JSON ?????? ??? markdown:
[{"type":"expense ??? income","amount":?????,...}]
?????: "${text}"
```
Every Cyrillic character has been replaced with `?`. Claude receives an all-question-mark prompt and cannot parse it as a Russian instruction. The rest of the prompt — the JSON schema template — is also corrupted (`expense ??? income`, `?????` for the amount field).

This same encoding corruption appears in comments at lines 76, 81 and in strings at lines 148, 296, 338 (see BUG-06).

**Impact:** The AI transaction parsing feature — the primary input mechanism — is completely broken.

---

### BUG-14 · `.topbar` and `.card` CSS classes are never defined *(new)*
**Status: ✅ CONFIRMED**  
**File:** `client/src/index.css` (no definition); used in 4 page files

`grep` confirms these class names are used across pages but have zero definitions in the only CSS file:

| File | Line | Usage |
|------|------|-------|
| `Add.jsx` | 84 | `className="topbar"` |
| `Accounts.jsx` | 95 | `className="topbar"` |
| `Accounts.jsx` | 134, 192 | `className="card"` |
| `Radar.jsx` | 54 | `className="topbar"` |
| `Radar.jsx` | 106, 146 | `className="card"` |
| `Settings.jsx` | 101 | `className="topbar"` |

Elements render as unstyled `<div>`s with no padding, no border, no background, no height. The topbar (page header row) and card (content block) layout is completely broken.

**Impact:** All pages except Pulse (which doesn't use `.card`/`.topbar`) lose their structural layout.

---

## MAJOR — Feature broken or produces wrong output

### BUG-04 · Avatar initial always shows 'A' (`user.first_name` vs `user.firstName`)
**Status: ✅ CONFIRMED**  
**Files:** `client/src/hooks/useAuth.jsx:17`, `client/src/pages/Pulse.jsx:103`

`useAuth.jsx:17` — sets camelCase:
```js
setUser({ id: payload.userId, firstName: payload.firstName })
```

`Pulse.jsx:103` — reads snake_case:
```jsx
{user?.first_name?.[0] || 'A'}
```

`user.first_name` is always `undefined`. The avatar always shows **'A'**.

---

### BUG-05 · Duplicate `RightPanel` renders inside Pulse main column (desktop)
**Status: ✅ CONFIRMED**  
**Files:** `client/src/pages/Pulse.jsx:6, 277`; `client/src/App.jsx:142`

Two locations render `<RightPanel>`:
1. `App.jsx:142` — `PulseWrapper` passes `<RightPanel data={pulseData} />` as the `rightPanel` prop to `Layout`, which places it in the `desktop-layout` flex row as the `desktop-right` panel (correct).
2. `Pulse.jsx:6` — `import { RightPanel } from '../App'`, then `Pulse.jsx:277` — `<RightPanel data={d} scope={scope} />` rendered inside the page body (wrong).

On **desktop**: the extra `RightPanel` (with `className="desktop-right"`, `position: sticky`, `height: 100vh`) renders at the bottom of `.desktop-main` after Financial Vitals — a visible 300px-wide sticky block inside the main scroll column.

On **mobile**: `.desktop-right` is `display: none` (media query in `index.css:140`), so both instances are hidden. No visible impact on mobile.

The `scope` prop on line 277 is also passed but `RightPanel` doesn't accept it (its signature is `({ data })`).

---

### BUG-06 · Corrupted separator characters in server description strings
**Status: ✅ CONFIRMED**  
**File:** `server/index.js:148, 296, 338`

Same mojibake corruption as BUG-03. The affected lines contain a garbled byte where a separator character (likely `·`) was stored:

```js
// line 148
meta: `${Number(d.amount).toLocaleString('en-US')} IDR  ${...}` // corrupted between IDR and ${}
// line 296
description: `Balance adjustment  ${name}`  // corrupted between "adjustment" and name
// line 338
description: `Opening balance  ${name}`     // corrupted between "balance" and name
```

These get saved directly to the `transactions.description` column in Supabase.

---

### BUG-07 · `accounts/rename` sets `scope: type` where `type` may be `undefined`
**Status: ⚠️ PARTIALLY CONFIRMED**  
**File:** `server/index.js:320`

```js
.update({ source: newName, scope: type })
```

The current UI (`Accounts.jsx`) always sends `type` from `form.type`, which is initialized from `acc.type` (always `'personal'` or `'business'`). So this is **not reachable from the current UI**.

However, the server does zero validation on `type`. A direct API call without `type` would set `scope = undefined`, which Supabase silently drops from the UPDATE (the column retains its previous value). This is a server-side validation gap, not a runtime crash.

**Impact:** Low in production with the current client. Partial bug: the guard should exist server-side regardless.

---

## MINOR — Degraded UX or incomplete feature

### BUG-08 · i18n nested-key fallback uses flat key lookup (broken for unsupported languages)
**Status: ✅ CONFIRMED**  
**File:** `client/src/i18n/index.js:12`

```js
return val || translations['en']?.[key] || key
```

`translations['en']` is a nested object. `translations['en']?.['settings.title']` evaluates to `undefined` (no flat key exists). The fallback should traverse the dot-path exactly as the primary lookup does. This only triggers when `currentLang` is not `'ru'` or `'en'` (both are fully implemented). For the 13 other languages listed in Settings, every translation call returns the raw key string.

---

### BUG-09 · Accounts.jsx modal overlay clipped to 430px on desktop
**Status: ⚠️ PARTIALLY CONFIRMED**  
**File:** `client/src/pages/Accounts.jsx:214–215`

The modal overlay:
```js
style={{
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  maxWidth: 430, margin: '0 auto'   ← THE BUG
}}
```

`maxWidth: 430` constrains the overlay to a 430px strip centered on screen. On desktop (>1024px), the dark overlay covers only the center 430px, leaving the sidebar and right panel fully visible and clickable while the modal is "open". This is the actual bug, regardless of portal usage.

Note: `position: fixed` without `createPortal` does NOT itself cause a problem here — no ancestor has `transform`/`filter`/`perspective` that would alter the fixed-position containing block.

---

### BUG-10 · Settings.jsx modal overlays clipped to 430px on desktop
**Status: ⚠️ PARTIALLY CONFIRMED**  
**File:** `client/src/pages/Settings.jsx:186, 204, 219`

All three modals (Language, Timezone, Sign Out) have the identical pattern:
```js
style={{ position: 'fixed', inset: 0, ..., maxWidth: 430, margin: '0 auto' }}
```

Same root cause as BUG-09. On desktop: partial overlay covering only 430px center strip.

---

### BUG-11 · Snooze button is a UI stub (`alert()` only)
**Status: ✅ CONFIRMED**  
**File:** `client/src/pages/Pulse.jsx:359`

```js
onClick={() => { alert('Snoozed: ' + opt.label); setSnoozeModal(null) }}
```

No API call is made. The snooze modal UI exists (4 time options rendered) but does nothing except show a browser alert. This is an incomplete feature, not a regression.

---

### BUG-12 · Login language buttons have no `onClick` handler
**Status: ✅ CONFIRMED**  
**File:** `client/src/pages/Login.jsx:65–67`

```jsx
{['EN', 'RU', 'ID'].map(l => (
  <button key={l} style={...}>{l}</button>
))}
```

No `onClick`. Clicking does nothing.

---

### BUG-13 · `#root` max-width conflict between index.html and index.css
**Status: ❌ FALSE POSITIVE**  
**Files:** `client/index.html:27`, `client/src/index.css:17`

`index.html` inline: `#root { max-width: 430px; margin: 0 auto; }`  
`index.css`: `#root { max-width: 100% !important; display: flex; }`

The `!important` in `index.css` correctly overrides `max-width: 430px`. The `margin: 0 auto` from `index.html` persists but is harmless on a 100%-wide flex container. `display: flex` applies correctly. No visual conflict results. **Removing from the fix plan.**

---

## Summary Table

| ID | Status | Severity | Area | Description |
|----|--------|----------|------|-------------|
| BUG-01 | ✅ Confirmed | **Critical** | CSS | Color variables (`--bg`, `--text`, etc.) never defined |
| BUG-02 | ✅ Confirmed | **Critical** | Server | `/api/transactions`: `categories` join on missing table |
| BUG-03 | ✅ Confirmed | **Critical** | Server | AI parse prompt corrupted (mojibake) |
| BUG-14 | ✅ Confirmed | **Critical** | CSS | `.topbar` and `.card` classes never defined |
| BUG-04 | ✅ Confirmed | **Major** | Client | `user.first_name` vs `user.firstName` → avatar always 'A' |
| BUG-05 | ✅ Confirmed | **Major** | Client | Duplicate `RightPanel` inside Pulse page body (desktop) |
| BUG-06 | ✅ Confirmed | **Major** | Server | Corrupted separator chars in transaction descriptions |
| BUG-07 | ⚠️ Partial | **Major** | Server | `accounts/rename`: no server-side validation on `type` |
| BUG-08 | ✅ Confirmed | **Minor** | Client | i18n fallback broken for unsupported languages |
| BUG-09 | ⚠️ Partial | **Minor** | Client | Accounts modal: 430px `maxWidth` clips overlay on desktop |
| BUG-10 | ⚠️ Partial | **Minor** | Client | Settings modals: same 430px clip issue |
| BUG-11 | ✅ Confirmed | **Minor** | Client | Snooze is a stub (no API call, just `alert()`) |
| BUG-12 | ✅ Confirmed | **Minor** | Client | Login language buttons: no `onClick` handler |
| BUG-13 | ❌ False positive | — | CSS | `#root` conflict resolved by `!important`; no impact |
