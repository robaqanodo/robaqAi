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
  target.searchParams.set('addressdetails', '1')
  target.searchParams.set('accept-language', accept)
  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!upstream.ok) { respond(res, 502, { error: 'Address search is unavailable.' }); return }
    const rows = await upstream.json() as {
      name?: string
      display_name?: string
      lat?: string
      lon?: string
      address?: Record<string, string>
    }[]
    if (!Array.isArray(rows)) { respond(res, 200, []); return }
    const hits = []
    for (const row of rows) {
      const lat = Number(row.lat)
      const lon = Number(row.lon)
      const display = typeof row.display_name === 'string' ? row.display_name.trim() : ''
      const named = typeof row.name === 'string' ? row.name.trim() : ''
      const name = named || display.split(',')[0]?.trim() || ''
      let address = ''
      if (name && display.toLowerCase().startsWith(name.toLowerCase())) address = display.slice(name.length).replace(/^[\s,]+/, '')
      else if (row.address && typeof row.address === 'object') {
        const place = row.address
        const locality = place.city || place.town || place.village || place.hamlet || place.municipality || ''
        const road = place.house_number && place.road ? `${place.house_number} ${place.road}` : (place.road || '')
        address = [road, place.suburb, locality, place.state, place.country].filter(part => typeof part === 'string' && part.trim()).join(', ')
      }
      if (!address) address = display
      if (name && address.toLowerCase().startsWith(name.toLowerCase())) address = address.slice(name.length).replace(/^[\s,]+/, '')
      const label = display || [name, address].filter(Boolean).join(', ')
      if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
      hits.push({ name: name || label, address, label, lat, lon })
    }
    respond(res, 200, hits)
  } catch {
    respond(res, 502, { error: 'Address search is unavailable.' })
  }
}

type OsrmStep = { distance?: number; name?: string; maneuver?: { type?: string; modifier?: string } }
type RouteBody = {
  code?: string
  routes?: {
    distance?: number
    duration?: number
    geometry?: { type?: string; coordinates?: [number, number][] }
    legs?: { steps?: OsrmStep[] }[]
  }[]
}
type StepOut = { maneuver: string; modifier: string; name: string; distance: number }
type DrivingLine = {
  coordinates: [number, number][]
  distance?: number
  duration?: number
  steps?: StepOut[]
}

function stepsFrom(route: NonNullable<RouteBody['routes']>[number]): StepOut[] {
  const out: StepOut[] = []
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const distance = Number(step.distance)
      if (!Number.isFinite(distance) || distance < 0) continue
      out.push({
        maneuver: typeof step.maneuver?.type === 'string' ? step.maneuver.type : 'continue',
        modifier: typeof step.maneuver?.modifier === 'string' ? step.maneuver.modifier : '',
        name: typeof step.name === 'string' ? step.name : '',
        distance,
      })
      if (out.length >= 64) return out
    }
  }
  return out
}

/** Project OSRM first. If it fails or has no LineString, the public OSM.de car router. */
async function drivingLine(from: [number, number], to: [number, number]): Promise<DrivingLine | null> {
  const path = `${from[0]},${from[1]};${to[0]},${to[1]}`
  const query = 'overview=full&geometries=geojson&steps=true'
  const targets = [
    `https://router.project-osrm.org/route/v1/driving/${path}?${query}`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${path}?${query}`,
  ]
  for (const target of targets) {
    try {
      const upstream = await fetch(target, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      if (!upstream.ok) continue
      const body = await upstream.json() as RouteBody
      const route = body.routes?.[0]
      const geometry = route?.geometry
      const coordinates = geometry?.coordinates
      if (body.code === 'Ok' && geometry?.type === 'LineString' && Array.isArray(coordinates) && coordinates.length >= 2) {
        const distance = Number(route?.distance)
        const duration = Number(route?.duration)
        const steps = route ? stepsFrom(route) : []
        return {
          coordinates,
          ...(Number.isFinite(distance) && distance > 0 ? { distance } : {}),
          ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
          ...(steps.length ? { steps } : {}),
        }
      }
    } catch {
      /* try the next router */
    }
  }
  return null
}

export async function handleRoute(req: ApiRequest, res: ServerResponse) {
  if (req.method !== 'GET') { respond(res, 405, { error: 'GET only' }); return }
  const url = requestUrl(req)
  const from = pair(url.searchParams.get('from'))
  const to = pair(url.searchParams.get('to'))
  if (!from || !to) { respond(res, 400, { error: 'from and to must be lon,lat' }); return }
  const line = await drivingLine(from, to)
  if (!line) {
    respond(res, 200, { geometry: { type: 'LineString', coordinates: [from, to] } })
    return
  }
  respond(res, 200, {
    geometry: { type: 'LineString', coordinates: line.coordinates },
    ...(line.distance != null ? { distance: line.distance } : {}),
    ...(line.duration != null ? { duration: line.duration } : {}),
    ...(line.steps ? { steps: line.steps } : {}),
  })
}

export function mapProxyMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = (req.url || '').split('?')[0]
  if (path === '/api/geocode') { void handleGeocode(req, res); return }
  if (path === '/api/route') { void handleRoute(req, res); return }
  next()
}
