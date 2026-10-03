export type Charger = {id: number; name: string; lat: number; lon: number}

/** Public community list. No key. Coordinates come only from this feed. */
export const SUPERCHARGE_URL = 'https://supercharge.info/service/supercharge/allSites'

const LIVE = new Set(['OPEN', 'EXPANDING', 'CLOSED_TEMP'])

let cached: Charger[] | null = null
let pending: Promise<Charger[]> | null = null

function parseSites(data: unknown): Charger[] {
  if (!Array.isArray(data)) return []
  const sites: Charger[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const site = row as {id?: unknown; name?: unknown; status?: unknown; gps?: {latitude?: unknown; longitude?: unknown}}
    if (typeof site.status !== 'string' || !LIVE.has(site.status)) continue
    const lat = Number(site.gps?.latitude)
    const lon = Number(site.gps?.longitude)
    const name = typeof site.name === 'string' ? site.name.trim() : ''
    const id = Number(site.id)
    if (!name || !Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    sites.push({id, name, lat, lon})
  }
  return sites
}

/** One download per session. A failed fetch can be tried again. */
export function loadChargers(): Promise<Charger[]> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = fetch(SUPERCHARGE_URL)
      .then(response => response.ok ? response.json() as Promise<unknown> : Promise.reject(new Error('chargers')))
      .then(data => {
        cached = parseSites(data)
        return cached
      })
      .catch(error => {
        pending = null
        throw error
      })
  }
  return pending
}
