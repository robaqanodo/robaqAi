import {SkillHelp} from '../components/SkillHelp'
import { finishInstallation, InstallProgress } from '../components/InstallProgress'
import { useLocale } from '../i18n/Locale'
import { useEffect, useRef, useState } from 'react'
export type MovieSyncStage = 'new' | 'downloaded' | 'active'
export function MovieSyncStore({ stage, onChange, onOpen }: { stage: MovieSyncStage; onChange: (stage: MovieSyncStage) => void; onOpen: () => void }) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const installing = useRef(false)
  const controller = useRef<AbortController|null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  async function install() {
    if (installing.current) return
    installing.current = true; setBusy(true); setError('')
    const abort = new AbortController(); controller.current = abort
    try {
      // The skill ships with robaqAI. Load its implementation before activation.
      await Promise.all([import('./WatchTogether'), finishInstallation(abort.signal)])
      if (!mounted.current || abort.signal.aborted) return
      onChange('active')
      onOpen()
    } catch { if (mounted.current && !abort.signal.aborted) setError('Could not prepare MovieSync. Please try again.') }
    finally { controller.current = null; installing.current = false; if (mounted.current) setBusy(false) }
  }
  return <><div className="side-panel-item"><div className="side-panel-item-body"><span className="side-panel-item-name">{t("Moviesync 1.0")}</span><span className="side-panel-item-meta">{t("Synchronized video · Private room · Chat")}</span></div><div className="model-actions"><SkillHelp name="Moviesync 1.0" steps={['Press Download and wait for Active. MovieSync opens automatically; later, open MovieSync from the main menu.','Create a room with a video link and password. Copy the invitation and share the password separately.','Guests join through the invitation. The host controls playback; everyone can chat. End room closes the session.','For website sharing, align and lock the frame, then follow the browser’s sharing prompt. Website restrictions may prevent playback.']}/>
    {busy ? <><InstallProgress label={t('Installing…')} finishing/><button type="button" className="modal-btn" onClick={()=>controller.current?.abort()}>{t('Cancel')}</button></> : stage === 'active' ? <><span className="translator-active-badge">{t("Active")}</span><button className="modal-btn danger" onClick={() => onChange('new')}>{t("Delete")}</button></> : <button className="modal-btn primary" onClick={() => void install()}>{t("Download")}</button>}
  </div></div>{error && <p className="modal-error" role="alert">{t(error)}</p>}</>
}
