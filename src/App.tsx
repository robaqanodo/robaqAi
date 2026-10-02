import { OfflineModelLibrary } from './offline/OfflineModelLibrary'
import { LiveChat } from './live/LiveChat'
import { LiveSkillStore } from './live/LiveSkillStore'
import { roomInvite, type LiveKind } from './live/client'
import { useModelFlow, resetModelFlow } from './offline/modelFlow'
import { useTeslaOrb } from './components/useTeslaOrb'
import { Kas, KasReader } from './kas/Kas'
import { KasStore } from './kas/KasStore'
import { retainGuestSkills } from './retainGuestSkills'
import { skillPreferences, setPersistentSkills, persistentSkills } from './skillSession'
import { useTemporaryChat } from './chat/useTemporaryChat'
import { useGuestPresence } from './presence/useGuestPresence'
import { MovieSyncStore, type MovieSyncStage } from './watch/MovieSyncStore'
import { desktopInference, cancelDesktopReply } from './offline/desktop'
import { OfflineModelSelect } from './offline/OfflineModelSelect'
import { MODELS } from './offline/models'
import { offlineReply, cancelOfflineReply, unloadOfflineModel } from './offline/runtime'
import { useLocale, LocaleProvider } from './i18n/Locale'
import { AccountDialog } from './accounts/AccountDialog'
import { History } from './accounts/History'
import { restoreSession, signOut, saveChats, type Session, type Conversation } from './accounts/vault'
import { Navigation } from './navigation/Navigation'
import { packInstalled } from './translation/package'
import { translateOffline, stopTranslationWorker } from './translation/client'
import { automaticTranslation } from './translation/automatic'
import { currentVersion } from './updates'
import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition'
import { nativeRecognitionClass, type SpeechRecognitionLike } from './native-speech'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  clearCredentials,
  detectProvider,
  formatApiError,
  generateReply,
  loadStoredCredentials,
  normalizeApiKey,
  preparePendingFile,
  PROVIDER_OPTIONS,
  providerThemeClass,
  saveCredentials,
  type PendingFile,
  type ProviderId,
} from './providers'
import {
  ensureDefaultOfflineBrain,
} from './brains'
import './App.css'
import './voice-composer.css'
import './ostra.css'
import { IntelligenceOrb as LivingCell } from './components/IntelligenceOrb'

const WatchTogether = lazy(() => import('./watch/WatchTogether').then(module => ({ default: module.WatchTogether })))

const INTRO_OFFLINE = "Hello, how can I help you?"
/** Chat welcome: human online vibe when API is on; classic robaqAI line when off. */
function getWelcomeText(hasApi: boolean): string {
  if (!hasApi) return INTRO_OFFLINE
  return "We're online! Good to have you here. Ask me anything — I'm right here with you."
}

function isValidPick(v: string): v is ProviderId {
  return v === 'gemini' || v === 'openai' || v === 'claude'
}

/** Detect reply language for TTS (Georgian → ka-GE; Russian → ru-RU; else British English). */
function detectReplyLang(text: string): string {
  if (/[\u10A0-\u10FF]/.test(text)) return 'ka-GE'
  if (/[\u0400-\u04FF]/.test(text)) return 'ru-RU'
  return 'en-GB'
}

function pickUkMaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const scored = voices.map((v) => {
    const name = v.name
    const lang = v.lang || ''
    let score = 0
    if (/google uk english male/i.test(name)) score += 100
    else if (/\bdaniel\b/i.test(name) && /en-?gb/i.test(lang + name)) score += 90
    else if (/uk english male/i.test(name)) score += 85
    else if (/en-gb/i.test(lang) && /male/i.test(name)) score += 75
    else if (/british/i.test(name) && /male/i.test(name)) score += 70
    else if (/en-gb/i.test(lang)) score += 50
    else if (/uk english/i.test(name)) score += 45
    else if (/^en/i.test(lang) && /male/i.test(name)) score += 25
    else if (/^en/i.test(lang)) score += 10
    return { v, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].score > 0 ? scored[0].v : voices[0] ?? null
}

/** Prefer a matching voice for the reply language; Georgian if available, else UK male for English. */
function pickVoiceForText(text: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const lang = detectReplyLang(text)
  if (lang.startsWith('ka')) {
    const scored = voices.map((v) => {
      const name = v.name
      const vlang = v.lang || ''
      let score = 0
      if (/^ka\b/i.test(vlang) || /georgian/i.test(name)) score += 100
      else if (/kartuli|ქართული/i.test(name)) score += 90
      return { v, score }
    })
    scored.sort((a, b) => b.score - a.score)
    if (scored[0].score > 0) return scored[0].v
    return null
  }
  if (lang.startsWith('ru')) {
    const scored = voices.map((v) => {
      const name = v.name
      const vlang = v.lang || ''
      let score = 0
      if (/^ru\b/i.test(vlang) || /russian/i.test(name)) score += 100
      return { v, score }
    })
    scored.sort((a, b) => b.score - a.score)
    if (scored[0].score > 0) return scored[0].v
    return null
  }
  return pickUkMaleVoice()
}

/**
 * SpeechRecognition language when API is on: no English-only lock.
 * Prefer Georgian if the browser/user languages include it, else browser locale (auto).
 */
function preferredRecognitionLang(hintText?: string): string {
  if (hintText && /[\u10A0-\u10FF]/.test(hintText)) return 'ka-GE'
  if (hintText && /[A-Za-z\u00C0-\u024F]/.test(hintText) && !/[\u10A0-\u10FF]/.test(hintText)) {
    const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
    if (/^en\b/i.test(nav)) return nav
    return 'en-GB'
  }
  const list =
    typeof navigator !== 'undefined'
      ? [...(navigator.languages ?? []), navigator.language ?? '']
      : []
  for (const l of list) {
    if (l && /^ka\b/i.test(l)) return 'ka-GE'
  }
  const primary = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  // Empty → engine default / auto; never hard-force en-US
  return primary || ''
}

const TEXTAREA_MAX_LINES = 5
const ACCEPT_FILES =
  'image/*,application/pdf,text/plain,text/markdown,text/csv,application/json,.txt,.md,.csv,.json,.pdf'

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** ChatGPT-like per-glyph delay: slightly faster on spaces/punct, tiny jitter. */
function charDelay(ch: string): number {
  const fast = /[\s.,!?;:…—–\-'"»«)\]}…]/u.test(ch)
  const base = fast ? 16 : 30
  const jitter = Math.random() * 16 - 5
  return Math.max(8, base + jitter)
}



function IconSendUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 19V5M12 5l-6 6M12 5l6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconTranslator() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 6h9M8.5 4v2m-3 0c.7 3.2 2.5 5.7 5.3 7.3M5.5 14.5c2.2-1.1 4-2.8 5.2-5.1M14 15h6m-3-2v2m-3.5 0 3.5 6 3.5-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function IconStop() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg>
}

function IconCollapse() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m5 9 7 7 7-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m6 6 12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}


function IconKey() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M10.5 12.5 19 4m0 0h-3.5M19 4v3.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPlug() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 7V3m6 4V3M8 7h8v4a4 4 0 0 1-4 4v4m0 0H9m3 0h3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPaperclip() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m21.44 11.05-8.49 8.49a5.25 5.25 0 0 1-7.42-7.42l8.84-8.84a3.5 3.5 0 0 1 4.95 4.95l-8.84 8.84a1.75 1.75 0 0 1-2.47-2.47l7.78-7.78"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type Role = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: Role
  text: string
}

const NativeRecognition = nativeRecognitionClass(SpeechRecognition)

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (Capacitor.getPlatform() === 'ios') return NativeRecognition
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

type LandingPanel = 'settings' | 'store' | 'plugin' | 'about' | 'donate' | 'updates' | 'update-menu' | 'account' | null

