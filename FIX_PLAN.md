# Helm Finance Web — Fix Plan

## Guiding principles
- Fix bugs only. No new features, no refactors, no product direction changes.
- Fix in order of severity: Critical → Major → Minor.
- Each fix is isolated to the smallest possible change.

---

## Phase 1 — Critical fixes (app unusable without these)

### FIX-01 · Define CSS color variables
**Bug:** BUG-01  
**File:** `client/src/index.css`  
**Change:** Add `:root { ... }` block with all color tokens that the app uses.

Tokens needed (from scanning all component files):
```css
:root {
  /* existing layout tokens */
  --sidebar-width: 220px;
  --right-panel: 300px;
  --radius: 12px;

  /* NEW: color tokens (light theme) */
  --bg:        #FFFFFF;
  --bg-2:      #F7F8FA;
  --text:      #111111;
  --text-2:    #444444;
  --text-3:    #9CA3AF;
  --border:    rgba(0,0,0,0.08);
  --border-2:  rgba(0,0,0,0.14);
  --green:     #16A34A;
  --green-dark:#15803D;
  --green-light:#DCFCE7;
  --red:       #E24B4A;
  --red-dark:  #B91C1C;
  --red-light: #FEE2E2;
  --amber:     #D97706;
  --amber-dark:#B45309;
}
```

---

### FIX-02 · Remove `categories` join from `/api/transactions`
**Bug:** BUG-02  
**File:** `server/index.js:208`  
**Change:**
```js
// Before
let query = supabase.from('transactions').select('*, categories(name, emoji)')
// After
let query = supabase.from('transactions').select('*')
```

---

### FIX-03 · Restore corrupted AI prompt
**Bug:** BUG-03  
**File:** `server/index.js:249`  
**Change:** Replace the garbled `?????` text with the correct Russian instruction. The intended prompt (reconstructed from context):
```js
content: `Ты CFO-ассистент. Разбери следующий текст и верни ТОЛЬКО JSON массив без markdown:
[{"type":"expense или income","amount":число,"currency":"IDR","description":"описание","source":"источник или null","scope":"personal или business","project":"Helm Care или null"}]

Текст: "${text}"`
```

---

## Phase 2 — Major fixes (wrong behavior, data corruption)

### FIX-04 · Fix `user.first_name` → `user.firstName` in Pulse.jsx
**Bug:** BUG-04  
**File:** `client/src/pages/Pulse.jsx:103`  
**Change:**
```jsx
// Before
{user?.first_name?.[0] || 'A'}
// After
{user?.firstName?.[0] || 'A'}
```

---

### FIX-05 · Remove duplicate RightPanel from Pulse.jsx
**Bug:** BUG-05  
**File:** `client/src/pages/Pulse.jsx`  
**Changes:**
1. Remove import line 6: `import { RightPanel } from '../App'`
2. Remove JSX line 277: `<RightPanel data={d} scope={scope} />`

---

### FIX-06 · Restore corrupted description strings in server
**Bug:** BUG-06  
**File:** `server/index.js` lines 148, 296, 338  
**Changes:** Replace corrupted characters with clean separators (·):
```js
// Line 148 (todayFocus meta)
meta: `${Number(d.amount).toLocaleString('en-US')} IDR · ${daysLeft > 0 ? daysLeft + ' days' : 'today'}`,

// Line 296 (accounts/adjust description)
description: `Balance adjustment · ${name}`,

// Line 338 (accounts/create description)
description: `Opening balance · ${name}`,
```

---

### FIX-07 · Guard `scope: undefined` in accounts/rename
**Bug:** BUG-07  
**File:** `server/index.js:319-323`  
**Change:**
```js
// Build update object conditionally
const updates = { source: newName }
if (type !== undefined) updates.scope = type
const { error } = await supabase.from('transactions')
  .update(updates)
  .eq('user_id', req.user.userId)
  .eq('source', oldName)
```

---

## Phase 3 — Minor fixes (degraded UX, incomplete features)

### FIX-08 · Fix i18n nested key fallback
**Bug:** BUG-08  
**File:** `client/src/i18n/index.js:8-13`  
**Change:**
```js
export const t = (key) => {
  const keys = key.split('.')
  let val = translations[currentLang]
  for (const k of keys) val = val?.[k]
  if (val) return val
  // Fallback: try English with same dot-path traversal
  let fallback = translations['en']
  for (const k of keys) fallback = fallback?.[k]
  return fallback || key
}
```

---

### FIX-09 · Accounts.jsx modal: use createPortal
**Bug:** BUG-09  
**File:** `client/src/pages/Accounts.jsx`  
**Change:** Import `createPortal` from `react-dom` and wrap the `showAdd` modal div with `createPortal(..., document.body)`.

---

### FIX-10 · Settings.jsx modals: use createPortal
**Bug:** BUG-10  
**File:** `client/src/pages/Settings.jsx`  
**Change:** Import `createPortal` from `react-dom` and wrap all three modals (showLang, showTz, showLogout) with `createPortal(..., document.body)`.

---

### FIX-11 · Clean up #root conflict in index.html
**Bug:** BUG-13  
**File:** `client/index.html:27`  
**Change:** Remove the `#root { max-width: 430px; margin: 0 auto; }` rule. Move the mobile-safe-area body padding to `index.css` body rule. The `index.css` `#root` rule already handles the layout correctly.

---

## Out of scope (stubs, not bugs)

The following are **incomplete features**, not bugs. They are NOT included in this fix plan per the task instructions ("do not change product direction"):

- **Snooze API call** (BUG-11): Requires new product decision on snooze behavior.
- **Login language buttons** (BUG-12): Requires `useTranslation` wired into Login; minor UX improvement.

These can be addressed in a follow-up sprint.

---

## Execution order

```
Phase 1:  FIX-01, FIX-02, FIX-03   ← Do these first; app is non-functional without them
Phase 2:  FIX-04, FIX-05, FIX-06, FIX-07
Phase 3:  FIX-08, FIX-09, FIX-10, FIX-11
```

Total changes: 4 server lines, ~50 CSS lines, ~20 client lines across 6 files.
No new files needed. No schema changes needed.

---

**Awaiting approval before implementation.**
