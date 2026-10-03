// Design v2 icon set — paths copied from _specs/design-v2/designs (Sidebar, Main,
// PulseMobile). Stroke icons on currentColor, decorative by default: every icon
// is aria-hidden; the control around it carries the accessible name.
const S = ({ children, size = 18, className = '', ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} className={`v2-ic ${className}`}
    aria-hidden="true" focusable="false" {...p}>{children}</svg>
)

export const I = {
  pulse: (p) => <S {...p}><path d="M3 12h4l3-8 4 16 3-8h4" /></S>,
  radar: (p) => <S {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></S>,
  performance: (p) => <S {...p}><path d="M4 20h16" /><path d="M7 16v-5M12 16V6M17 16v-8" /></S>,
  cfo: (p) => <S {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></S>,
  accounts: (p) => <S {...p}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 15h2" /></S>,
  transactions: (p) => <S {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></S>,
  funding: (p) => <S {...p}><path d="M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9 9.3 12 10s5 2 5 4-2.2 3.5-5 3.5-5-1.4-5-3.3" /></S>,
  assets: (p) => <S {...p}><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></S>,
  bills: (p) => <S {...p}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></S>,
  payroll: (p) => <S {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 8h5M19.5 5.5v5" /></S>,
  approvals: (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></S>,
  counterparties: (p) => <S {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6 6 0 0 0-2.5-4.9" /></S>,
  documents: (p) => <S {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></S>,
  accountant: (p) => <S {...p}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M8 7h7M8 11h7" /></S>,
  settings: (p) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></S>,
  admin: (p) => <S {...p}><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /></S>,
  person: (p) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></S>,
  plus: (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>,
  bell: (p) => <S {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></S>,
  chevDown: (p) => <S {...p}><path d="M6 9l6 6 6-6" /></S>,
  chevRight: (p) => <S {...p}><path d="M9 6l6 6-6 6" /></S>,
  chevLeft: (p) => <S {...p}><path d="M15 6l-6 6 6 6" /></S>,
  menu: (p) => <S {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>,
  close: (p) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>,
  upload: (p) => <S {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></S>,
  clock: (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>,
  warn: (p) => <S {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></S>,
  check: (p) => <S {...p}><path d="M5 12l5 5 9-10" /></S>,
  info: (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></S>,
  search: (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></S>,
  arrowUp: (p) => <S {...p}><path d="M12 19V5M5 12l7-7 7 7" /></S>,
  arrowDown: (p) => <S {...p}><path d="M12 5v14M19 12l-7 7-7-7" /></S>,
  send: (p) => <S {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></S>,
  link: (p) => <S {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></S>,
  table: (p) => <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></S>,
}

export default I
