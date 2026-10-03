import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../i18n/Locale'
import type { ProviderId } from '../providers'
import { QrMark } from './QrMark'
import { handoffRequest } from './keyHandoffClient'
import { pairUrl } from './pairUrl'

type Ticket = { code: string; claim: string; expiresAt: number }

export function ApiKeyBridge({ signedIn, email, syncReady, onDelivered }: {
  signedIn: boolean
  email?: string
  syncReady: boolean
  onDelivered: (apiKey: string, provider: ProviderId) => void
}) {
  const { t } = useLocale()
  const deliver = useRef(onDelivered)
  deliver.current = onDelivered
  const [mint, setMint] = useState(0)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'ready' | 'expired'>('loading')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    setError('')
    setTicket(null)
    void handoffRequest({ action: 'create' }).then(created => {
      if (cancelled) return
      if (!created.code || !created.claim || !created.expiresAt) throw new Error('Could not start a phone link. Try again.')
      setTicket({ code: created.code, claim: created.claim, expiresAt: created.expiresAt })
      setPhase('waiting')
    }).catch(err => {
      if (!cancelled) { setPhase('expired'); setError(err instanceof Error ? err.message : 'Could not start a phone link. Try again.') }
    })
    return () => { cancelled = true }
  }, [mint])

  useEffect(() => {
    if (!ticket || phase !== 'waiting') return
    let cancelled = false
    const poll = async () => {
      if (Date.now() >= ticket.expiresAt) { setPhase('expired'); setError('This code has expired.'); return }
      try {
        const result = await handoffRequest({ action: 'poll', code: ticket.code, claim: ticket.claim })
        if (cancelled) return
        if (result.status === 'ready' && result.apiKey && (result.provider === 'gemini' || result.provider === 'openai' || result.provider === 'claude')) {
          setPhase('ready')
          deliver.current(result.apiKey, result.provider)
        }
      } catch (err) {
        if (!cancelled) { setPhase('expired'); setError(err instanceof Error ? err.message : 'This code has expired.') }
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [ticket, phase])

  const left = ticket ? Math.max(0, Math.ceil((ticket.expiresAt - now) / 1000)) : 0
  const link = ticket ? pairUrl(ticket.code) : ''
  return <section className="key-bridge" aria-labelledby="key-bridge-title">
    <h3 id="key-bridge-title">{t('Link from your phone')}</h3>
    <p className="modal-help">{t('Scan this code with your phone. Paste the API key there and it fills in here. The code expires in a few minutes and never contains the key.')}</p>
    {signedIn && syncReady && email && <p className="key-bridge-note">{t('Signed in as {0}. A key saved on another signed-in device appears here automatically.').replace('{0}', email)}</p>}
    {signedIn && !syncReady && <p className="key-bridge-note">{t('Sign in again on this device to sync keys across devices.')}</p>}
    {!signedIn && <p className="key-bridge-note">{t('Sign in on both devices to sync a saved key without scanning.')}</p>}
    {phase === 'waiting' && link && <div className="key-bridge-qr"><QrMark value={link} label={t('Phone pairing code')} /></div>}
    {phase === 'waiting' && <p className="key-bridge-status" role="status">{t('Waiting for your phone…')} {t('Expires in {0}s').replace('{0}', String(left))}</p>}
    {phase === 'waiting' && link && <a className="key-bridge-open" href={link} target="_blank" rel="noreferrer">{t('Open phone page')}</a>}
    {phase === 'ready' && <p className="key-bridge-status" role="status">{t('Key received')}</p>}
    {phase === 'loading' && <p className="key-bridge-status">{t('Waiting for your phone…')}</p>}
    {phase === 'expired' && <p className="modal-error" role="alert">{t(error || 'This code expired. Show a new one.')}</p>}
    {phase !== 'waiting' && phase !== 'loading' && <button type="button" className="modal-btn ghost" onClick={() => setMint(value => value + 1)}>{t('New code')}</button>}
  </section>
}
