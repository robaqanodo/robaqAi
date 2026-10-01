import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../i18n/Locale'
export type VoiceReaction = { id: string; name: string; memberId: string; sentAt: number }
type VoiceData = { data: string; mime: string }
export function VoiceReactions({ volume, voices, memberId, disabled, send, load }: { volume: number; voices: VoiceReaction[]; memberId: string; disabled: boolean; send: (value: VoiceData) => Promise<void>; load: (id: string) => Promise<VoiceData> }) {
  const { t } = useLocale()
  const [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(10), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const volumeRef = useRef(volume)
  volumeRef.current = volume
  const playingId = useRef<string | null>(null)
  useEffect(() => { if (audio.current) audio.current.volume = volume }, [volume])
  const recordingVersion = useRef(0)
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), mounted = useRef(true), blocked = useRef(disabled), cancelled = useRef(false), starting = useRef(false)
  const timer = useRef<number | undefined>(undefined), ticker = useRef<number | undefined>(undefined), audioTimer = useRef<number | undefined>(undefined), audio = useRef<HTMLAudioElement | null>(null), audioUrl = useRef(''), seen = useRef(new Set<string>()), playVersion = useRef(0)
  blocked.current = disabled
  function stopAudio() { playingId.current = null; playVersion.current++; window.clearTimeout(audioTimer.current); audio.current?.pause(); audio.current = null; if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); audioUrl.current = '' }
  function stopRecording(discard = false) { if (discard) recordingVersion.current++; cancelled.current = discard; window.clearTimeout(timer.current); window.clearInterval(ticker.current); if (recorder.current?.state === 'recording') recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); stream.current = null }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopRecording(true); stopAudio() } }, [])
  useEffect(() => { if (disabled) { stopRecording(true); setRecording(false) } }, [disabled])
  async function record() {
    if (starting.current || busy || disabled || recording) return
    const captureVersion = ++recordingVersion.current
    starting.current = true; setBusy(true); setError(''); cancelled.current = false
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Voice recording requires a supported browser and HTTPS.')
      const input = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current || blocked.current || captureVersion !== recordingVersion.current) { input.getTracks().forEach(track => track.stop()); return }
      stream.current = input
      const mime = ['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(value => MediaRecorder.isTypeSupported(value))
      if (!mime) throw new Error('This browser cannot record a supported audio format.')
      const instance = new MediaRecorder(input, { mimeType: mime, audioBitsPerSecond: 48000 }); recorder.current = instance
      const chunks: Blob[] = []
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      instance.onerror = () => { cancelled.current = true; stopRecording(true); if (mounted.current) { setRecording(false); setError('Voice recording failed.') } }
      instance.onstop = () => {
        window.clearTimeout(timer.current); window.clearInterval(ticker.current); input.getTracks().forEach(track => track.stop())
        if (!mounted.current || captureVersion !== recordingVersion.current) return
        setRecording(false)
        if (cancelled.current || blocked.current) return
        setBusy(true)
        void (async () => {
          const blob = new Blob(chunks, { type: mime }); if (!blob.size || blob.size > 262144) throw new Error('Voice recording is too large.')
          const bytes = new Uint8Array(await blob.arrayBuffer()); let raw = ''; bytes.forEach(byte => { raw += String.fromCharCode(byte) })
          if (mounted.current && !blocked.current && captureVersion === recordingVersion.current) await send({ mime, data: btoa(raw) })
        })().catch(e => { if (mounted.current) setError(e instanceof Error ? e.message : 'Voice recording failed.') }).finally(() => { if (mounted.current) setBusy(false) })
      }
      instance.start(); setRecording(true); setSeconds(10)
      ticker.current = window.setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000)
      timer.current = window.setTimeout(() => stopRecording(), 10000)
    } catch (e) { stopRecording(true); setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : e instanceof Error ? e.message : 'Voice recording failed.') }
    finally { starting.current = false; if (mounted.current) setBusy(false) }
  }
  async function play(voice: VoiceReaction) {
    stopAudio(); const version = playVersion.current
    try {
      const value = await load(voice.id)
      if (!mounted.current || version !== playVersion.current) return
      const bytes = Uint8Array.from(atob(value.data), char => char.charCodeAt(0))
      audioUrl.current = URL.createObjectURL(new Blob([bytes], { type: value.mime })); const player = new Audio(audioUrl.current); audio.current = player; player.volume = volumeRef.current; playingId.current = voice.id
      player.onended = () => { if (version === playVersion.current) stopAudio() }
      await player.play(); if (!mounted.current || version !== playVersion.current) { player.pause(); return } audioTimer.current = window.setTimeout(() => { if (version === playVersion.current) stopAudio() }, 10000)
    } catch { if (mounted.current && version === playVersion.current) { stopAudio(); setError('Tap a voice reaction to listen.') } }
  }
  useEffect(() => {
    const fresh = voices.filter(v => !seen.current.has(v.id)); fresh.forEach(v => seen.current.add(v.id))
    const latest = fresh.filter(v => v.memberId !== memberId && Date.now() - v.sentAt < 10000).at(-1)
    if (playingId.current && !voices.some(v => v.id === playingId.current)) stopAudio()
    if (latest) void play(latest)
  }, [voices])
  return <div className="watch-voice"><button className={`modal-btn watch-voice-mic${recording ? ' is-recording' : ''}`} aria-label={t(recording ? 'Send voice' : 'Voice · 10s')} title={t(recording ? 'Send voice' : 'Voice · 10s')} aria-pressed={recording} disabled={disabled || busy} onClick={() => recording ? stopRecording() : void record()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg><span>{recording ? `${seconds}s` : '10s'}</span></button>{recording && <button className="modal-btn ghost" onClick={() => { stopRecording(true); setRecording(false) }}>{t('Cancel')}</button>}{disabled && <small>{t('Microphone unavailable')}</small>}<div className="watch-reactions">{voices.slice(-5).map(v => <button key={v.id} className="modal-btn ghost" onClick={() => void play(v)} aria-label={`${t('Play')} ${v.name}`}>▷ {v.name}</button>)}</div>{error && <small role="status">{t(error)}</small>}</div>
}
