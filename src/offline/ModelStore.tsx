import { skillPreferences } from '../skillSession'
import { InstallProgress, finishInstallation } from '../components/InstallProgress'
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../i18n/Locale'
import { MODELS, downloadModel, installModel, removeModel, type LocalModel } from './models'
import { unloadOfflineModel } from './runtime'
import './models.css'
export function ModelStore({ installed, selected, onChange, disabled }: {installed: string[]; selected: string; onChange: (id?: string) => void; disabled: boolean}) {
  const { t } = useLocale()
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(0)
  const [verifying, setVerifying] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function install(model: LocalModel) {
    if (controller.current || disabled) return
    const abort = new AbortController(); controller.current = abort
    setBusy(model.id); setFinishing(false); setError(''); setProgress(0); setVerifying(false)
    try {
      const blob = await downloadModel(model, abort.signal, setProgress)
      setVerifying(true); setProgress(0)
      await installModel(model, blob, abort.signal, setProgress)
      setFinishing(true); await finishInstallation(abort.signal)
      try { skillPreferences.setItem('ostra-last-installed-model', model.id) } catch { /* Selection still updates for this session. */ }
      onChange(model.id)
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Model installation failed. Please try again.')
    } finally { controller.current = null; setFinishing(false); setBusy('') }
  }
  async function remove(id: string) {
    if (controller.current || busy || disabled) return
    setBusy(id); setRemoving(true); setError('')
    try { await unloadOfflineModel(); await removeModel(id); onChange(selected === id ? '' : undefined) }
    catch { setError('Could not remove the model. Please try again.') }
    finally { setBusy(''); setRemoving(false) }
  }
  return <>
    <ul className="side-panel-list offline-models">
      {MODELS.filter(model => model.id == "qwen35-2").map(model => <li className="side-panel-item" key={model.id}>
        <div className="side-panel-item-body"><span className="side-panel-item-name">{model.name}</span><span className="side-panel-item-meta">{Math.round(model.size / 1e6)} MB · Q4_K_M</span></div>
        {busy === model.id ? <div className="model-actions"><InstallProgress label={removing ? t('Removing…') : finishing ? t('Installing…') : `${t(verifying ? 'Verifying' : 'Downloading')} ${Math.round(progress * 100)}%`} finishing={finishing} progress={removing ? undefined : progress} /><button className="modal-btn" onClick={() => controller.current?.abort()} disabled={!controller.current}>{t('Cancel')}</button></div> : installed.includes(model.id) ? <div className="model-actions"><span className={`translator-active-badge${selected === model.id ? '' : ' model-use-status'}`}>{selected === model.id ? t('Active') : t('Use')}</span><button className="model-remove" disabled={disabled || !!busy} aria-label={`${t('Delete')} ${model.name}`} onClick={() => void remove(model.id)}>{t('Delete')}</button>{selected !== model.id && <button className="modal-btn primary" disabled={disabled || !!busy} onClick={() => onChange(model.id)}>{t('Use')}</button>}</div> : <div className="model-actions"><button className="modal-btn primary" disabled={disabled || !!busy} onClick={() => void install(model)}>{t('Download')}</button></div>}
      </li>)}
    </ul>
    <details className="store-info"><summary aria-label="Offline AI information">?</summary><p className="modal-help">{t('Download once, then chat offline. Keep AI Lab open during installation.')}</p></details>

    {error && <p role="alert" className="modal-error">{t(error)}</p>}
  </>
}
