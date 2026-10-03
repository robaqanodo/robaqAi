import {TeslaMark} from '../tesla/TeslaSkill'
import { useLocale } from '../i18n/Locale'
import './navigation.css'

export function Navigation({ teslaActive, onTesla, onMap, kasActive, onKas, movieSyncActive, onMovieSync, onHome, onLibrary, onSettings, onAbout, onAccount, email, historyOpen, onHistory, hasApiKey, voiceMode, voiceMoving, voiceDisabled, onVoice }: {
  teslaActive?: boolean; onTesla?:()=>void; onMap: () => void; kasActive?: boolean; onKas?: () => void; movieSyncActive?: boolean; onMovieSync?: () => void; hasApiKey: boolean; voiceMode: boolean; voiceMoving: boolean; voiceDisabled: boolean; onVoice: () => void; email?: string; historyOpen: boolean; onHistory: () => void; onHome: () => void; onLibrary: () => void; onSettings: () => void; onAbout: () => void; onAccount: () => void
}) {
  const { t } = useLocale()

  return <nav id="main-navigation" className="navigation-rail" aria-label={t("Main navigation")}>
    <div className="rail-spacer">{hasApiKey && <button className="rail-mic landing-glass-mic" aria-label={voiceMode ? t("Stop voice conversation") : t("Start voice conversation")} aria-pressed={voiceMode} data-voice-moving={voiceMoving ? 'true' : 'false'} disabled={voiceDisabled} onClick={onVoice}><span className="mic-dot-orbit" aria-hidden="true"><i /><i /><i /><i /></span><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg></button>}</div>
    {!teslaActive && <button onClick={onHome} aria-label={t("Home")} title={t("Home")}><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></svg><span>{t("Home")}</span></button>}
    {email && !teslaActive && <button className="rail-history" onClick={onHistory} aria-label={t("Chat history")} title={t("Chat history")} aria-expanded={historyOpen}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>{t("History")}</span></button>}
    {movieSyncActive && <button onClick={onMovieSync} aria-label="MovieSync" title="MovieSync"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4Z M3 8h3M3 16h3m12-8h3m-3 8h3"/></svg><span>MovieSync</span></button>}
    {kasActive && <button onClick={onKas} aria-label="Kas 1.0" title="Keeping a secret"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></svg><span>Kas</span></button>}
    {teslaActive && <button onClick={onMap} aria-label={t("Map")} title={t("Map")}><svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg><span>{t("Map")}</span></button>}
    {teslaActive && <button onClick={onTesla} aria-label="LinkyourTesla 1.0" title="LinkyourTesla 1.0"><TeslaMark/><span>Tesla</span></button>}
    <button onClick={onLibrary} aria-label={t("AI Lab")} title={t("AI Lab")}><svg viewBox="0 0 24 24"><rect x="3" y="4" width="6" height="16" rx="1"/><path d="M12 4v16M16 4l5 15"/></svg><span>{t("AI Lab")}</span></button>
    <button onClick={onSettings} aria-label={t("Settings")} title={t("Settings")}><svg viewBox="0 0 24 24"><path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></svg><span>{t("Settings")}</span></button>
    <div className="rail-bottom">
      <button onClick={onAbout} aria-label={t("About robaqAI")} title={t("About robaqAI")}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/></svg></button>
      <button onClick={onAccount} aria-label={email ? t("Your account") : t("Register or sign in")} title={email ?? t("Register or sign in")} className="rail-profile">{email ? <span className="profile-initial">{email[0].toUpperCase()}</span> : <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/></svg>}</button>

    </div>
  </nav>
}
