import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializeMobile } from './mobile'
import './mobile.css'
import { migrateBrandPreferences } from './brandMigration'

migrateBrandPreferences()
initializeMobile()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Cache the production web shell and local WASM runtime for offline reopening.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}
