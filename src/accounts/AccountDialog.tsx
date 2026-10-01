import { Profile } from './Profile'
import { useLocale } from '../i18n/Locale'
import { useState } from 'react'
import { register, signIn, type Session, type Conversation } from './vault'
export function AccountDialog({ session, onSignedIn, onSignOut, onClose, onGuest, onProfileUpdate, onDeleted }: { session: Session | null; onSignedIn: (session: Session, chats: Conversation[]) => void; onSignOut: () => void; onClose: () => void; onGuest: () => void; onProfileUpdate: (session: Session) => void; onDeleted: () => void }) {
  const { t, locale, setLocale } = useLocale()

  const [guestWarning, setGuestWarning] = useState(false)
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="modal-backdrop" onClick={() => { if (!busy) { if (session) onClose(); else setGuestWarning(true) } }}><section className="modal-card account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={e => e.stopPropagation()}>
    <button type="button" className="account-top-close" disabled={busy} onClick={() => { if (session) onClose(); else setGuestWarning(true) }} aria-label={t('Close')}>×</button>
    <h2 id="account-title">{session ? t("Your account") : mode === 'signin' ? t("Welcome to Smartass") : t("Create your account")}</h2>
    {!session && <p className="welcome-purpose">{t('Think, write and translate with Smartass. Chat with downloaded AI models without internet, or connect your own API key for online chat and voice. Find models and language packs in AI Lab.')}</p>}
    {guestWarning ? <div className="guest-warning">
      <h3>{t("Continue without saving?")}</h3>
      <p className="modal-help">{t("As a guest, your conversation is temporary. If you close, leave, or reload this site, your messages and information shared in this chat will be lost and cannot be recovered. Create an account or sign in to save your chat history on this device.")}</p>
      <div className="modal-actions"><button className="modal-btn ghost" onClick={() => setGuestWarning(false)}>{t("Cancel")}</button><button className="modal-btn primary" onClick={onGuest}>{t("Agree")}</button></div>
    </div> : session ? <Profile session={session} onUpdate={onProfileUpdate} onSignOut={onSignOut} onDeleted={onDeleted} onBusyChange={setBusy} /> : <form className="account-form" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setError('')
      if (mode === 'register' && password !== confirmation) { setError('Passwords do not match.'); return }
      setBusy(true)
      try {
        if (mode === 'register') onSignedIn(await register(email, password, firstName, lastName), [])
        else { const result = await signIn(email, password); onSignedIn(result.session, result.chats) }
        setPassword(''); setConfirmation('')
      } catch (err) { setError(err instanceof Error ? err.message : 'Unable to open your account.') }
      finally { setBusy(false) }
    }}>
      <p className="modal-help">{t("A private account on this device. No email verification or email password recovery. Keep your password safe; clearing site data removes your account and history.")}</p>
      {mode === 'register' && <div className="profile-name-grid"><label>{t('First name')}<input autoComplete="given-name" maxLength={80} value={firstName} disabled={busy} onChange={e => setFirstName(e.target.value)} /></label><label>{t('Last name')}<input autoComplete="family-name" maxLength={80} value={lastName} disabled={busy} onChange={e => setLastName(e.target.value)} /></label></div>}
      <label>{mode === 'register' ? t("Email") : t("Email or username")}<input type={mode === 'register' ? 'email' : 'text'} autoComplete="username" required value={email} disabled={busy} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <label>{t("Password")}<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 10 : undefined} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
      {mode === 'register' && <label>{t("Confirm password")}<input type="password" autoComplete="new-password" required value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>}
      {error && <p role="alert" className="modal-error">{t(error)}</p>}
      <button className="modal-btn primary" disabled={busy}>{busy ? t("Please wait…") : mode === 'register' ? t("Create account") : t("Sign in")}</button>
      <button type="button" className="modal-btn ghost" disabled={busy} onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(''); setPassword(''); setConfirmation('') }}>{mode === 'signin' ? t("Create an account") : t("Already registered? Sign in")}</button>
      <button type="button" className="modal-btn ghost" disabled={busy} onClick={() => setGuestWarning(true)}>{t("Continue as guest")}</button>
    </form>}
    <div className="account-bottom-bar">
      {!session && <div className="welcome-languages" aria-label={t('Language')}><button type="button" className={locale === 'en' ? 'is-selected' : ''} onClick={() => setLocale('en')} aria-label="English">EN</button><button type="button" className={locale === 'ka' ? 'is-selected' : ''} onClick={() => setLocale('ka')} aria-label="ქართული">KA</button><button type="button" className={locale === 'ru' ? 'is-selected' : ''} onClick={() => setLocale('ru')} aria-label="Русский">RU</button></div>}
    </div>
  </section></div>
}
