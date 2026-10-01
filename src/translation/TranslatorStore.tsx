import { InstallProgress, finishInstallation } from '../components/InstallProgress'
import { useLocale } from '../i18n/Locale'
import { useEffect, useState } from 'react'
import { PACK_MIB, downloadPack, installPack, packInstalled, removePack, setTranslationPackActive, translationPackActive } from './package'
import './translator.css'

export function TranslatorStore({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const { t } = useLocale()

  const [installed, setInstalled] = useState(false)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { void packInstalled().then(ready => { setInstalled(ready); setActive(ready && translationPackActive()) }) }, [])
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  const installDirect = async () => {
    if (busy) return
    setBusy(true); setFinishing(false); setError(''); setStatus(`Loading the ${PACK_MIB} MB language pack…`)
    try {
      const blob = await downloadPack(setStatus)
      await installPack(blob, setStatus)
      setFinishing(true); setStatus('Installing…'); await finishInstallation()
      setTranslationPackActive(true); setActive(true); setInstalled(true); setStatus('Translator is installed and active.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Installation failed.'); setStatus(''); setInstalled(await packInstalled()) }
    finally { setFinishing(false); setBusy(false) }
  }
  return <section className="translator-languages" aria-labelledby="offline-skills-title">
    <ul className="side-panel-list">
      <li className="side-panel-item">
        <details className="store-info translator-info"><summary aria-label="Translator information">?</summary><div className="translator-info-popover"><p className="modal-help">{t("English, Georgian and Russian share one")} {PACK_MIB} {t("MB pack. Powered by Meta M2M100 (MIT), not Google Translate. Installation may take a few minutes.")}</p><p className="modal-help">{t("The same pack enables all three skills. Keep this screen open during installation.")}</p></div></details>
        <div className="side-panel-item-body"><span className="side-panel-item-name">M2M100</span><span className="side-panel-item-meta">Offline Translator Pack - EN, KA, RU 611MB</span></div>
        <div className="translator-row-actions">{busy ? <InstallProgress label={t(status)||'Working…'} finishing={finishing} /> : active ? <span className="translator-active-badge">Active</span> : <button className="modal-btn primary" disabled={busy} onClick={() => void installDirect()}>{t("Download")}</button>}{installed && <button className="modal-btn danger translator-delete" title={t('Delete removes the shared English, Georgian and Russian pack from this device.')} disabled={busy} onClick={async () => { setBusy(true); setError(''); setStatus(''); try { await removePack(); setInstalled(false); setActive(false) } catch { setError('Could not delete the translation pack. Please try again.') } finally { setFinishing(false); setBusy(false) } }}>{t('Delete')}</button>}</div>
      </li>
    </ul>
    
    {!busy && <p role="status" aria-live="polite" className="modal-help">{t(status)}</p>}
    {error && <p role="alert" className="modal-error">{t(error)}</p>}
  </section>
}
