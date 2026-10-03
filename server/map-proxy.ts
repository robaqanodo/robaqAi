import type { IncomingMessage, ServerResponse } from 'node:http'
import { respond, type ApiRequest } from './redis.ts'

const USER_AGENT = 'robaqAI/1.0 (https://robaq.app; saved Home and Work address search)'
const LANGS = new Set(['en', 'ka', 'ru'])

let geocodeSlot = 0
let geocodeChain: Promise<void> = Promise.resolve()

/** Nominatim allows about one request per second for the whole app. */
function paceGeocode(): Promise<void> {
  const run = geocodeChain.then(async () => {
    const wait = Math.max(0, geocodeSlot - Date.now())
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    geocodeSlot = Date.now() + 1100
  })
  geocodeChain = run.then(() => {}, () => {})
  return run
}

function requestUrl(req: ApiRequest): URL {
  const url = new URL(req.url || '/', 'http://localhost')
  const query = req.query
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (url.searchParams.has(key)) continue
      if (typeof value === 'string') url.searchParams.set(key, value)
      else if (Array.isArray(value) && typeof value[0] === 'string') url.searchParams.set(key, value[0])
    }
  }
  return url
}

function pair(value: string | null): [number, number] | null {
  if (!value) return null
  const [lonText, latText] = value.split(',')
  const lon = Number(lonText)
  const lat = Number(latText)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null
  return [lon, lat]
}

export async function handleGeocode(req: ApiRequest, res: ServerResponse) {
  if (req.method !== 'GET') { respond(res, 405, { error: 'GET only' }); return }
  const q = requestUrl(req).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) { respond(res, 200, []); return }
  if (q.length > 200) { respond(res, 400, { error: 'Query is too long.' }); return }
  const lang = requestUrl(req).searchParams.get('lang') ?? 'en'
  const accept = LANGS.has(lang) ? lang : 'en'
  await paceGeocode()
  const target = new URL('https://nominatim.openstreetmap.org/search')
  target.searchParams.set('q', q.slice(0, 200))
  target.searchParams.set('format', 'jsonv2')
  target.searchParams.set('limit', '6')
  target.searchParams.set('addressdetails', '0')
  target.searchParams.set('accept-language', accept)
  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!upstream.ok) { respond(res, 502, { error: 'Address search is unavailable.' }); return }
    const rows = await upstream.json() as { display_name?: string; lat?: string; lon?: string }[]
    if (!Array.isArray(rows)) { respond(res, 200, []); return }
    const hits = []
    for (const row of rows) {
      const lat = Number(row.lat)
      const lon = Number(row.lon)
      const label = typeof row.display_name === 'string' ? row.display_name.trim() : ''
      if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
      hits.push({ label, lat, lon })
    }
    respond(res, 200, hits)
  } catch {
    respond(res, 502, { error: 'Address search is unavailable.' })
  }
}

export async function handleRoute(req: ApiRequest, res: ServerResponse) {
  if (req.method !== 'GET') { respond(res, 405, { error: 'GET only' }); return }
  const url = requestUrl(req)
  const from = pair(url.searchParams.get('from'))
  const to = pair(url.searchParams.get('to'))
  if (!from || !to) { respond(res, 400, { error: 'from and to must be lon,lat' }); return }
  const target = `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`
  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!upstream.ok) { respond(res, 502, { error: 'Route unavailable' }); return }
    const body = await upstream.json() as { code?: string; routes?: { geometry?: { type?: string; coordinates?: [number, number][] } }[] }
    const geometry = body.routes?.[0]?.geometry
    if (body.code !== 'Ok' || geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      respond(res, 404, { error: 'Route unavailable' })
      return
    }
    respond(res, 200, { geometry: { type: 'LineString', coordinates: geometry.coordinates } })
  } catch {
    respond(res, 502, { error: 'Route unavailable' })
  }
}

export function mapProxyMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = (req.url || '').split('?')[0]
  if (path === '/api/geocode') { void handleGeocode(req, res); return }
  if (path === '/api/route') { void handleRoute(req, res); return }
  next()
}
