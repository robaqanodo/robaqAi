export const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{11}$/.test(id)
export function youtubeId(input: unknown): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (validId(raw)) return raw
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0]
      return validId(id) ? id : null
    }
    if (['youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(host)) {
      const v = url.searchParams.get('v')
      if (validId(v)) return v
      const parts = url.pathname.split('/').filter(Boolean)
      const i = parts.findIndex(p => ['shorts', 'embed', 'live', 'v'].includes(p))
      if (i >= 0 && validId(parts[i + 1])) return parts[i + 1]
    }
  } catch { /* Invalid URL. */ }
  return null
}
export type Queue = { ids: string[]; index: number; volume: number }
export const queryIds = (search: string) => (new URLSearchParams(search).get('ids') || '').split(',').filter(validId)
export const shareUrl = (ids: string[]) => `https://robaq.app/play?ids=${ids.filter(validId).join(',')}`
export function restoreQueue(search?: string): Queue {
  let saved: Partial<Queue> = {}
  try { saved = JSON.parse(localStorage.getItem('robaq-music') || '{}') || {} } catch { /* Fresh queue. */ }
  const ids = search !== undefined ? queryIds(search) : Array.isArray(saved.ids) ? saved.ids.filter(validId) : []
  const index = search !== undefined ? 0 : Math.max(0, Math.min(ids.length - 1, Number.isInteger(saved.index) ? saved.index! : 0))
  return { ids, index, volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.max(0, Math.min(100, saved.volume)) : 70 }
}