function AppContent() {
  const { t, locale, setLocale } = useLocale()

  const [session, setSession] = useState<Session | null>(null)
  const [liveEntry, setLiveEntry] = useState<{kind:LiveKind;room?:string}|null>(()=>roomInvite())
  const liveSubmit = useRef<((text:string)=>void)|null>(null)
  const [liveSkills,setLiveSkills] = useState(()=>({syberlive:skillPreferences.getItem('robaq-syberlive-active')==='true',crossfire:skillPreferences.getItem('robaq-crossfire-active')==='true'}))
  useEffect(()=>{setLiveSkills({syberlive:skillPreferences.getItem('robaq-syberlive-active')==='true',crossfire:skillPreferences.getItem('robaq-crossfire-active')==='true'})},[session])
  const [kasOpen, setKasOpen] = useState(false)
  const [kasCode, setKasCode] = useState('')
  const kasSubmit = useRef<((text:string)=>void)|null>(null)
  const [kasActive, setKasActive] = useState(() => skillPreferences.getItem('robaq-kas-active') === 'true')
  useEffect(() => { setKasActive(skillPreferences.getItem('robaq-kas-active') === 'true'); setKasCode(''); setKasOpen(false) }, [session])
  const presence = useGuestPresence(!session)
  useEffect(() => {
    const leave = () => {
      if (persistentSkills()) return
      stopTranslationWorker()
      void unloadOfflineModel()
      setPersistentSkills(false)
    }
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted && !persistentSkills()) window.location.reload()
    }
    window.addEventListener('pagehide', leave)
    window.addEventListener('pageshow', resume)
    return () => { window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', resume) }
  }, [])
  const [chats, setChats] = useState<Conversation[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  useEffect(() => { setHistoryOpen(false) }, [session])
  const [saveError, setSaveError] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  useEffect(() => {
    if (!session || !activeChatId || messages.length === 0) return
    setChats(previous => {
      const existing = previous.find(chat => chat.id === activeChatId)
      const updated: Conversation = { ...existing, id: activeChatId, title: existing?.title ?? messages.find(m => m.role === 'user')?.text.slice(0, 60) ?? 'New chat', messages, updated: Date.now() }
      return existing ? previous.map(chat => chat.id === activeChatId ? updated : chat) : [updated, ...previous]
    })
  }, [messages, session, activeChatId])
  useEffect(() => {
    if (!session) return
    let active = true
    void saveChats(session, chats).then(() => { if (active) setSaveError('') }).catch(() => { if (active) setSaveError('Could not save your history. Device storage may be full. Keep this window open and free some space.') })
    return () => { active = false }
  }, [session, chats])
  const [thinking, setThinking] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [m2mReady, setM2mReady] = useState(false)
  const [desktopTranslator, setDesktopTranslator] = useState('')
  const translatorReady = m2mReady || Boolean(desktopTranslator)
  const [translationStatus, setTranslationStatus] = useState('Offline')
  const [translationMode, setTranslationMode] = useState(() => { try { return !skillPreferences.getItem('rai-local-model') } catch { return true } })
  const [themeChoice, setChatColor] = useState<string>(() => { try { return localStorage.getItem('robaq-theme-choice') || 'system' } catch { return 'system' } })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => { const media=window.matchMedia('(prefers-color-scheme: dark)');const update=()=>setSystemDark(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update) }, [])
  const chatColor = themeChoice === 'system' ? (systemDark ? 'default' : 'white') : themeChoice
  useEffect(() => { document.documentElement.style.colorScheme=chatColor === 'white' ? 'light' : 'dark' }, [chatColor])

  const [apiOpen, setApiOpen] = useState(false)
  const [apiKey, setApiKey] = useState(() => loadStoredCredentials().apiKey)
  const [provider, setProvider] = useState<ProviderId | null>(() => loadStoredCredentials().provider)
  const [apiDraft, setApiDraft] = useState('')
  /** Explicit provider pick required on save (Gemini / OpenAI / Anthropic). */
  const [apiProviderPick, setApiProviderPick] = useState<ProviderId | null>('gemini')
  const [apiError, setApiError] = useState<string | null>(null)
  const [micHint, setMicHint] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(()=>Boolean(roomInvite()))
  useEffect(() => { if (!chatOpen) {setKasCode('');setLiveEntry(null)} }, [chatOpen])
  useTemporaryChat(chatOpen, messages, activeChatId)
  const [introShown, setIntroShown] = useState(false)
  const [introDisplay, setIntroDisplay] = useState('')
  const [introStreaming, setIntroStreaming] = useState(false)
  const [landingPanel, setLandingPanel] = useState<LandingPanel>(()=>roomInvite()?null:'account')
  useEffect(() => {
    let cancelled = false
    void restoreSession().then(result => {
      if (!cancelled && result) { setPersistentSkills(true); setSession(result.session); setChats(result.chats); setActiveChatId(crypto.randomUUID()); setLandingPanel(null) }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const [movieSyncStage, setMovieSyncStage] = useState<MovieSyncStage>(() => {
    try { const saved = skillPreferences.getItem('ostra-moviesync-stage'); return saved === 'active' || saved === 'downloaded' ? saved : 'new' } catch { return 'new' }
  })
  useEffect(() => {
    const saved = skillPreferences.getItem('ostra-moviesync-stage')
    setMovieSyncStage(saved === 'active' || saved === 'downloaded' ? saved : 'new')
  }, [session])
  const changeMovieSyncStage = (stage: MovieSyncStage) => {
    setMovieSyncStage(stage)
    try { skillPreferences.setItem('ostra-moviesync-stage', stage) } catch { /* Current session remains usable. */ }
  }
  const [watchOpen, setWatchOpen] = useState(() => new URLSearchParams(window.location.search).has('watch'))
  useEffect(() => {
    let active = true
    void packInstalled().then(ready => { if (active) { const marker = skillPreferences.getItem('ostra-translator-active'); const enabled = ready && Boolean(marker) && marker !== 'false'; setM2mReady(enabled) } })
    return () => { active = false }
  }, [landingPanel, chatOpen, session])
  const [, setSettingsMenuOpen] = useState(false)
  const modelFlow=useModelFlow()
  const localModels=modelFlow.installed,localModel=modelFlow.active
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const birdPalette = (translatorReady || localModels.length > 0) ? 'mixed' : 'default'
  const birdColors = ['stock', 'black', ...(kasActive ? ['kas'] : []), ...(localModels.includes(localModel) ? ['model','model','model-buddy'] : [])]
  const [displayBirdColors, setDisplayBirdColors] = useState<string[]>(birdColors)
  useEffect(() => {
    const target = birdColors
    if (target.length >= displayBirdColors.length) { setDisplayBirdColors(target); return }
    const timer = window.setTimeout(() => setDisplayBirdColors(target), 500)
    return () => window.clearTimeout(timer)
  }, [birdColors.join(','), kasActive, localModel])
  useEffect(() => { void resetModelFlow() }, [session])
  useEffect(()=>{if(localModels.includes(localModel))setTranslationMode(false)},[localModel,localModels.join(',')])
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [attachBusy, setAttachBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [voiceLevel, setVoiceLevel] = useState(0)
  /** Subtitle inside the big cell: AI speech text, or user interim while listening. */
  const [voiceCaption, setVoiceCaption] = useState('')

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const thinkTimer = useRef<number | null>(null)
  const typeTimer = useRef<number | null>(null)
  const introTimer = useRef<number | null>(null)
  const introDelayTimer = useRef<number | null>(null)
  const introGen = useRef(0)
  const speechGen = useRef(0)
  const streamGen = useRef(0)
  const sendGen = useRef(0)
  const messagesRef = useRef<ChatMessage[]>([])
  const pendingFilesRef = useRef<PendingFile[]>([])
  const apiKeyRef = useRef(apiKey)
  const providerRef = useRef(provider)
  const voiceModeRef = useRef(false)
  const voiceListenWantedRef = useRef(false)
  const micStreamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const analyserCtxRef = useRef<AudioContext | null>(null)
  const analyserRafRef = useRef<number | null>(null)
  const voiceBusyRef = useRef(false)
  const startVoiceListeningRef = useRef<() => void>(() => {})
  const handleVoiceUtteranceRef = useRef<(text: string) => void>(() => {})
  const stopVoiceModeRef = useRef<() => void>(() => {})
  const voiceSessionRef = useRef(0)
  const speechLangRef = useRef<string>(preferredRecognitionLang())

  const hasApiKey = Boolean(apiKey.trim())

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    pendingFilesRef.current = pendingFiles
  }, [pendingFiles])

  useEffect(() => {
    apiKeyRef.current = apiKey
  }, [apiKey])

  useEffect(() => {
    providerRef.current = provider
  }, [provider])

  // Always-on offline knowledge pack — no AI Lab download required for mock mode
  useEffect(() => {
    void ensureDefaultOfflineBrain()
  }, [])

  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])

  const cancelTyping = useCallback(() => {
    streamGen.current += 1
    if (typeTimer.current) {
      window.clearTimeout(typeTimer.current)
      typeTimer.current = null
    }
    setStreamingId(null)
  }, [])

  const startTyping = useCallback(
    (fullText: string) => {
      cancelTyping()

      const id = uid()
      // Iterate by Unicode code points so Georgian + emoji stay intact
      const chars = Array.from(fullText)

      if (prefersReducedMotion() || chars.length === 0) {
        setMessages((m) => [...m, { id, role: 'assistant', text: fullText }])
        setThinking(false)
        return
      }

      // Replace thinking dots with an empty streaming bubble
      setThinking(false)
      setMessages((m) => [...m, { id, role: 'assistant', text: '' }])
      setStreamingId(id)

      const gen = streamGen.current
      let i = 0

      const tick = () => {
        if (gen !== streamGen.current) return
        if (i >= chars.length) {
          typeTimer.current = null
          setStreamingId(null)
          return
        }
        const ch = chars[i]
        i += 1
        const next = chars.slice(0, i).join('')
        setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text: next } : msg)))
        typeTimer.current = window.setTimeout(tick, charDelay(ch))
      }

      typeTimer.current = window.setTimeout(tick, charDelay(chars[0]))
    },
    [cancelTyping],
  )

  const cancelIntroTyping = useCallback(() => {
    introGen.current += 1
    if (introTimer.current) {
      window.clearTimeout(introTimer.current)
      introTimer.current = null
    }
    if (introDelayTimer.current) {
      window.clearTimeout(introDelayTimer.current)
      introDelayTimer.current = null
    }
    setIntroStreaming(false)
  }, [])

  const startIntroTyping = useCallback((welcomeText?: string) => {
    cancelIntroTyping()
    const fullText = welcomeText ?? getWelcomeText(Boolean(apiKeyRef.current.trim()))
    const chars = Array.from(fullText)

    if (prefersReducedMotion() || chars.length === 0) {
      setIntroDisplay(fullText)
      setIntroShown(true)
      setIntroStreaming(false)
      return
    }

    setIntroDisplay('')
    setIntroStreaming(true)
    const gen = introGen.current
    let i = 0

    const tick = () => {
      if (gen !== introGen.current) return
      if (i >= chars.length) {
        introTimer.current = null
        setIntroStreaming(false)
        setIntroShown(true)
        return
      }
      const ch = chars[i]
      i += 1
      setIntroDisplay(chars.slice(0, i).join(''))
      introTimer.current = window.setTimeout(tick, charDelay(ch))
    }

    introTimer.current = window.setTimeout(tick, charDelay(chars[0]))
  }, [cancelIntroTyping])

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const styles = window.getComputedStyle(el)
    const lineHeight = parseFloat(styles.lineHeight) || 21
    const padY =
      (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
    const maxH = lineHeight * TEXTAREA_MAX_LINES + padY
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
  }, [])

  useEffect(() => {
    return () => {
      if (thinkTimer.current) window.clearTimeout(thinkTimer.current)
      if (typeTimer.current) window.clearTimeout(typeTimer.current)
      if (introTimer.current) window.clearTimeout(introTimer.current)
      if (introDelayTimer.current) window.clearTimeout(introDelayTimer.current)
      streamGen.current += 1
      introGen.current += 1
      speechGen.current += 1
      cancelOfflineReply()
      sendGen.current += 1
      recognitionRef.current?.stop()
      try {
        recognitionRef.current?.abort?.()
      } catch {
        /* ignore */
      }
      if (analyserRafRef.current) cancelAnimationFrame(analyserRafRef.current)
      try {
        micStreamRef.current?.getTracks().forEach((t) => t.stop())
      } catch {
        /* ignore */
      }
      try {
        void analyserCtxRef.current?.close()
      } catch {
        /* ignore */
      }
      try {
        window.speechSynthesis?.cancel()
      } catch {
        /* ignore */
      }
    }
  }, [])

  useEffect(() => {
    if (!chatOpen || window.matchMedia('(pointer: coarse)').matches) return
    const delay = prefersReducedMotion() ? 0 : 420
    const t = window.setTimeout(() => inputRef.current?.focus(), delay)
    return () => window.clearTimeout(t)
  }, [chatOpen])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [input, resizeTextarea])

  useEffect(() => {
    const lane = historyRef.current
    if (!lane) return
    lane.scrollTo({ top: lane.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking, streamingId])

  // Hide / clear attachments when API key is removed
  useEffect(() => {
    if (!hasApiKey) {
      setPendingFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [hasApiKey])

  const stopAnalyser = useCallback(() => {
    if (analyserRafRef.current) {
      cancelAnimationFrame(analyserRafRef.current)
      analyserRafRef.current = null
    }
    try {
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    micStreamRef.current = null
    analyserRef.current = null
    const ctx = analyserCtxRef.current
    analyserCtxRef.current = null
    if (ctx) {
      try {
        void ctx.close()
      } catch {
        /* ignore */
      }
    }
    setVoiceLevel(0)
  }, [])

  const stopSpeech = useCallback(() => {
    speechGen.current += 1
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
    setSpeaking(false)
    setVoiceCaption('')
  }, [])

  const stopVoiceRecognition = useCallback(() => {
    voiceListenWantedRef.current = false
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (!rec) {
      setListening(false)
      return
    }
    try {
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      rec.stop()
    } catch {
      /* ignore */
    }
    try {
      rec.abort?.()
    } catch {
      /* ignore */
    }
    setListening(false)
    // Keep caption if TTS is about to speak; otherwise clear listening transcript
    if (!voiceBusyRef.current) setVoiceCaption('')
  }, [])

  const speakText = useCallback(
    (text: string, onDone?: () => void) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        onDone?.()
        return
      }

      const gen = ++speechGen.current
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
      setSpeaking(false)

      const utter = new SpeechSynthesisUtterance(text)
      const replyLang = detectReplyLang(text)
      utter.lang = replyLang
      utter.rate = 1.02
      utter.pitch = 0.95

      const finish = () => {
        if (gen !== speechGen.current) return
        setSpeaking(false)
        setVoiceCaption('')
        onDone?.()
      }

      const speakNow = () => {
        if (gen !== speechGen.current) return
        const voice = pickVoiceForText(text)
        if (voice) {
          utter.voice = voice
          if (voice.lang) utter.lang = voice.lang
        } else {
          utter.lang = replyLang
        }
        utter.onstart = () => {
          if (gen !== speechGen.current) {
            try {
              window.speechSynthesis.cancel()
            } catch {
              /* ignore */
            }
            return
          }
          setSpeaking(true)
          setVoiceCaption(text)
        }
        utter.onend = finish
        utter.onerror = () => {
          if (gen !== speechGen.current) return
          stopVoiceModeRef.current()
          setMicHint('Audio playback failed. You can read the full reply in chat.')
        }
        try {
          setVoiceCaption(text)
          window.speechSynthesis.speak(utter)
        } catch {
          finish()
        }
      }

      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        speakNow()
        return
      }

      let spoken = false
      const onVoices = () => {
        if (spoken || gen !== speechGen.current) return
        if (window.speechSynthesis.getVoices().length === 0) return
        spoken = true
        window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
        speakNow()
      }
      window.speechSynthesis.addEventListener('voiceschanged', onVoices)
      window.setTimeout(() => {
        if (spoken) return
        if (gen !== speechGen.current) {
          window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
          return
        }
        if (window.speechSynthesis.getVoices().length > 0) {
          spoken = true
          window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
          speakNow()
        } else {
          spoken = true
          window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
          stopVoiceModeRef.current()
          setMicHint('No speech voice is available on this device. The reply is still visible in chat.')
        }
      }, 350)
    },
    [],
  )

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if(liveSubmit.current){liveSubmit.current(text);setInput('');return}
      if(kasSubmit.current){kasSubmit.current(text);setInput('');return}
      if (/^KAS-/i.test(trimmed)) { setKasCode(trimmed.toUpperCase()); setInput(''); return }
      const command=trimmed.toLowerCase();const liveKind=command==='live'?'syberlive':command==='crossfire'?'crossfire':null
      if(liveKind){if(thinking||voiceModeRef.current)return;setInput('');if(liveSkills[liveKind]){setKasCode('');setLiveEntry({kind:liveKind})}else setMessages(old=>[...old,{id:crypto.randomUUID(),role:'assistant',text:t('Install this skill in AI Lab first.')}]);return}
      const files = pendingFilesRef.current
      const key = apiKeyRef.current.trim()
      const usingApi = Boolean(key)

      if (thinking || modelFlow.busy || voiceModeRef.current) return
      if (!trimmed && !(usingApi && files.length > 0)) return

      // New send interrupts any in-progress stream
      cancelTyping()
      const thisSend = ++sendGen.current

      const userLabel =
        trimmed ||
        (files.length === 1
          ? `[Attached: ${files[0].name}]`
          : `[Attached ${files.length} files]`)

      const priorHistory = messagesRef.current.map((m) => ({
        role: m.role,
        text: m.text,
      }))

      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: 'user',
          text: userLabel,
        },
      ])
      setInput('')
      setPendingFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      setThinking(true)

      requestAnimationFrame(() => {
        if (inputRef.current) inputRef.current.style.height = 'auto'
      })

      if (thinkTimer.current) window.clearTimeout(thinkTimer.current)

      if (translatorReady && translationMode) {
        void (async () => {
          try {
            const prov = providerRef.current ?? detectProvider(key)
            let consent = false
            try { consent = localStorage.getItem('ostra-online-translation-consent') === 'yes' } catch { /* Ask again if storage is unavailable. */ }
            if (usingApi && prov && navigator.onLine && !consent) {
              consent = window.confirm('Online translation sends your text to your selected API provider. Allow automatic online translation? Cancel keeps translation on this device.')
              if (consent) { try { localStorage.setItem('ostra-online-translation-consent', 'yes') } catch { /* Session consent still applies. */ } }
            }
            await unloadOfflineModel()
            const reply = await automaticTranslation(trimmed, {
              online: usingApi && prov && consent ? prompt => generateReply(prov, key, [], prompt, []) : undefined,
              offline: desktopTranslator ? (text, source, target) => desktopInference('translate', {model: desktopTranslator, text, source, target}) : translateOffline,
              connected: () => navigator.onLine,
              cancelled: () => thisSend !== sendGen.current,
              status: status => { if (thisSend === sendGen.current) setTranslationStatus(status) },
            })
            if (thisSend === sendGen.current) startTyping(reply)
          } catch (error) {
            if (thisSend === sendGen.current) startTyping(error instanceof Error ? error.message : 'Translation failed. Please try again.')
          }
        })()
        return
      }
      if (!usingApi) {
        if (localModels.includes(localModel)) {
          void offlineReply(localModel, priorHistory, trimmed).then(reply => {
            if (thisSend === sendGen.current) startTyping(reply)
          }).catch(error => {
            if (thisSend === sendGen.current) startTyping(t(error instanceof Error ? error.message : 'Offline generation failed. Please try again.'))
          })
          return
        }
        startTyping(t('Download the active model in AI Lab to chat offline. You can choose another model in Settings.'))
        return
      }

      // Real API request — 100% API-dependent when key is active
      void (async () => {
        const prov = providerRef.current ?? detectProvider(key)
        try {
          if (!prov) throw new Error('Could not detect provider from API key')
          const reply = await generateReply(prov, key, priorHistory, trimmed, files)
          if (thisSend !== sendGen.current) return
          startTyping(reply)
        } catch (err) {
          if (thisSend !== sendGen.current) return
          startTyping(formatApiError(err, prov))
        }
      })()
    },
    [liveSkills, modelFlow.busy, thinking, cancelTyping, startTyping, translatorReady, translationMode, desktopTranslator, localModel, localModels, t],
  )

  const startVoiceListening = useCallback(() => {
    if (!voiceModeRef.current || voiceBusyRef.current) return
    const session = voiceSessionRef.current
    const SR = getSpeechRecognition()
    if (!SR) {
      setMicHint("Voice input isn't supported in this browser (try Chrome/Edge).")
      window.setTimeout(() => setMicHint(null), 3500)
      return
    }

    stopVoiceRecognition()
    voiceListenWantedRef.current = true

    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = speechLangRef.current || preferredRecognitionLang()
    rec.continuous = false
    rec.interimResults = true

    let finalText = ''
    rec.onresult = (ev) => {
      const parts: string[] = []
      let gotFinal = false
      for (let i = 0; i < ev.results.length; i++) {
        const row = ev.results[i]
        const t = row[0]?.transcript ?? ''
        parts.push(t)
        if (row.isFinal) gotFinal = true
      }
      const joined = parts.join(' ').trim()
      if (joined) setVoiceCaption(joined)
      if (gotFinal && joined) {
        finalText = joined
        speechLangRef.current = preferredRecognitionLang(joined)
      }
    }
    rec.onerror = () => {
      stopVoiceModeRef.current()
      setMicHint('Voice stopped. Check microphone permissions and the speech language, then try again.')
    }
    rec.onend = () => {
      setListening(false)
      if (!voiceModeRef.current || !voiceListenWantedRef.current) return
      const uttered = finalText.trim()
      finalText = ''
      if (uttered) {
        handleVoiceUtteranceRef.current(uttered)
        return
      }
      window.setTimeout(() => {
        if (session === voiceSessionRef.current && voiceModeRef.current && voiceListenWantedRef.current && !voiceBusyRef.current) {
          startVoiceListeningRef.current()
        }
      }, 220)
    }
    try {
      rec.start()
      setListening(true)
      setMicHint(null)
      setVoiceCaption('')
    } catch {
      stopVoiceModeRef.current()
      setMicHint("Couldn't start the microphone. Check permissions and try again.")
    }
  }, [stopVoiceRecognition])

  const handleVoiceUtterance = useCallback(
    async (uttered: string) => {
      if (!voiceModeRef.current || voiceBusyRef.current) return
      const key = apiKeyRef.current.trim()
      if (!key) return

      const session = voiceSessionRef.current
      voiceBusyRef.current = true
      voiceListenWantedRef.current = false
      stopVoiceRecognition()
      speechLangRef.current = preferredRecognitionLang(uttered)

      const priorHistory = messagesRef.current.map((m) => ({
        role: m.role,
        text: m.text,
      }))
      const files = pendingFilesRef.current
      setPendingFiles([])
      pendingFilesRef.current = []
      setVoiceCaption('')
      setMessages((m) => [...m, { id: uid(), role: 'user', text: uttered }])
      setThinking(true)

      const prov = providerRef.current ?? detectProvider(key)
      let reply = ''
      try {
        if (!prov) throw new Error('Could not detect provider from API key')
        reply = await generateReply(prov, key, priorHistory, uttered, files)
      } catch (err) {
        reply = formatApiError(err, prov)
      }

      if (!voiceModeRef.current || session !== voiceSessionRef.current || key !== apiKeyRef.current.trim()) return

      setThinking(false)
      setMessages((m) => [...m, { id: uid(), role: 'assistant', text: reply }])
      speechLangRef.current = preferredRecognitionLang(reply)

      speakText(reply, () => {
        if (!voiceModeRef.current || session !== voiceSessionRef.current) return
        voiceBusyRef.current = false
        startVoiceListeningRef.current()
      })
    },
    [stopVoiceRecognition, speakText],
  )

  useEffect(() => {
    startVoiceListeningRef.current = startVoiceListening
  }, [startVoiceListening])

  useEffect(() => {
    handleVoiceUtteranceRef.current = (t) => {
      void handleVoiceUtterance(t)
    }
  }, [handleVoiceUtterance])

  const stopVoiceMode = useCallback(() => {
    voiceSessionRef.current += 1
    if (voiceModeRef.current) setThinking(false)
    voiceModeRef.current = false
    voiceBusyRef.current = false
    voiceListenWantedRef.current = false
    setVoiceMode(false)
    stopVoiceRecognition()
    stopSpeech()
    stopAnalyser()
    setVoiceCaption('')
  }, [stopVoiceRecognition, stopSpeech, stopAnalyser])

  useEffect(() => {
    const pause = () => {
      if (document.hidden) stopVoiceMode()
    }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [stopVoiceMode])

  useEffect(() => { stopVoiceModeRef.current = stopVoiceMode }, [stopVoiceMode])

  const toggleVoiceConversation = () => {
    if (voiceModeRef.current) { stopVoiceMode(); return }
    if (!hasApiKey || thinking || attachBusy || streamingId) return
    if (!getSpeechRecognition() || !window.speechSynthesis) {
      setMicHint('Voice conversation is unavailable on this device. You can still type a message.')
      return
    }
    setLandingPanel(null)
    stopVoiceRecognition()
    stopSpeech()
    voiceSessionRef.current += 1
    voiceModeRef.current = true
    setVoiceMode(true)
    setMicHint(null)
    inputRef.current?.blur()
    startVoiceListeningRef.current()
  }

  // Leave voice conversation when chat closes or the API key is removed.
  useEffect(() => {
    if (!hasApiKey) {
      if (voiceModeRef.current) stopVoiceMode()
    }
  }, [hasApiKey, stopVoiceMode])

  const clearChat = useCallback(() => {
    if (thinkTimer.current) window.clearTimeout(thinkTimer.current)
    thinkTimer.current = null
    cancelOfflineReply()
    sendGen.current += 1
    cancelTyping()
    cancelIntroTyping()
    stopVoiceMode()
    setMessages([])
    setThinking(false)
    setInput('')
    setPendingFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
    setMicHint(null)
    setIntroShown(false)
    setIntroDisplay('')
    setLandingPanel(null)
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }, [cancelTyping, cancelIntroTyping, stopVoiceMode])

  const openApiModal = () => {
    setLandingPanel(null)
    setSettingsMenuOpen(false)
    setApiDraft(apiKey)
    setApiProviderPick(provider && isValidPick(provider) ? provider : 'gemini')
    setApiError(null)
    setApiOpen(true)
  }

  const closeSettingsMenu = () => {
    setSettingsMenuOpen(false)
  }

  const openUpdatesCheck = () => {
    setLandingPanel('updates')
  }

  const saveApiKey = () => {
    const trimmed = normalizeApiKey(apiDraft)
    setApiDraft(trimmed)
    if (!trimmed) {
      // Empty = clear
      stopVoiceMode()
      apiKeyRef.current = ''
      setApiKey('')
      setProvider(null)
      clearCredentials()
      setApiError(null)
      setApiOpen(false)
      return
    }
    if (!apiProviderPick || !isValidPick(apiProviderPick)) {
      setApiError('Pick a provider: Gemini, OpenAI, or Anthropic — then Save.')
      return
    }
    const detected = detectProvider(trimmed)
    // Detection is a hint, not proof of validity: unknown formats use the selected provider.
    if (detected && detected !== apiProviderPick) {
      const name = PROVIDER_OPTIONS.find((p) => p.id === detected)?.label ?? detected
      setApiError(`Detected a ${name} API key. Select ${name} below to add this key.`)
      return
    }
    const finalProvider: ProviderId = apiProviderPick
    stopVoiceMode()
    apiKeyRef.current = trimmed
    setApiKey(trimmed)
    setProvider(finalProvider)
    saveCredentials(trimmed, finalProvider)
    setApiError(null)
    setApiOpen(false)
  }

  const clearApiKey = () => {
    stopVoiceMode()
    apiKeyRef.current = ''
    closeSettingsMenu()
    setLandingPanel(null)
    setApiDraft('')
    setApiKey('')
    setProvider(null)
    setApiProviderPick(null)
    setApiError(null)
    clearCredentials()
    setApiOpen(false)
  }

  const openLandingPanel = (kind: Exclude<LandingPanel, null>) => {
    setApiOpen(false)
    closeSettingsMenu()
    setLandingPanel(kind)
  }

  const onPickFiles = async (list: FileList | null) => {
    if (!list || list.length === 0 || !hasApiKey) return
    setAttachBusy(true)
    try {
      const prepared: PendingFile[] = []
      for (const file of Array.from(list)) {
        prepared.push(await preparePendingFile(file, uid()))
      }
      setPendingFiles((prev) => [...prev, ...prepared].slice(0, 6))
    } catch {
      setMicHint("Couldn't read that file. Try another.")
      window.setTimeout(() => setMicHint(null), 3500)
    } finally {
      setAttachBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const isBusy = thinking || attachBusy || voiceMode
  const canSend = !modelFlow.busy &&
    !isBusy && (Boolean(input.trim()) || (hasApiKey && pendingFiles.length > 0))

  const collapseChat = useCallback(() => {
    setApiOpen(false)
    setLandingPanel(null)
    setSettingsMenuOpen(false)
    // If welcome was mid-type, finish it so reopen (without X clear) won't re-type
    if (!introShown && (introStreaming || introDisplay)) {
      cancelIntroTyping()
      setIntroDisplay(getWelcomeText(Boolean(apiKeyRef.current.trim())))
      setIntroShown(true)
    }
    setChatOpen(false)
    setHistoryOpen(false)
  }, [introShown, introStreaming, introDisplay, cancelIntroTyping])

  /** X: wipe conversation and return to landing. Collapse keeps chat state. */
  const closeAndClearChat = useCallback(() => {
    clearChat()
    setActiveChatId(crypto.randomUUID())
    collapseChat()
  }, [clearChat, collapseChat])

  const openChat = useCallback(() => {
    setWatchOpen(false)
    if (chatOpen) return

    // Opening chat always leaves voice mode + landing menus
    stopVoiceMode()
    setLandingPanel(null)
    setApiOpen(false)
    setSettingsMenuOpen(false)
    setChatOpen(true)
    // Re-type welcome only when opening from a cleared (X) state
    if (!introShown) {
      if (introDelayTimer.current) window.clearTimeout(introDelayTimer.current)
      const welcome = getWelcomeText(Boolean(apiKeyRef.current.trim()))
      const delay = prefersReducedMotion() ? 0 : 420
      introDelayTimer.current = window.setTimeout(() => {
        introDelayTimer.current = null
        startIntroTyping(welcome)
      }, delay)
    } else if (!introDisplay) {
      setIntroDisplay(getWelcomeText(Boolean(apiKeyRef.current.trim())))
    }
  }, [chatOpen, introShown, introDisplay, startIntroTyping, stopVoiceMode, session])

  const newConversation = () => {
    clearChat()
    setActiveChatId(crypto.randomUUID())
    setChatOpen(true)
    setIntroDisplay(getWelcomeText(Boolean(apiKeyRef.current.trim())))
    setIntroShown(true)
  }
  const selectConversation = (chat: Conversation) => {
    clearChat()
    setActiveChatId(chat.id)
    setMessages(chat.messages)
    messagesRef.current = chat.messages
    setChatOpen(true)
    setIntroShown(true)
  }
  const changeConversation = (chat: Conversation) => {
    setChats(previous => previous.map(item => item.id === chat.id ? chat : item))
    if ((chat.deleted || chat.archived) && chat.id === activeChatId) newConversation()
  }

  const teslaOrb = useTeslaOrb(!chatOpen && !watchOpen && !landingPanel)

  /** Big living-cell logo: single click always opens chat (stops voice if running). */
  const onLandingClick = useCallback(() => {
    if (chatOpen) return
    openChat()
  }, [chatOpen, openChat])

  return (
    <div
      className={`app-shell has-navigation${watchOpen ? ' is-watch-open' : ''} theme-${chatColor}${session && chatOpen && historyOpen ? ' has-history' : ''} ${chatOpen ? 'is-chat-open' : 'is-landing'}${
        hasApiKey && provider ? ` ${providerThemeClass(provider)}` : ''
      }`}
    >
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs><filter id="mic-cutout" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -0.2126 -0.7152 -0.0722 1 0" />
        </filter></defs>
      </svg>
      <div className="bg-layer" aria-hidden>
        <div className="bg-gradient" />
        <div className="bg-blur" />
      </div>

      <div className="landing-stage" aria-hidden={chatOpen} inert={chatOpen ? true : undefined}>
        <div className={`landing-cluster${hasApiKey && !chatOpen ? ' has-voice-energy' : ''}`}>
          <button
            type="button"
            ref={teslaOrb.buttonRef}
            className={`landing-entry${teslaOrb.tesla ? ' is-tesla-orb' : ''}${voiceMode ? ' is-voice-mode' : ''}`}
            onClick={onLandingClick}
            aria-label={t("Open chat")}
            title={t("Open chat")}
            tabIndex={chatOpen ? -1 : 0}
          >
            <LivingCell
              tesla={teslaOrb.tesla}
              hasApiKey={hasApiKey}
              provider={provider}
              speaking={speaking}
              thinking={thinking}
              responding={Boolean(streamingId)}
              listening={voiceMode && listening && !speaking}
              voiceLevel={voiceMode && listening && !speaking ? voiceLevel : 0}
              subtitle={voiceMode ? voiceCaption : ''}
              guestCount={presence.guests} memberCount={presence.members} modelColor={localModels.includes(localModel)?MODELS.find(m=>m.id===localModel)?.color:undefined} movieSyncActive={movieSyncStage === 'active'}
              birdCount={displayBirdColors.length}
              birdPalette={birdPalette}
              birdColors={displayBirdColors}
            />
          </button>

        </div>
      </div>

      {!chatOpen && voiceMode && <div className="landing-voice-status" role="status"><span className="voice-status-dot" />{speaking ? t('robaqAI is speaking…') : thinking ? t('Thinking…') : listening ? t('Listening…') : t('Voice conversation')}</div>}
      <Navigation kasActive={kasActive} onKas={() => { setWatchOpen(false); setLandingPanel(null); setChatOpen(false); setKasOpen(true) }} movieSyncActive={movieSyncStage === 'active'} onMovieSync={() => { setChatOpen(false); setLandingPanel(null); setWatchOpen(true) }} hasApiKey={hasApiKey} voiceMode={voiceMode} voiceMoving={voiceMode && (listening || speaking)} voiceDisabled={!voiceMode && (thinking || attachBusy || Boolean(streamingId))} onVoice={toggleVoiceConversation} email={session?.email} historyOpen={historyOpen} onHistory={() => { setHistoryOpen(open => chatOpen ? !open : true); openChat() }} onHome={() => { setWatchOpen(false); collapseChat() }} onLibrary={() => openLandingPanel('store')} onSettings={() => openLandingPanel('settings')} onAbout={() => openLandingPanel('about')} onAccount={() => openLandingPanel('account')} />

      {session && chatOpen && historyOpen && <History chats={chats} activeId={activeChatId} onOpen={selectConversation} onNew={newConversation} onChange={changeConversation} onClose={() => setHistoryOpen(false)} />}
      {saveError && <div className="history-save-error" role="alert">{t(saveError)}</div>}
      <div
        className={`chat-panel chat-color-${chatColor}`}
        role="main"
        aria-hidden={!chatOpen}
        inert={!chatOpen ? true : undefined}
      >
        <header className="panel-top">
          <div className="chat-intelligence">
            {session && !historyOpen && <button type="button" className="history-corner-toggle" onClick={() => setHistoryOpen(true)} aria-label={t("Expand chat sidebar")} title={t("Expand chat sidebar")}>→</button>}
            <div className="chat-intelligence-label">
              <span>robaqAI</span>
            </div>
          </div>
          <div className="panel-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={collapseChat}
              aria-label={t("Minimize chat")}
              title={t("Minimize")}
            >
              <IconCollapse />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={closeAndClearChat}
              aria-label={t("Close and clear chat")}
              title={t("Close & clear")}
            >
              <IconX />
            </button>
          </div>
        </header>

        {!kasCode && !liveEntry && (introDisplay || introStreaming) && (
          <p className={`intro-text${introStreaming ? ' is-streaming' : ''}`} aria-live="polite">
            {introDisplay}
            {introStreaming && <span className="stream-caret" aria-hidden />}
          </p>
        )}

        {liveEntry && chatOpen && <LiveChat key={liveEntry.kind+(liveEntry.room??'')} kind={liveEntry.kind} invite={liveEntry.room} name={session ? ([session.firstName,session.lastName].filter(Boolean).join(' ')||session.email.split('@')[0]) : 'Guest'} submitRef={liveSubmit} onClose={()=>{setLiveEntry(null);setChatOpen(false)}} />}
        {kasCode && !liveEntry && <KasReader key={kasCode} code={kasCode} submitRef={kasSubmit} onClose={() => {setKasCode('');setChatOpen(false)}} />}
        <div className="history-lane" style={kasCode || liveEntry ? {display: 'none'} : undefined} ref={historyRef} aria-live="polite">
          {messages.map((m) => {
            const streaming = streamingId === m.id
            return (
              <div
                key={m.id}
                className={`msg-bubble ${m.role === 'user' ? 'msg-user' : 'msg-assistant'}${
                  streaming ? ' is-streaming' : ''
                }`}
              >
                {m.role === 'assistant' ? m.text.replace(/R\.A\.?I|Birdoff|Smartass|Ostra|robaq AI/gi, 'robaqAI') : m.text}
                {streaming && <span className="stream-caret" aria-hidden />}
              </div>
            )
          })}
          {thinking && (
            <div className="msg-bubble msg-assistant typing-bubble" aria-label={t("Thinking…")}>
              <span className="typing-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
        </div>

        {micHint && <p className="mic-hint" role="status">{t(micHint)}</p>}
        {voiceMode && (
          <div className="voice-conversation-status" role="status">
            <span className="voice-status-dot" aria-hidden />
            <span>{speaking ? t("robaqAI is speaking…") : thinking ? t("Thinking…") : listening ? t("Listening…") : t("Voice conversation")}</span>
          </div>
        )}
        {voiceMode && listening && voiceCaption && (
          <div className="voice-live-transcript">{voiceCaption}</div>
        )}

        {hasApiKey && pendingFiles.length > 0 && (
          <div className="attach-chips" aria-label={t("Attached files")}>
            {pendingFiles.map((f) => (
              <div key={f.id} className="attach-chip">
                <span className="attach-name" title={f.name}>
                  {f.name}
                </span>
                <button
                  type="button"
                  className="attach-remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => removePendingFile(f.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {!hasApiKey && localModel && thinking && <button type="button" className="modal-btn offline-stop" onClick={() => { cancelOfflineReply(); sendGen.current += 1; setThinking(false) }}>{t('Stop generating')}</button>}
        {translatorReady && translationMode && <span className="translation-connection" role="status">Translator · {translationStatus}</span>}
        <form className={`composer${liveEntry?' live-composer':''}${hasApiKey && voiceMode ? ' is-voice-active' : ''}`}
          data-provider={hasApiKey ? provider ?? 'gemini' : undefined}
          data-voice-moving={hasApiKey && voiceMode && (listening || speaking) ? 'true' : 'false'}
          onSubmit={onSubmit}>
          <div className="composer-left">
            {translatorReady && <button type="button" className={`translator-composer-btn${translationMode ? ' is-on' : ''}`} disabled={thinking || Boolean(streamingId)} aria-label="#Translator" title={t(translationMode ? 'Translator ON' : 'Translator OFF')} aria-pressed={translationMode} onClick={() => setTranslationMode(enabled => !enabled)}><IconTranslator /></button>}
            {hasApiKey && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  accept={ACCEPT_FILES}
                  multiple
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => void onPickFiles(e.target.files)}
                />
                <button
                  type="button"
                  className="file-btn"
                  aria-label={t("Attach file")}
                  title={t("Attach image or document")}
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <IconPaperclip />
                </button>
              </>
            )}

          </div>

          <div className="composer-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={voiceMode ? '' : t("Write a message…")}
            aria-label={t("Message")}
            autoComplete="off"
            disabled={isBusy}
          />
          {hasApiKey && (
            <span className="composer-voice-line" aria-hidden="true">
              <svg viewBox="0 0 400 20" preserveAspectRatio="none">
                <path d="M0 10 H40 Q50 10 56 7 T72 10 H100 Q110 10 116 15 T132 10 H155 L162 8 168 12 174 2 181 18 188 5 195 12 203 10 H240 Q250 10 257 6 T275 10 H310 Q320 10 327 13 T345 10 H400" />
              </svg>
            </span>
          )}
          </div>

          <div className="composer-right">
            {!hasApiKey && <div className="offline-model-menu">
              <button type="button" className={`offline-model-trigger${modelMenuOpen ? ' is-open' : ''}`} aria-label={t('Offline AI')} aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen(open => !open)} disabled={thinking || Boolean(streamingId)}>AI</button>
              {modelMenuOpen && <div className="offline-model-popover"><span>{MODELS.find(m=>m.id===localModel)?.name}</span><button className="modal-btn" onClick={()=>{setModelMenuOpen(false);openLandingPanel('settings');setTimeout(()=>document.getElementById('offline-ai-settings')?.scrollIntoView(),100)}}>{t('Settings')}</button></div>}
            </div>}
            {(thinking || Boolean(streamingId)) ? <button type="button" className="send-btn generation-stop-btn" aria-label={t('Stop generating')} title={t('Stop generating')} onClick={() => { cancelTyping(); sendGen.current += 1; stopTranslationWorker(); cancelDesktopReply(); cancelOfflineReply(); streamGen.current += 1; setThinking(false); setStreamingId(null) }}><IconStop /></button> : <button type="submit" className="send-btn" disabled={!canSend} aria-label={t("Send")}><IconSendUp /></button>}
          </div>
        </form>
      </div>

      {apiOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setApiOpen(false)}>
          <div
            className="modal-card"
            role="dialog"
            aria-labelledby="api-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="api-title">{t("API key")}</h2>
            <p className="modal-help"> {t("Choose Gemini, OpenAI, or Anthropic, then paste your key (AIza… / sk-… / sk-ant-…). Save stores both the provider and key on this device. Clear returns to offline replies.")} </p>
            <input
              type="password"
              className="modal-input"
              value={apiDraft}
              onChange={(e) => {
                setApiDraft(e.target.value)
                setApiError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveApiKey()
                }
              }}
              placeholder="AIza… / sk-… / sk-ant-…"
              autoComplete="off"
              autoFocus
            />
            <div className="provider-pick" role="group" aria-label={t("Provider")}>
              {PROVIDER_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`provider-chip provider-chip-${p.id}${
                    apiProviderPick === p.id ? ' is-active' : ''
                  }`}
                  onClick={() => {
                    setApiProviderPick(p.id)
                    setApiError(null)
                  }}
                  title={p.hint}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {apiError && (
              <p className="modal-error" role="alert">
                {t(apiError)}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="modal-btn ghost" onClick={() => setApiOpen(false)}> {t("Cancel")} </button>
              {(apiKey || apiDraft) && (
                <button type="button" className="modal-btn ghost danger" onClick={clearApiKey}> {t("Clear")} </button>
              )}
              <button type="button" className="modal-btn primary" onClick={saveApiKey}> {t("Save")} </button>
            </div>
          </div>
        </div>
      )}

      {landingPanel === 'settings' && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLandingPanel(null)}>
          <div
            className="modal-card side-panel settings-menu"
            role="dialog"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="settings-title">{t("Settings")}</h2>
            <label className="settings-language">{t('Language')}<select value={locale} onChange={event => setLocale(event.target.value as 'en' | 'ka' | 'ru')}><option value="en">English</option><option value="ka">ქართული</option><option value="ru">Русский</option></select></label>
            <p className="modal-help">{t("API credentials and updates.")}</p>
            <fieldset className="chat-color-options"><legend>{t('Interior colors')}</legend>{(['system', 'default', 'white'] as const).map(color => <label key={color} className={`color-choice color-${color}`}><input type="radio" name="chat-color" value={color} checked={themeChoice === color} onChange={() => { setChatColor(color); try { localStorage.setItem('robaq-theme-choice', color) } catch { /* Session only. */ } }} /><span aria-hidden="true" />{t(color === 'system' ? 'System theme' : color === 'default' ? 'Default' : 'White')}</label>)}</fieldset>
            <OfflineModelSelect disabled={thinking || Boolean(streamingId)} />
            <div className="settings-menu-list" role="menu">
              <button
                type="button"
                className={`settings-menu-item${hasApiKey ? ' is-danger' : ''}`}
                role="menuitem"
                onClick={hasApiKey ? clearApiKey : () => openApiModal()}
              >
                <span className="side-panel-item-icon" aria-hidden>
                  <IconKey />
                </span>
                <span className="settings-menu-item-body">
                  <span className="side-panel-item-name">{hasApiKey ? t("Remove API Key") : t("Add API Key")}</span>
                  <span className="side-panel-item-meta">
                    {hasApiKey
                      ? provider
                        ? `${t('Connected')} · ${PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ?? provider}`
                        : t("Connected")
                      : t("Add Gemini, OpenAI, or Anthropic key")}
                  </span>
                </span>
              </button>

            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn primary"
                onClick={() => setLandingPanel(null)}
              > {t("Close")} </button>
            </div>
          </div>
        </div>
      )}

      {landingPanel === 'update-menu' && (
        <div className="modal-backdrop" onClick={() => setLandingPanel(null)}>
          <div className="modal-card" role="dialog" aria-labelledby="update-menu-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="update-menu-title">{t("Updates")}</h2>
            <div className="settings-menu-list">
              <button className="settings-menu-item" onClick={openUpdatesCheck}>{t("Check System Update")}</button>
              <button className="settings-menu-item" onClick={() => openLandingPanel('store')}>{t("Download Local AI")}</button>
            </div>
            <div className="modal-actions"><button className="modal-btn ghost" onClick={() => setLandingPanel(null)}>{t("Close")}</button></div>
          </div>
        </div>
      )}

      {landingPanel === 'updates' && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLandingPanel(null)}>
          <div
            className="modal-card"
            role="dialog"
            aria-labelledby="updates-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="updates-title">{t("Check System Update")}</h2>
            <p className="modal-help">{t("An update server is not connected to this local version yet.")}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn primary"
                onClick={() => setLandingPanel(null)}
              > {t("OK")} </button>
            </div>
          </div>
        </div>
      )}

      {landingPanel === 'plugin' && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLandingPanel(null)}>
          <div
            className="modal-card side-panel"
            role="dialog"
            aria-labelledby="plugin-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="plugin-title">{t("Plug-In")}</h2>
            <p className="modal-help">{t("Installed plug-ins (placeholder).")}</p>
            <ul className="side-panel-list" role="list">
              <li className="side-panel-item">
                <span className="side-panel-item-icon" aria-hidden>
                  <IconPlug />
                </span>
                <div className="side-panel-item-body">
                  <span className="side-panel-item-name">{t("Test 1")}</span>
                  <span className="side-panel-item-meta">{t("Placeholder plugin")}</span>
                </div>
              </li>
            </ul>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn ghost"
                onClick={() => openLandingPanel('settings')}
              > {t("Back")} </button>
              <button
                type="button"
                className="modal-btn primary"
                onClick={() => setLandingPanel(null)}
              > {t("Close")} </button>
            </div>
          </div>
        </div>
      )}

      {kasOpen && <Kas onClose={() => setKasOpen(false)} />}
      {watchOpen && <Suspense fallback={<div role="status">MovieSync…</div>}><WatchTogether signedIn={Boolean(session)} displayName={session ? ([session.firstName, session.lastName].filter(Boolean).join(' ') || session.email.split('@')[0]).slice(0, 32) : ''} onClose={() => { setWatchOpen(false); const url = new URL(window.location.href); url.searchParams.delete('watch'); window.history.replaceState(null, '', url) }} /></Suspense>}

      {landingPanel === 'store' && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLandingPanel(null)}>
          <div
            className="modal-card side-panel store-panel"
            role="dialog"
            aria-labelledby="store-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="store-update-header">
              <h2 id="store-title">{t("AI Lab")}</h2>
              <small className="version-label">{t('Version')} {currentVersion}</small>
            </div>
            <p className="modal-help"> {t('Offline models and everyday tools — all in one place.')} </p>

            <p className="ai-lab-use-note">{t('For education and lawful use only. You are responsible for how you use these tools. Misuse is prohibited.')}</p>
            <h3 className="store-section-title store-section-title-info">{t('AI Skills')}<details className="store-info inline-store-info"><summary aria-label={t('AI Skills information')}>?</summary><p className="modal-help">{t('Install optional tools for secrets, shared videos and private live rooms. Active tools are ready to use; Delete removes them from this device.')} {t('After installation, type live or crossfire in the chat to start a private room.')}</p></details></h3>
            <div className="ai-skills-list">
            <KasStore active={kasActive} onChange={active => { setKasActive(active); skillPreferences.setItem('robaq-kas-active', String(active)) }} onOpen={() => { setLandingPanel(null); setWatchOpen(false); setChatOpen(false); setKasOpen(true) }} />
            <MovieSyncStore stage={movieSyncStage} onChange={changeMovieSyncStage} onOpen={() => { setChatOpen(false); setLandingPanel(null); setWatchOpen(true) }} />

            {(['syberlive','crossfire'] as const).map(kind=><LiveSkillStore key={kind} kind={kind} active={liveSkills[kind]} onChange={active=>{setLiveSkills(old=>({...old,[kind]:active}));if(active)skillPreferences.setItem(`robaq-${kind}-active`,'true');else skillPreferences.removeItem(`robaq-${kind}-active`);if(!active&&liveEntry?.kind===kind)setLiveEntry(null)}} />)}
            </div>
            <OfflineModelLibrary disabled={thinking || Boolean(streamingId)} />

            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn primary"
                onClick={() => setLandingPanel(null)}
              > {t("Close")} </button>
            </div>
          </div>
        </div>
      )}

      {landingPanel === 'account' && <AccountDialog session={session} onProfileUpdate={setSession} onDeleted={() => {
        stopTranslationWorker(); void unloadOfflineModel(); setPersistentSkills(false)
        clearChat(); messagesRef.current = []; apiKeyRef.current = ''; setApiKey(''); setProvider(null); setSession(null); setChats([]); setActiveChatId(null); setChatOpen(false);  setM2mReady(false); setDesktopTranslator(''); setChatColor('system'); setLocale('en'); setHistoryOpen(false); setSaveError(''); setMovieSyncStage('new'); setLandingPanel('account')
      }} onGuest={() => { setLandingPanel(null); setWatchOpen(false); collapseChat() }} onClose={() => setLandingPanel(null)} onSignedIn={async (account, history) => {
        clearChat()
        messagesRef.current = []
        stopTranslationWorker(); await unloadOfflineModel()
        try { await retainGuestSkills() } catch { setSaveError(t('Some guest downloads could not be saved. Please download them again.')) }
        setSession(account)
        setWatchOpen(false)
        setChats(history)
        setActiveChatId(crypto.randomUUID())
        setChatOpen(false)
        setLandingPanel(null)
      }} onSignOut={() => {
        void signOut().catch(() => setSaveError(t('Server sign-out could not be confirmed. Please reconnect and try again.')))
        clearChat()
        messagesRef.current = []
        if (session) void saveChats(session, chats).catch(() => setSaveError('The last changes could not be saved.'))
        stopTranslationWorker(); void unloadOfflineModel(); setPersistentSkills(false)
        setMovieSyncStage('new'); setM2mReady(false)
        setSession(null)
        setChats([])
        setActiveChatId(null)
        setChatOpen(false)
      }} />}

      {landingPanel === 'about' && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLandingPanel(null)}>
          <div
            className="modal-card side-panel"
            role="dialog"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="about-title">{t("About robaqAi")}</h2>
            <p className="about-lead">{t('A little space for bigger ideas.')}</p>
            <p className="modal-help">{t('I am building robaqAi with dedication and a simple goal: to make everyday tasks easier. I want to keep adding useful skills and tools that help us learn, create and get things done.')}</p>
            <p className="modal-help">{t('This independent project is growing step by step. Your feedback helps shape what comes next.')}</p>
            <p className="modal-help about-responsibility">{t('Use these tools lawfully and respect others’ privacy and rights. AI can make mistakes; verify important results. Features may change as the project develops.')}</p>
            <div className="modal-actions about-actions">
              <button type="button" className="modal-btn about-support" onClick={() => setLandingPanel('donate')}>{t('Support the project')}</button>
              <button type="button" className="modal-btn" onClick={() => setLandingPanel(null)}>{t('Cancel')}</button>
            </div>
            <small className="about-author version-label">{t('Author')}: N.ROBAKIDZE</small>
          </div>
        </div>
      )}

      {landingPanel === 'donate' && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLandingPanel(null)}>
          <div
            className="modal-card side-panel"
            role="dialog"
            aria-labelledby="donate-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="donate-title">{t('Support robaqAi')}</h2>
            <p className="modal-help"> {t("Your voluntary support helps me develop new skills and tools and maintain robaqAi. Thank you for helping the project grow.")} </p>
            <p className="modal-help"> {t("The donation link will be added here soon. Payments are not available yet.")} </p>
            <p className="modal-help">{t('Support is optional and does not purchase a feature or guarantee future releases.')}</p>
            <button type="button" className="modal-btn donation-button" disabled>{t('Donate — coming soon')}</button>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn primary"
                onClick={() => setLandingPanel(null)}
              > {t("Close")} </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() { return <LocaleProvider><AppContent /></LocaleProvider> }
