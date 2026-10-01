export function watchMedia(value: string): { kind: 'file' | 'youtube' | 'vimeo' | 'external'; url: string; id: string } {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || value.length > 4000) throw new Error('Use a public HTTPS video link.')
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (['ge.movie', 'mykadri.tv', 'setantasports.com', 'app.setantasports.com', 'liveball.sx'].includes(host)) {
    url.pathname = url.pathname.replace(/\.$/, '')
    return { kind: 'external', url: url.href, id: host }
  }
  if (['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    const id = host === 'youtu.be' ? url.pathname.split('/')[1] : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new Error('Enter a YouTube video link, not a channel or playlist.')
    return { kind: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` }
  }
  if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
    const match = url.pathname.match(/^\/(?:video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?\/?$/)
    if (!match) throw new Error('Enter a Vimeo video link.')
    const hash = url.searchParams.get('h') || match[2]
    return { kind: 'vimeo', id: match[1], url: `https://vimeo.com/${match[1]}${hash ? `?h=${encodeURIComponent(hash)}` : ''}` }
  }
  if (/\.(mp4|webm)$/i.test(url.pathname)) return { kind: 'file', url: url.href, id: '' }
  throw new Error('Supported links: YouTube, Vimeo, or a direct HTTPS MP4/WebM file. Other website pages cannot be synchronized.')
}
