import { useBroadcast } from './useBroadcast'
import { BroadcastView } from './BroadcastView'
import { VoiceReactions, type VoiceReaction } from './VoiceReactions'
import { useLocale } from '../i18n/Locale'
import { watchMedia } from './media'
import { MediaPlayer, type Playback } from './MediaPlayer'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import './watch.css'
type RoomMessage = { id: string; name: string; text: string; memberId?: string; sentAt?: number; color?: string }
type Like = { id: string; memberId: string; color: string; sentAt: number }
type State = { broadcast: string; frame: { x: number; y: number; zoom: number; locked: boolean }; likes: Like[]; likeCount: number; voices: VoiceReaction[]; muted: boolean; muteAll: boolean; locked: boolean; id: string; host: boolean; memberId: string; url: string; position: number; playing: boolean; members: { id: string; name: string; host: boolean; muted: boolean; color: string }[]; messages: RoomMessage[] }
type Ticket = { room: string; token: string }
async function request(action: string, data: object, ticket?: Ticket) {
  const response = await fetch(`/api/watch/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ostra-Watch': '1', ...(ticket ? { Authorization: `Bearer ${ticket.token}` } : {}) }, body: JSON.stringify({ ...data, room: ticket?.room ?? ('room' in data ? data.room : undefined) }), signal: AbortSignal.timeout(10000) })
  const result = await response.json().catch(() => ({ error: 'MovieSync is not connected to its online server yet. Please contact the site owner.' }))
  if (!response.ok || result.error) throw Object.assign(new Error(result.error || 'Connection failed.'), { status: response.status })
  return result
}
export function WatchTogether({ onClose, displayName = '', signedIn = false }: { onClose: () => void; displayName?: string; signedIn?: boolean }) {
  const { t } = useLocale()
  const stageElement = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [volume, setVolume] = useState(1)
  const [changeVideo, setChangeVideo] = useState(false)
  useEffect(() => { const changed = () => setFullscreen(document.fullscreenElement === stageElement.current); document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed) }, [])
  const invite = new URLSearchParams(location.search).get('watch') ?? ''
  const [mode, setMode] = useState(invite ? 'join' : 'create')
  const [name, setName] = useState(displayName); const [code, setCode] = useState(''); const [roomId, setRoomId] = useState(invite)
  useEffect(() => { if (displayName) setName(displayName) }, [displayName])
  const [url, setUrl] = useState(''); const [state, setState] = useState<State | null>(null); const [ticket, setTicket] = useState<Ticket | null>(null)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(false)
  const [chat, setChat] = useState(false); const [message, setMessage] = useState(''); const [notice, setNotice] = useState(''); const [needsPlay, setNeedsPlayState] = useState(false)
  const playbackBlocked = useRef(false)
  const setNeedsPlay = (value: boolean) => { playbackBlocked.current = value; setNeedsPlayState(value) }
  useEffect(() => { setNeedsPlay(false) }, [state?.url])
  const [flash, setFlash] = useState<RoomMessage | null>(null)
  const [flashes, setFlashes] = useState<RoomMessage[]>([])
  const [hearts, setHearts] = useState<Like[]>([])
  const seenLikes = useRef(new Set<string>())
  const clickTimer = useRef<number | undefined>(undefined)
  const lastTouch = useRef(0)
  const suppressClickUntil = useRef(0)
  const likesReady = useRef(false)
  useEffect(() => () => window.clearTimeout(clickTimer.current), [])
  const seenMessages = useRef<Set<string> | null>(null)
  const [duration, setDuration] = useState(0); const [time, setTime] = useState(0)
  const video = useRef<Playback | null>(null); const current = useRef<State | null>(null); const received = useRef(0); const controlBusy = useRef(false); const dragging = useRef(false); const version = useRef(0); const messagesEnd = useRef<HTMLDivElement>(null)
  const accept = (next: State) => { current.current = next; received.current = performance.now(); setState(next); setConnected(true) }
  const broadcast = useBroadcast(state, async (action, data) => {
    if (!ticket) throw new Error('Room closed')
    const result = await request(action, data, ticket)
    if (action === 'broadcast') accept(result)
    return result
  }, setError)
  const sync = () => {
    const el = video.current, s = current.current
    if (!el || !s || el.readyState < 1) return
    const target = s.position + (s.playing ? (performance.now() - received.current) / 1000 : 0)
    const clamped = Number.isFinite(el.duration) && el.duration > 0 ? Math.min(target, el.duration) : target
    if (Math.abs(el.currentTime - clamped) > 1.2) el.currentTime = clamped
    if (s.playing && el.paused && !el.ended && !playbackBlocked.current) void el.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true))
    if (!s.playing && !el.paused) el.pause()
  }
  useEffect(() => {
    if (!ticket) return
    let stopped = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { const requestedVersion = version.current; const next = await request('state', {}, ticket); if (!stopped && !controlBusy.current && !dragging.current && requestedVersion === version.current) { accept(next); sync() } }
      catch (e) { if (!stopped) { setConnected(false); setError(e instanceof Error ? e.message : 'Reconnecting…'); video.current?.pause(); if (e instanceof Error && 'status' in e && e.status === 404) { setTicket(null); setState(null); current.current = null } } }
      if (!stopped) timer = setTimeout(poll, 1000)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [ticket])
  useEffect(() => {
    if (!ticket) return
    const close = () => { void fetch('/api/watch/leave', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Ostra-Watch': '1', Authorization: `Bearer ${ticket.token}` }, body: JSON.stringify({ room: ticket.room }) }).catch(() => {}) }
    window.addEventListener('pagehide', close)
    return () => { window.removeEventListener('pagehide', close); close() }
  }, [ticket])
  useEffect(() => {
    if (!state) { seenMessages.current = null; setFlash(null); setFlashes([]); return }
    if (!seenMessages.current) { seenMessages.current = new Set(state.messages.map(m => m.id)); return }
    const fresh = state.messages.filter(m => !seenMessages.current!.has(m.id))
    fresh.forEach(m => seenMessages.current!.add(m.id))
    const recent = fresh.filter(m => !m.sentAt || Date.now() - m.sentAt < 15000)
    if (recent.length) setFlashes(previous => [...previous, ...recent].slice(-20))
  }, [state?.messages])
  useEffect(() => {
    if (!flash && flashes.length) { setFlash(flashes[0]); setFlashes(previous => previous.slice(1)) }
  }, [flash, flashes])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), 3600)
    return () => clearTimeout(timer)
  }, [flash])
  useEffect(() => { messagesEnd.current?.scrollIntoView({ block: 'nearest' }) }, [state?.messages.length, chat])
  async function enter() {
    setBusy(true); setError('')
    try { let room = roomId.trim(); if (mode === 'join' && /^https?:\/\//i.test(room)) room = new URL(room).searchParams.get('watch') ?? ''; if (mode === 'join' && !/^[a-f0-9]{24}$/i.test(room)) throw new Error('Paste a valid room invitation link.'); const result = await request(mode, { name: signedIn ? name : '', guest: !signedIn, code, url, room }); accept(result.state); setTicket({ room: result.state.id, token: result.token }); setCode('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to join.') }
    finally { setBusy(false) }
  }
  async function control(playing: boolean, position = video.current?.currentTime ?? 0, nextUrl?: string) {
    if (!ticket || !state?.host || controlBusy.current) return
    if (!nextUrl && watchMedia(state.url).kind === 'external') {
      if (playing) await broadcast.start(stageElement.current?.querySelector<HTMLElement>('.watch-browser-window'))
      else await broadcast.stop()
      return
    }
    if (nextUrl && broadcast.sharing) await broadcast.stop()
    controlBusy.current = true; version.current++; setError('')
    try { accept(await request('control', { playing, position, ...(nextUrl ? { url: nextUrl } : {}) }, ticket)); sync() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to control playback.') }
    finally { controlBusy.current = false }
  }
  async function leave() {
    if (ticket) { try { await request('leave', {}, ticket) } catch { /* The room expires when the host is disconnected. */ } }
    video.current?.pause(); onClose()
  }
  async function moderate(operation: string, memberId?: string, value?: boolean) {
    if (!ticket || !state?.host) return
    try { await request('admin', { operation, memberId, value }, ticket) }
    catch (e) { setError(e instanceof Error ? e.message : 'Room request failed.') }
  }
  async function send() {
    if (!ticket || !message.trim()) return
    const text = message; setMessage('')
    try { await request('message', { text }, ticket) } catch (e) { setMessage(text); setError(e instanceof Error ? e.message : 'Message failed.') }
  }
  useEffect(() => {
    if (!state) { setHearts([]); seenLikes.current.clear(); likesReady.current = false; return }
    const likes = state.likes ?? []
    if (!likesReady.current) { likes.forEach(l => seenLikes.current.add(l.id)); likesReady.current = true; return }
    const fresh = likes.filter(l => !seenLikes.current.has(l.id))
    fresh.forEach(l => seenLikes.current.add(l.id))
    if (fresh.length) setHearts(previous => [...previous, ...fresh].slice(-24))
    if (seenLikes.current.size > 300) seenLikes.current = new Set(likes.map(l => l.id))
  }, [state?.likes])
  async function like() {
    window.clearTimeout(clickTimer.current)
    if (!ticket || !connected) return
    try { await request('like', {}, ticket) } catch (e) { setError(e instanceof Error ? e.message : 'Room request failed.') }
  }
  async function copyLink() {
    const link = new URL(location.href); link.search = ''; link.hash = ''; link.searchParams.set('watch', state!.id)
    try { await navigator.clipboard.writeText(link.href); setNotice('Invite link copied. Send your room code separately.') } catch { setNotice(link.href) }
  }
  const externalPage = state ? watchMedia(state.url).kind === 'external' : false
  return <div className="watch-backdrop"><section className={`watch-panel ${state ? 'watch-cinema' : ''}${chat ? ' history-visible' : ''}`} role="region" aria-label={t("Moviesync 1.0")}>
    <header className="watch-header"><div><span className="watch-eyebrow">{t("robaqAI · ONLINE SKILL")}</span><h2>{t("Moviesync 1.0")}</h2></div><div className="watch-header-actions">{state && <button className="modal-btn ghost" onClick={() => void copyLink()}>{t(notice === 'Invite link copied. Send your room code separately.' ? 'Copied' : 'Copy invite link')}</button>}<button className="modal-btn ghost" onClick={() => void leave()}>{t(state?.host ? 'End room' : state ? 'Leave room' : 'Close')}</button></div></header><div className="watch-participant-row">{state && <button className="modal-btn ghost watch-participant-toggle" aria-expanded={participantsOpen} aria-controls="moviesync-participants" onClick={() => setParticipantsOpen(!participantsOpen)}><span aria-hidden="true">{participantsOpen ? '‹' : '›'}</span>{t('Participants')} · {state.members.length}/8</button>}</div>
    {!state ? <div className="watch-setup"><div className="watch-tabs"><button className={mode === 'create' ? 'selected' : ''} onClick={() => { setMode('create'); setError('') }}>{t("Create room")}</button><button className={mode === 'join' ? 'selected' : ''} onClick={() => { setMode('join'); setError('') }}>{t("Join room")}</button></div>
    <form onSubmit={e => { e.preventDefault(); void enter() }} className="watch-form">
    <label>{t(mode === 'create' ? 'Video link' : 'Invitation link')}<div className="watch-paste-field"><input required type={mode === 'create' ? 'url' : 'text'} placeholder="https://…" value={mode === 'create' ? url : roomId} onChange={e => mode === 'create' ? setUrl(e.target.value) : setRoomId(e.target.value)} /><button type="button" className="modal-btn ghost" onClick={async () => { try { const value = (await navigator.clipboard.readText()).trim(); if (mode === 'create') setUrl(value); else setRoomId(value) } catch { setError('Paste the link into the field using your keyboard.') } }}>{t('Paste')}</button></div></label>
    <label>{t('Room password')}<input required type="password" placeholder={t('At least 6 characters')} minLength={6} maxLength={64} value={code} onChange={e => setCode(e.target.value)} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} /></label><button className="modal-btn primary" disabled={busy || code.length < 6 || !(mode === 'create' ? url : roomId).trim()}>{t(busy ? 'Connecting…' : mode === 'create' ? 'Create room' : 'Join room')}</button></form></div> : <>
    <div className="watch-room-layout">{participantsOpen && <aside className="watch-participants" id="moviesync-participants" aria-label={t('Participants')} onKeyDown={e => { if (e.key === 'Escape') setParticipantsOpen(false) }}><button className="modal-btn ghost watch-drawer-close" aria-label={t('Collapse participants')} onClick={() => setParticipantsOpen(false)}>‹</button>    <div className="watch-room-status"><span className={connected ? 'watch-online' : ''}>{t(connected ? '● Connected' : '○ Reconnecting')}</span><span>{state.members.length}{' '}{t("/ 8 watching ·")}{' '}{t(state.host ? 'You are hosting' : 'Host controls playback')}</span></div>    <div className="watch-people">{state.members.map(m => <span key={m.id} style={{ '--member-color': m.color } as CSSProperties}><i className="watch-member-dot" />{m.name}{m.host ? ' · ' + t('Host') : ''}{m.muted ? ' · ' + t('Muted') : ''}{state.host && !m.host && <><button className="modal-btn ghost" onClick={() => void moderate('mute', m.id, !m.muted)} disabled={state.muteAll}>{t(m.muted ? 'Unmute' : 'Mute')}</button><button className="modal-btn danger" onClick={() => { if (window.confirm(t('Remove this participant?'))) void moderate('remove', m.id) }}>{t('Remove')}</button></>}</span>)}</div>
    {state.host && <div className="watch-admin"><button className="modal-btn ghost" onClick={() => void moderate('mute-all', undefined, !state.muteAll)}>{t(state.muteAll ? 'Allow guest microphones' : 'Mute all guests')}</button><button className="modal-btn ghost" onClick={() => void moderate('lock', undefined, !state.locked)}>{t(state.locked ? 'Unlock room' : 'Lock room')}</button><small>{t('Remove ends their current session. Lock the room to prevent rejoining.')}</small></div>}</aside>}<div className="watch-room-main">

    <div className="watch-viewing"><div className="watch-stage" ref={stageElement}><>{externalPage && !state.host ? <BroadcastView stream={broadcast.stream} broadcasting={Boolean(state.broadcast)} volume={volume} /> : <MediaPlayer key={state.url} url={state.url} host={state.host} frame={state.frame ?? { x: 0, y: 0, zoom: 1, locked: false }} saveFrame={async frame => { if (!ticket) throw new Error('Room closed'); version.current++; controlBusy.current = true; try { const result = await request('frame', { frame, url: state.url }, ticket); accept(result) } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save frame.'); throw e } finally { controlBusy.current = false } }} playback={video} onReady={() => { if (video.current) video.current.volume = volume; setDuration(video.current?.duration ?? 0); sync() }} onTime={() => { if (!dragging.current) setTime(video.current?.currentTime ?? 0); setDuration(video.current?.duration ?? 0); if (video.current && !video.current.paused) setNeedsPlay(false) }} onEnded={() => { if (state.host) void control(false) }} onError={setError} onBlocked={() => setNeedsPlay(true)} />}</>
    {flash && <div className="watch-message-flash" key={flash.id} style={{ '--member-color': flash.color ?? '#ffffff' } as CSSProperties} aria-hidden="true"><small>{flash.name}</small><span>{flash.text.length > 200 ? flash.text.slice(0, 200) + '…' : flash.text}</span></div>}
    <div className="watch-hearts" aria-hidden="true">{hearts.map(reaction => <span className="watch-heart-burst" key={reaction.id} style={{ '--heart-color': reaction.color } as CSSProperties} onAnimationEnd={event => { if (event.target === event.currentTarget) setHearts(previous => previous.filter(l => l.id !== reaction.id)) }}>{Array.from({length: 7}, (_, i) => <i key={i} style={{ '--heart-x': `${(i - 3) * 22}px`, '--heart-tilt': `${(i - 3) * 10}deg`, animationDelay: `${i * 55}ms` } as CSSProperties}>♥</i>)}</span>)}</div>
    {(!externalPage || !state.host) && <button className="watch-player-shield" type="button" tabIndex={0} aria-label={t('Double-tap the video to send hearts')} onPointerUp={event => {
      if (!state.host || event.pointerType !== 'touch') return
      const now = performance.now()
      if (lastTouch.current && now - lastTouch.current < 320) { suppressClickUntil.current = now + 500; lastTouch.current = 0; void like() }
      else lastTouch.current = now
    }} onDoubleClick={() => { if (state.host && performance.now() >= suppressClickUntil.current) void like() }} onClick={event => {
      if (performance.now() < suppressClickUntil.current) return
      if (event.detail > 1) { window.clearTimeout(clickTimer.current); return }
      if (fullscreen && state.host && connected) {
        window.clearTimeout(clickTimer.current)
        clickTimer.current = window.setTimeout(() => { if (!externalPage && !state.playing) void video.current?.play().catch(() => setNeedsPlay(true)); void control(!state.playing) }, 320)
      }
    }} />}
    {fullscreen && <button className="watch-exit-fullscreen modal-btn" onClick={() => void document.exitFullscreen()}>{t("Exit fullscreen")}</button>}

    </div>
    </div><div className="watch-controls">{state.host && <button className="modal-btn primary" title={externalPage ? t(state.frame.locked ? "Play shares only the locked player area; Pause stops sharing." : "Lock the frame before pressing Play.") : undefined} disabled={!connected || broadcast.starting || (externalPage && !state.frame.locked)} onClick={() => { if (!externalPage && !state.playing) void video.current?.play().catch(() => setNeedsPlay(true)); void control(!state.playing) }}>{t(state.playing ? 'Pause' : 'Play')}</button>}{needsPlay && <button className="modal-btn" onClick={() => { void video.current?.play().then(() => { setNeedsPlay(false); sync() }).catch(() => setError('Playback was blocked. Check the video link.')) }}>{t("Enable playback")}</button>}<input aria-label={t("Playback position")} type="range" min={0} max={Number.isFinite(duration) ? duration : 0} step={0.1} value={time} disabled={externalPage || !state.host || !connected} onChange={e => { const value = Number(e.target.value); setTime(value); if (video.current) video.current.currentTime = value }} onPointerDown={() => { dragging.current = true }} onPointerUp={() => { dragging.current = false; void control(state.playing) }} onPointerCancel={() => { dragging.current = false }} onKeyDown={() => { dragging.current = true }} onKeyUp={() => { dragging.current = false; void control(state.playing) }} /><label>{t("Volume")}<input aria-label={t("Volume")} disabled={externalPage && state.host} type="range" min={0} max={1} step={0.05} value={volume} onChange={e => { const next = Number(e.target.value); setVolume(next); if (video.current) video.current.volume = next }} /></label><button className="modal-btn ghost" onClick={() => void stageElement.current?.requestFullscreen().catch(() => setNotice('Fullscreen is unavailable in this browser.'))}>⛶</button></div>
    {externalPage && <p className="watch-external-note">{t(state.host ? "Align the website, lock the frame, then press Play. Select this robaqAI tab and enable tab audio. Only the player area is sent to guests. Pause stops sharing." : "You are watching the host’s player. Only the host controls the website.")} <a href={state.url} target="_blank" rel="noopener noreferrer">{t('Open website')}</a></p>}
    <VoiceReactions volume={volume} voices={state.voices ?? []} memberId={state.memberId} disabled={state.muted || !connected} send={async value => { if (ticket) await request('voice', value, ticket) }} load={async id => request('voice-get', { id }, ticket!)} />
    <aside className="watch-chat watch-chat-compact"><div className="watch-compose-row"><form className="watch-composer" onSubmit={e => { e.preventDefault(); void send() }}><input aria-label={t("Message")} maxLength={1000} placeholder={t("Write a message…")} value={message} onChange={e => setMessage(e.target.value)} /><button aria-label={t("Send message")} disabled={!connected || !message.trim()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button></form><div className="watch-compose-actions">{state.host && <button className="modal-btn ghost watch-history-toggle" aria-expanded={changeVideo} onClick={() => setChangeVideo(!changeVideo)}>{t("Change video")}</button>}<button className="modal-btn ghost watch-history-toggle" aria-expanded={chat} aria-controls="moviesync-history" onClick={() => { if (!chat && state.host && broadcast.sharing) void broadcast.stop(); setChat(!chat) }}>{t("Chat history")}{state.messages.length > 0 && <span>{state.messages.length}</span>}</button></div></div>
    {state.host && changeVideo && <form onSubmit={e => { e.preventDefault(); void control(false, 0, url) }} className="watch-change"><input type="url" required value={url} onChange={e => setUrl(e.target.value)} aria-label={t("New video URL")} /><button className="modal-btn">{t("Load video")}</button></form>}
    {chat && <section className="watch-history-panel" id="moviesync-history" role="dialog" aria-modal="true" aria-label={t("Chat history")} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setChat(false) }
      if (event.key === 'Tab') {
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input'))
        const first = elements[0], last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}><header><strong>{t("Chat history")}</strong><button className="modal-btn ghost" autoFocus onClick={() => setChat(false)} aria-label={t("Close chat history")}>×</button></header><div className="watch-messages" aria-live="polite">{state.messages.length === 0 && <p>{t("No messages yet.")}</p>}{state.messages.map(m => <p className={`watch-bubble${m.memberId === state.memberId ? ' own' : ''}`} key={m.id} style={{ '--member-color': m.color ?? '#c4c4c4' } as CSSProperties}><strong>{m.name}</strong><span>{m.text}</span></p>)}<div ref={messagesEnd} /></div><form className="watch-composer" onSubmit={e => { e.preventDefault(); void send() }}><input aria-label={t("Message")} maxLength={1000} placeholder={t("Write a message…")} value={message} onChange={e => setMessage(e.target.value)} /><button aria-label={t("Send message")} disabled={!connected || !message.trim()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button></form></section>}</aside>

    <div className="watch-like-total"><button type="button" className="modal-btn ghost" onClick={() => void like()} disabled={!connected} aria-label={t('Send a heart')}>♥</button><span>{state.likeCount ?? 0} {t('session likes')}</span><small>{t('Double-tap the video to send hearts')}</small></div>
    </div></div></>}
    <details className="watch-corner-info"><summary aria-label={t('Room information')}>?</summary><div className="watch-info-content"><p>{t('YouTube, Vimeo and direct MP4/WebM links support synchronized playback. Other HTTPS websites open in the host’s player; some websites block embedding or capture.')}</p><p>{t('Align the website, lock the frame, then press Play. Select this robaqAI tab and enable tab audio. Only the player area is sent to guests. Pause stops sharing.')}</p><p>{t('Player-only sharing requires desktop Chrome or Edge as host and browser permission. Guests receive the cropped stream. Protected videos may not permit capture.')}</p><p>{t('Choose a password of at least 6 characters. Copy the invite link beside End room and send the password separately. Chat and 10-second voice reactions remain available while waiting.')}</p>{notice && <p role="status">{t(notice)}</p>}</div></details>
    {error && <p className="modal-error" role="alert">{t(error)}</p>}
  </section></div>
}
