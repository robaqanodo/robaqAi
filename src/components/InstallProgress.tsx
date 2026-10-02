import {useSyncExternalStore} from 'react'
const setups=new Map<symbol,number>()
const listeners=new Set<()=>void>()
let snapshot={count:0,progress:0}
function publish(){snapshot={count:setups.size,progress:setups.size?[...setups.values()].reduce((a,b)=>a+b,0)/setups.size:0};listeners.forEach(fn=>fn())}
export function useInstallationProgress(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb)}},()=>snapshot)}
export function InstallProgress({ label, finishing = false, progress }: { label: string; finishing?: boolean; progress?: number }) {
  return <div className="skill-install-progress" role="status" aria-live="polite"><span>{label}</span><span className={`skill-install-track ${finishing ? 'is-finishing' : progress === undefined ? 'is-working' : ''}`} aria-hidden="true"><i style={progress !== undefined && !finishing ? { width: `${Math.max(0, Math.min(1, progress)) * 100}%` } : undefined} /></span></div>
}
export function finishInstallation(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const id=Symbol(),start=performance.now()
    setups.set(id,0);publish()
    const cleanup=()=>{clearTimeout(timer);clearInterval(tick);signal?.removeEventListener('abort',cancel);setups.delete(id);publish()}
    const cancel=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'))}
    const tick=window.setInterval(()=>{setups.set(id,Math.min(.99,(performance.now()-start)/3000));publish()},100)
    const timer=window.setTimeout(()=>{cleanup();resolve()},3000)
    signal?.addEventListener('abort',cancel,{once:true})
  })
}
