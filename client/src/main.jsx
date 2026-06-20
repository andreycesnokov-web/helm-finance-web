import React from 'react'
import ReactDOM from 'react-dom/client'
// Self-hosted OFL brand webfonts (Fontsource — no external Google CDN requests).
// All ship font-display: swap; variable subsets lazy-load via unicode-range.
//   Manrope (UI, incl. Cyrillic for RU)   — main product font
//   Archivo Black (display, latin only)   — major headings; RU/ID display falls back to Manrope ExtraBold
//   JetBrains Mono (codes/IDs/FX/crypto)  — technical/machine-readable
import '@fontsource-variable/manrope/index.css'
import '@fontsource/archivo-black/latin.css'
import '@fontsource/archivo-black/latin-ext.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './brand/tokens.css'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
