import { useEffect, useRef } from 'react'
import type { Message } from '../accounts/vault'
// Server copies are encrypted with a key held only in this open chat's memory.
export function useTemporaryChat(open: boolean, messages: Message[]) {
  const current = useRef(messages)
  current.current = messages
  useEffect(() => {
    if (!open || location.protocol !== 'https:') return
    let closed = false, busy = false, revision = ''
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('')
    const key = crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt'])
    const send = (body: object, keepalive = false) => fetch('/api/chat', {method:'POST', keepalive, headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:keepalive ? undefined : AbortSignal.timeout(10000)})
    let lastSaved = 0
    const save = async () => {
      if (closed || busy || !navigator.onLine || !current.current.length) return
      const raw = JSON.stringify(current.current)
      if (raw === revision && Date.now() - lastSaved < 20000) return
      busy = true
      try {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key,new TextEncoder().encode(raw)))
        const bytes = new Uint8Array(iv.length + cipher.length); bytes.set(iv); bytes.set(cipher,iv.length)
        let binary = ''; for (const b of bytes) binary += String.fromCharCode(b)
        if (!closed) { const response = await send({action:'save',encrypted:btoa(binary)}); if (response.ok) { revision = raw; lastSaved = Date.now() } }
      } catch { /* Offline chat stays on the device; no server persistence is required for inference. */ }
      finally { busy = false }
    }
    const close = () => { if (closed) return; closed = true; void send({action:'close'},true).catch(() => {}) }
    const timer = window.setInterval(() => void save(), 2500)
    void save(); window.addEventListener('pagehide',close)
    return () => { clearInterval(timer); window.removeEventListener('pagehide',close); close() }
  }, [open])
}
