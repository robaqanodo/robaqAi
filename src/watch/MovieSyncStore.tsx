import { useLocale } from '../i18n/Locale'
import { useEffect, useRef, useState } from 'react'
export type MovieSyncStage = 'new' | 'downloaded' | 'active'
export function MovieSyncStore({ stage, onChange, onOpen }: { stage: MovieSyncStage; onChange: (stage: MovieSyncStage) => void; onOpen: () => void }) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const installing = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const finishDelay = useRef<(() => void) | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearTimeout(timer.current); finishDelay.current?.(); finishDelay.current = null } }, [])
  async function install() {
    if (installing.current) return
    installing.current = true; setBusy(true); setError('')
    try {
      // The skill ships with Smartass. Load its implementation before activation.
      await Promise.all([import('./WatchTogether'), new Promise<void>(resolve => {
        finishDelay.current = resolve
        timer.current = window.setTimeout(resolve, 3000)
      })])
      if (!mounted.current) return
      onChange('active')
      onOpen()
    } catch { if (mounted.current) setError('Could not prepare MovieSync. Please try again.') }
    finally { window.clearTimeout(timer.current); finishDelay.current = null; installing.current = false; if (mounted.current) setBusy(false) }
  }
  return <><div className="side-panel-item"><div className="side-panel-item-body"><span className="side-panel-item-name">{t("Moviesync 1.0")}</span><span className="side-panel-item-meta">{t("Synchronized video · Private room · Chat")}</span><span className="side-panel-item-meta">{t("Watch movies with friends, even when you’re in different places.")}</span></div><div className="model-actions">
    {busy ? <div className="moviesync-install" role="status" aria-live="polite"><span>{t("Installing…")}</span><span className="moviesync-install-track" aria-hidden="true"><i /></span></div> : stage === 'active' ? <><span className="translator-active-badge">{t("Active")}</span><button className="modal-btn danger" onClick={() => onChange('new')}>{t("Delete")}</button></> : <button className="modal-btn primary" onClick={() => void install()}>{t("Download")}</button>}
  </div></div>{error && <p className="modal-error" role="alert">{t(error)}</p>}</>
}
