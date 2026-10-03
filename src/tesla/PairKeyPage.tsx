import { useState } from 'react'
import { useLocale } from '../i18n/Locale'
import { detectProvider, normalizeApiKey, PROVIDER_OPTIONS, type ProviderId } from '../providers'
import { handoffRequest } from './keyHandoffClient'
import { PAIR_CODE } from './pairUrl'

export function PairKeyPage({ code }: { code: string }) {
  const { t } = useLocale()
  const valid = PAIR_CODE.test(code)
  const [draft, setDraft] = useState('')
  const [provider, setProvider] = useState<ProviderId>('gemini')
  const [error, setError] = useState(valid ? '' : 'This link has expired. Show a new code on the car screen.')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    const trimmed = normalizeApiKey(draft)
    setDraft(trimmed)
    if (!valid) { setError('This link has expired. Show a new code on the car screen.'); return }
    if (!trimmed) { setError('Enter a valid API key.'); return }
    const detected = detectProvider(trimmed)
    if (detected && detected !== provider) {
      const name = PROVIDER_OPTIONS.find(item => item.id === detected)?.label ?? detected
      setError(`Detected a ${name} API key. Select ${name} below to add this key.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await handoffRequest({ action: 'submit', code, apiKey: trimmed, provider })
      setDraft('')
      setSent(true)
      const url = new URL(location.href)
      url.searchParams.delete('pair')
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a phone link. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="pair-screen">
    <section className="modal-card pair-card" role="dialog" aria-labelledby="pair-title">
      <p className="pair-kicker">LinkYourTesla</p>
      <h1 id="pair-title">{t('Paste your API key')}</h1>
      {sent ? <p className="key-bridge-status" role="status">{t('Sent. You can close this page.')}</p> : <>
        <p className="modal-help">{t('This page only sends the key to your car. It is not saved in the link.')}</p>
        <input type="password" className="modal-input" value={draft} autoComplete="off" spellCheck={false} placeholder="AIza… / sk-… / sk-ant-…" aria-label={t('API key')} disabled={busy || !valid} onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit() } }} />
        <div className="provider-pick" role="group" aria-label={t('Provider')}>
          {PROVIDER_OPTIONS.map(item => <button key={item.id} type="button" className={`provider-chip provider-chip-${item.id}${provider === item.id ? ' is-active' : ''}`} disabled={busy || !valid} onClick={() => { setProvider(item.id); setError('') }}>{item.label}</button>)}
        </div>
        {error && <p className="modal-error" role="alert">{t(error)}</p>}
        <div className="modal-actions">
          <button type="button" className="modal-btn primary" disabled={busy || !valid} onClick={() => void submit()}>{busy ? t('Sending…') : t('Send to car')}</button>
        </div>
      </>}
    </section>
  </div>
}
