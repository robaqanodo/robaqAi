import { useEffect, useRef, useState } from 'react'
export function useGuestPresence(guest: boolean) {
  const [count, setCount] = useState({guests:0,members:0})
  const identity = useRef<{ browser: string; tab: string } | null>(null)
  if (!identity.current) {
    let browser = crypto.randomUUID() as string
    try { browser = localStorage.getItem('robaq-presence-browser') || browser; localStorage.setItem('robaq-presence-browser', browser) } catch { /* Use a per-tab anonymous identity. */ }
    identity.current = { browser, tab: crypto.randomUUID() }
  }
  useEffect(() => {
    let stopped = false, busy = false
    const payload = (active: boolean) => JSON.stringify({ ...identity.current, guest, active })
    const leave = () => { navigator.sendBeacon?.('/api/presence', new Blob([payload(false)], { type: 'application/json' })) }
    const heartbeat = async () => {
      if (busy || stopped) return
      busy = true
      try {
        const response = await fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload(document.visibilityState === 'visible'), signal: AbortSignal.timeout(6000) })
        if (!response.ok) throw new Error('Presence unavailable')
        const result = await response.json()
        if (!stopped) setCount({guests:Math.max(0,Number(result.guests)||0),members:Math.max(0,Number(result.members)||0)})
      } catch { if (!stopped) setCount({guests:0,members:0}) }
      finally { busy = false }
    }
    const changed = () => { if (document.visibilityState !== 'visible') leave(); else void heartbeat() }
    void heartbeat(); const timer = setInterval(() => void heartbeat(), 10000)
    document.addEventListener('visibilitychange', changed); window.addEventListener('pagehide', leave)
    return () => { stopped = true; clearInterval(timer); leave(); document.removeEventListener('visibilitychange', changed); window.removeEventListener('pagehide', leave) }
  }, [guest])
  return count
}
