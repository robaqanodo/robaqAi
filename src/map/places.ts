export type PlaceId = 'home' | 'work'
export type SavedPlace = { lat: number; lon: number; label: string }
export type Places = Record<PlaceId, SavedPlace | null>

const KEY = 'robaq-map-places'

function place(value: unknown): SavedPlace | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { lat?: unknown; lon?: unknown; label?: unknown }
  const lat = Number(row.lat)
  const lon = Number(row.lon)
  const label = typeof row.label === 'string' ? row.label.trim().slice(0, 300) : ''
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon, label }
}

export function loadPlaces(): Places {
  try {
    const raw = localStorage.getItem(KEY)
    const data = raw ? JSON.parse(raw) as { home?: unknown; work?: unknown } : {}
    return { home: place(data.home), work: place(data.work) }
  } catch {
    return { home: null, work: null }
  }
}

export function savePlace(id: PlaceId, saved: SavedPlace): Places {
  const next = { ...loadPlaces(), [id]: saved }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* The choice still applies for this view. */ }
  return next
}
