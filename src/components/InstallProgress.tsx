export function InstallProgress({ label, finishing = false, progress }: { label: string; finishing?: boolean; progress?: number }) {
  return <div className="skill-install-progress" role="status" aria-live="polite"><span>{label}</span><span className={`skill-install-track ${finishing ? 'is-finishing' : progress === undefined ? 'is-working' : ''}`} aria-hidden="true"><i style={progress !== undefined && !finishing ? { width: `${Math.max(0, Math.min(1, progress)) * 100}%` } : undefined} /></span></div>
}
export function finishInstallation(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }
    const timer = window.setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve() }, 3000)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}
