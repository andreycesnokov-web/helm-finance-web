// CFO AI redesign v2 — build-time flag. Default OFF.
//
// Vite substitutes import.meta.env at build time. App.jsx reads the same variable to
// decide whether the lazy v2 chunk is reachable at all; this module exists so v2 code
// (and its tests) can name the flag in one place.
export const DESIGN_V2 = import.meta.env?.VITE_DESIGN_V2 === 'true'
export default DESIGN_V2
