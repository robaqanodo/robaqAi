import {useEffect, useRef, useState} from 'react'
import {QrMark} from '../tesla/QrMark'
import {restoreQueue, shareUrl, youtubeId} from './queue'
import {youtubeSDK, type Player} from './youtube'
import './music.css'

export function MusicPlayer({phone = false, account = false, onClose}: {phone?: boolean; account?: boolean; onClose?: () => void}) {
  const [queue, setQueue] = useState(() => phone ? restoreQueue(new URLSearchParams(location.search).has('ids') ? location.search : '?ids=') : {ids: [] as string[], index: 0, volume: 70})
  const [shareToken, setShareToken] = useState(''), [synced, setSynced] = useState(false)
  const publicToken = phone ? new URLSearchParams(location.search).get('queue') : null
  const [input, setInput] = useState(''), [error, setError] = useState('')
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(false)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [qr, setQr] = useState(false), [copyState, setCopyState] = useState('')
  const mount = useRef<HTMLDivElement>(null), player = useRef<Player | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const current = useRef(queue); current.current = queue
  const loadedId = useRef<string | undefined>(undefined)
  const selected = queue.ids[queue.index]
  useEffect(() => {
    let cancelled = false
    // Guest queues never persist on this device.
    if (!account) { try { localStorage.removeItem('robaq-music') } catch { /* Restricted storage. */ } }
    if (account || publicToken) {
      void fetch('/api/account', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(publicToken ? {action: 'music-public', token: publicToken} : {action: 'music'})})
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data.music })
        .then(music => { if (!cancelled) { const ids = Array.isArray(music.ids) ? music.ids.filter((id: unknown) => typeof id === 'string' && /^[\w-]{11}$/.test(id)) : []; setQueue({ids, index: Math.max(0, Math.min(ids.length - 1, music.index || 0)), volume: music.volume ?? 70}); setShareToken(music.token); setSynced(true) } })
        .catch(reason => { if (!cancelled) setError(reason.message || 'Saved queue unavailable.') })
    } else setSynced(true)
    return () => { cancelled = true }
  }, [account, publicToken])
  const saveChain = useRef(Promise.resolve())
  useEffect(() => {
    if (!account || !synced) return
    try { localStorage.setItem('robaq-music', JSON.stringify(queue)) } catch { /* Server remains authoritative. */ }
    saveChain.current = saveChain.current.catch(() => {}).then(async () => {
      const response = await fetch('/api/account', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'music-save', ...queue}), keepalive: true})
      if (!response.ok) throw new Error('save failed')
    }).catch(() => {setError('Queue could not be saved. Change the queue or reopen Music to retry.')})
  }, [queue, account, synced])
  useEffect(() => {
    let disposed = false
    const target = document.createElement('div'); mount.current!.append(target)
    void youtubeSDK().then(sdk => {
      if (disposed) return
      const instance = new sdk.Player(target, {
        width: '100%', height: '100%', playerVars: {playsinline: 1, autoplay: 0, origin: location.origin},
        events: {
          onReady: () => { if (disposed) return; player.current = instance; instance.setVolume(current.current.volume); setReady(true) },
          onStateChange: ({data}: {data: number}) => {
            if (disposed) return
            setPlaying(data === 1)
            const video = instance.getVideoData()
            if (video.video_id && video.title) setTitles(old => ({...old, [video.video_id!]: video.title!}))
            if (data === 0) {
              const q = current.current
              if (q.index + 1 < q.ids.length) {
                const next = {...q, index: q.index + 1}; current.current = next; setQueue(next)
                loadedId.current = next.ids[next.index]; instance.loadVideoById(next.ids[next.index])
              }
            }
          },
          onAutoplayBlocked: () => { if (!disposed) { setPlaying(false); setError('Press Play in the YouTube preview to allow playback.') } },
          onError: () => { if (!disposed) { setPlaying(false); setError('This video cannot play here. Try the next track or another video.') } },
        },
      })
      player.current = instance
    }).catch(reason => { if (!disposed) setError(String(reason.message)) })
    return () => { disposed = true; player.current?.destroy(); player.current = null; target.remove() }
  }, [])
  // Cue only when the actual ID changes. User actions load synchronously to retain the gesture.
  useEffect(() => {
    if (!ready || !player.current) return
    if (selected) {
      if (loadedId.current !== selected) { loadedId.current = selected; player.current.cueVideoById(selected) }
    } else { loadedId.current = undefined; player.current.stopVideo(); setPlaying(false) }
  }, [selected, ready])
  useEffect(() => { if (ready) player.current?.setVolume(queue.volume) }, [queue.volume, ready])
  useEffect(() => { if (qr) dialog.current?.showModal() }, [qr])
  function choose(index: number) {
    if (!ready || index < 0 || index >= queue.ids.length) return
    const next = {...queue, index}; current.current = next; setQueue(next); setError('')
    loadedId.current = next.ids[index]; player.current?.loadVideoById(next.ids[index])
  }
  function remove(index: number) {
    const ids = queue.ids.filter((_, i) => i !== index)
    const nextIndex = Math.max(0, Math.min(ids.length - 1, queue.index - (index < queue.index ? 1 : 0)))
    if (index === queue.index) { loadedId.current = undefined; player.current?.stopVideo(); setPlaying(false) }
    const next = {...queue, ids, index: nextIndex}; current.current = next; setQueue(next)
  }
  const fullUrl = shareToken ? `https://robaq.app/play?queue=${shareToken}` : shareUrl(queue.ids)
  return <section className={`music-panel${phone ? ' music-phone' : ''}`} aria-label="Music">
    <header><h2>Music</h2>{onClose && <button aria-label="Close Music" onClick={onClose}>×</button>}</header>
    {phone && <p>Connect this phone to the car with Bluetooth, then press play.</p>}
    <form onSubmit={event => { event.preventDefault(); if (!synced) return; const id = youtubeId(input); if (!id) { setError('Invalid YouTube link or ID'); return }; setQueue(q => ({...q, ids: [...q.ids, id]})); setInput(''); setError('') }}>
      <input aria-label="YouTube link or video ID" placeholder="YouTube link or video ID" value={input} onChange={e => setInput(e.target.value)} />
      <button type="submit" disabled={!synced}>Add</button>
    </form>
    {error && <p className="music-error" role="alert">{error}</p>}
    <div className="music-preview" ref={mount} />
    <p className="music-now" aria-live="polite">Now playing: {selected ? titles[selected] || selected : 'Queue is empty'}</p>
    <div className="music-transport">
      <button aria-label="Previous track" disabled={!ready || queue.index === 0} onClick={() => choose(queue.index - 1)}>⏮</button>
      <button aria-label={playing ? 'Pause' : 'Play'} disabled={!ready || !selected} onClick={() => { setError(''); if (playing) player.current?.pauseVideo(); else player.current?.playVideo() }}>{playing ? 'Ⅱ' : '▶'}</button>
      <button aria-label="Next track" disabled={!ready || queue.index >= queue.ids.length - 1} onClick={() => choose(queue.index + 1)}>⏭</button>
    </div>
    <label className="music-volume">Volume<input type="range" min="0" max="100" value={queue.volume} onChange={e => setQueue(q => ({...q, volume: Number(e.target.value)}))} /></label>
    <ol className="music-queue">{queue.ids.map((id, i) => <li key={`${i}-${id}`} className={i === queue.index ? 'is-current' : ''}>
      <button className="music-track" disabled={!ready} aria-current={i === queue.index ? 'true' : undefined} onClick={() => choose(i)}><img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" /><span>{titles[id] || id}</span></button>
      <button aria-label={`Remove ${titles[id] || id}`} onClick={() => remove(i)}>×</button>
    </li>)}</ol>
    <button disabled={!synced || !queue.ids.length} onClick={() => {setQr(true); setCopyState('')}}>QR</button>
    {qr && <dialog className="music-share" ref={dialog} onCancel={() => setQr(false)} onClose={() => setQr(false)}>
      <header><h2>Open on your phone</h2><button aria-label="Close QR" onClick={() => setQr(false)}>×</button></header>
      <QrMark value={shareToken ? fullUrl : shareUrl(queue.ids.slice(0, 40))} label="Scan to open this queue" />
      {!shareToken && queue.ids.length > 40 && <p>QR truncated to the first 40 tracks. Copy link includes the entire queue.</p>}
      <p>{shareToken ? 'Permanent link: anyone with this QR can open your saved queue.' : 'Guest queue: cleared on close. A copied link contains a snapshot of these IDs.'}</p>
      <label>Share URL<textarea readOnly value={fullUrl} onFocus={e => e.target.select()} /></label>
      <button onClick={() => { void navigator.clipboard.writeText(fullUrl).then(() => setCopyState('Link copied.')).catch(() => setCopyState('Select the URL above and copy it manually.')) }}>Copy link</button>
      <p role="status">{copyState}</p>
    </dialog>}
  </section>
}
export function PlayPage() { return <main className="music-page"><MusicPlayer phone /></main> }
