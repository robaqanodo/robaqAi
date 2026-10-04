export type Player = {
  cueVideoById(id: string): void; loadVideoById(id: string): void
  playVideo(): void; pauseVideo(): void; stopVideo(): void; destroy(): void
  setVolume(value: number): void
  getVideoData(): { title?: string; video_id?: string }
}
type SDK = { Player: new (element: HTMLElement, options: object) => Player }
let loading: Promise<SDK> | undefined
export function youtubeSDK(): Promise<SDK> {
  const win = window as Window & { YT?: SDK }
  if (win.YT?.Player) return Promise.resolve(win.YT)
  if (loading) return loading
  loading = new Promise<SDK>((resolve, reject) => {
    const url = 'https://www.youtube.com/iframe_api'
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`)
    const script = existing || document.createElement('script')
    let elapsed = 0
    const timer = window.setInterval(() => {
      if (win.YT?.Player) { clearInterval(timer); resolve(win.YT) }
      else if ((elapsed += 100) >= 15000) { clearInterval(timer); if (!existing) script.remove(); reject(new Error('YouTube could not load. Check your connection and reopen Music.')) }
    }, 100)
    if (!existing) { script.src = url; script.async = true; document.head.append(script) }
  }).catch(error => { loading = undefined; throw error })
  return loading
}
