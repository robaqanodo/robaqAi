import { WebsitePlayer, type WebsiteFrame } from './WebsitePlayer'
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { watchMedia } from './media'
export type Playback = { currentTime: number; duration: number; volume: number; readyState: number; paused: boolean; ended: boolean; play: () => Promise<void>; pause: () => void }
type YTPlayer = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number; seekTo(time: number, ahead: boolean): void; setVolume(volume: number): void; playVideo(): void; pauseVideo(): void; destroy(): void }
type VimeoPlayer = { ready(): Promise<void>; getCurrentTime(): Promise<number>; getDuration(): Promise<number>; getPaused(): Promise<boolean>; setCurrentTime(time: number): Promise<number>; setVolume(volume: number): Promise<number>; play(): Promise<void>; pause(): Promise<void>; destroy(): Promise<void>; on(event: string, fn: () => void): void }
type SDKWindow = Window & { YT?: { Player: new (element: HTMLElement, options: object) => YTPlayer }; Vimeo?: { Player: new (element: HTMLElement, options: object) => VimeoPlayer } }
const scripts = new Map<string, Promise<void>>()
function sdk(url: string, ready: () => boolean) {
  if (ready()) return Promise.resolve()
  if (scripts.has(url)) return scripts.get(url)!
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = url; script.async = true
    const start = Date.now()
    const timer = setInterval(() => { if (ready()) { clearInterval(timer); resolve() } else if (Date.now() - start > 15000) { clearInterval(timer); script.remove(); reject(new Error('Video service did not load. Check your connection and retry.')) } }, 100)
    script.onerror = () => { clearInterval(timer); script.remove(); reject(new Error('Video service could not be reached.')) }
    document.head.append(script)
  }).catch(error => { scripts.delete(url); throw error })
  scripts.set(url, promise); return promise
}
export function MediaPlayer({ url, host, frame, saveFrame, playback, onReady, onTime, onEnded, onError, onBlocked }: { url: string; host: boolean; frame: WebsiteFrame; saveFrame: (frame: WebsiteFrame) => Promise<void>; playback: RefObject<Playback | null>; onReady: () => void; onTime: () => void; onEnded: () => void; onError: (message: string) => void; onBlocked: () => void }) {
  const mount = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onReady, onTime, onEnded, onError, onBlocked }); callbacks.current = { onReady, onTime, onEnded, onError, onBlocked }
  const media = watchMedia(url)
  useEffect(() => {
    if (media.kind === 'file' || media.kind === 'external') { playback.current = null; return }
    let cancelled = false; let dispose = () => {}; let timer: ReturnType<typeof setInterval> | undefined
    const container = document.createElement('div'); mount.current!.append(container)
    const fail = (message: string) => { if (!cancelled) callbacks.current.onError(message) }
    void (async () => {
      const win = window as SDKWindow
      if (media.kind === 'youtube') {
        await sdk('https://www.youtube.com/iframe_api', () => Boolean(win.YT?.Player))
        if (cancelled) return
        const player = new win.YT!.Player(container, { width: '100%', height: '100%', videoId: media.id, playerVars: { controls: 0, disablekb: 1, playsinline: 1, origin: location.origin, rel: 0 }, events: {
          onReady: () => {
            if (cancelled) return
            playback.current = { get currentTime() { return player.getCurrentTime() }, set currentTime(value) { player.seekTo(value, true) }, get duration() { return player.getDuration() }, volume: 1, readyState: 1, get paused() { return player.getPlayerState() !== 1 }, get ended() { return player.getPlayerState() === 0 }, play: async () => { player.playVideo() }, pause: () => player.pauseVideo() }
            Object.defineProperty(playback.current, 'volume', { set: (value: number) => player.setVolume(value * 100) })
            callbacks.current.onReady()
          },
          onStateChange: (event: { data: number }) => { if (!cancelled && event.data === 0) callbacks.current.onEnded() },
          onAutoplayBlocked: () => { if (!cancelled) callbacks.current.onBlocked() },
          onError: () => fail('YouTube cannot play this video here. It may be private, restricted, or have embedding disabled. Choose another video.')
        } })
        dispose = () => player.destroy()
        timer = setInterval(() => { if (playback.current) callbacks.current.onTime() }, 300)
      } else {
        await sdk('https://player.vimeo.com/api/player.js', () => Boolean(win.Vimeo?.Player))
        if (cancelled) return
        const player = new win.Vimeo!.Player(container, { url: media.url, controls: false, playsinline: true })
        dispose = () => { void player.destroy().catch(() => {}) }
        await player.ready(); if (cancelled) { dispose(); return }
        let time = 0, paused = true, duration = await player.getDuration(), volume = 1
        if (cancelled) return
        playback.current = { get currentTime() { return time }, set currentTime(value) { time = value; void player.setCurrentTime(value).catch(() => fail('Unable to seek this video.')) }, get duration() { return duration }, get volume() { return volume }, set volume(value) { volume = value; void player.setVolume(value).catch(() => {}) }, readyState: 1, get paused() { return paused }, get ended() { return time >= duration && duration > 0 }, play: () => player.play(), pause: () => { void player.pause().catch(() => {}) } }
        player.on('ended', () => { if (!cancelled) callbacks.current.onEnded() }); player.on('error', () => fail('Vimeo cannot play this video here. Check its privacy and embedding permissions.'))
        callbacks.current.onReady()
        let reading = false
        timer = setInterval(() => { if (reading) return; reading = true; void Promise.all([player.getCurrentTime(), player.getPaused(), player.getDuration()]).then(([t, p, d]) => { if (!cancelled) { time = t; paused = p; duration = d; callbacks.current.onTime() } }).catch(() => {}).finally(() => { reading = false }) }, 300)
      }
    })().catch(error => fail(error instanceof Error ? error.message : 'Video could not load.'))
    return () => { cancelled = true; clearInterval(timer); playback.current = null; dispose(); container.remove() }
  }, [url])
  if (media.kind === 'external') return <WebsitePlayer key={media.url} url={media.url} name={media.id} host={host} frame={frame} save={saveFrame} />
  return media.kind === 'file' ? <video tabIndex={-1} ref={element => { playback.current = element }} src={url} playsInline preload="metadata" onLoadedMetadata={onReady} onTimeUpdate={onTime} onEnded={onEnded} onError={() => onError('This video could not be loaded. Check the link and codec.')} /> : <div className="watch-embed" ref={mount} inert />
}
