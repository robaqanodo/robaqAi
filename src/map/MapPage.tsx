import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react'
import {Map, Marker, Popup, setWorkerUrl, type GeoJSONSource} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import {useLocale} from '../i18n/Locale'
import {useTeslaLocation} from '../tesla/location'
import {EXTRA_IDS, clearSavedPlace, loadPlaces, saveExtra, savePlace, type ExtraId, type ExtraPlace, type PlaceId, type SavedPlace} from './places'
import {loadMarkerKind, markerMarkup, type MarkerKind} from './marker'
import {loadChargers, type Charger} from './chargers'
import {DARK_STYLE_URL, satelliteStyle} from './style'
import './map.css'

// Vite bundles maplibre-gl.mjs into the app chunk, so the default worker URL
// (./maplibre-gl-worker.mjs next to that chunk) 404s. GeoJSON then never tiles:
// raster imagery and HTML markers still show, the route line does not.
setWorkerUrl(maplibreWorkerUrl)

type Fix = {lat: number; lon: number; heading: number | null}
type Hit = {label: string; name: string; address: string; lat: number; lon: number}
type RouteFeature = {
  type: 'Feature'
  properties: Record<string, never>
  geometry: {type: 'LineString'; coordinates: [number, number][]}
}
type RouteData = RouteFeature | {type: 'FeatureCollection'; features: []}
type TripId = PlaceId | ExtraId | 'search'
type Trip = {id: TripId; place: SavedPlace}
type Arrival = {label: string; left: number}
type Maneuver = 'straight' | 'slight-left' | 'left' | 'slight-right' | 'right' | 'uturn' | 'arrive'
type GuideStep = {maneuver: Maneuver; name: string; distance: number}
type Guide = {distance: number; duration: number; steps: GuideStep[]}
type MapMemory = {
  selected: PlaceId
  trip: Trip | null
  query: string
  route: [number, number][] | null
  guide: Guide | null
  following: boolean
  driving: boolean
}

/** Survives map close. Logo tap keeps this. X confirm clears the trip, not saved places. */
const mapMemory: MapMemory = {
  selected: 'home',
  trip: null,
  query: '',
  route: null,
  guide: null,
  following: true,
  driving: false,
}

const DEFAULT_CENTER: [number, number] = [20, 20]
const DEFAULT_ZOOM = 1.6
/** First GPS fix only. maxZoom stays 19 so a pinch can go closer. Later ticks must not force this. */
const OPEN_ZOOM = 15
/** Slightly closer than the open view. Applied once when driving starts, not on later GPS ticks. */
const START_ZOOM = 16
const DRIVE_PITCH = 50
const EMPTY: RouteData = {type: 'FeatureCollection', features: []}
const ARRIVAL_M = 50
const SLOT_PATH = {
  home: 'M4.5 10.6 12 4.2l7.5 6.4V20a1 1 0 0 1-1 1h-4.2v-5.2H9.7V21H5.5a1 1 0 0 1-1-1v-9.4z',
  work: 'M9 4.5h6a1.5 1.5 0 0 1 1.5 1.5V7H19a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5V6A1.5 1.5 0 0 1 9 4.5zM9.5 7h5V6h-5v1z',
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  flag: 'M5 3.2h1.7V21H5V3.2zm2.4.9h12.3l-2.7 4.3 2.7 4.3H7.4V4.1z',
  star: 'M12 2.2 14.7 8.6 21.6 9.3 16.4 14l1.5 6.7L12 17.4 6.1 20.7 7.6 14 2.4 9.3 9.3 8.6 12 2.2z',
} as const

function SlotIcon({id}: {id: keyof typeof SLOT_PATH}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={SLOT_PATH[id]} /></svg>
  )
}

function savedMarkerEl(id: keyof typeof SLOT_PATH) {
  const el = document.createElement('div')
  el.className = 'owned-map-saved'
  el.style.pointerEvents = 'none'
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${SLOT_PATH[id]}"/></svg>`
  return el
}

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Compass bearing from the earlier fix to the later one. 0 is north, clockwise. Not swapped. */
function travelBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180
  const latA = lat1 * rad
  const latB = lat2 * rad
  const dLon = (lon2 - lon1) * rad
  const y = Math.sin(dLon) * Math.cos(latB)
  const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function compassDelta(a: number, b: number) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

type CourseAnchor = {lat: number; lon: number; heading: number | null}

const COURSE_MOVE_M = 12
const COURSE_FAST_M = 6
const COURSE_SPEED_MS = 2
const HEADING_AGREE_DEG = 45

/**
 * Direction of travel. Movement wins when the device heading is missing, 0 with no
 * agreement, or about 180° off. A reported heading is kept only when it agrees.
 * Stopped fixes keep the last good heading and do not add 180°.
 */
function resolveTravelFix(
  anchor: CourseAnchor | null,
  lat: number,
  lon: number,
  reported: number | null | undefined,
  speedMs: number | null | undefined,
): {fix: Fix; anchor: CourseAnchor} {
  const device = typeof reported === 'number' && Number.isFinite(reported) ? ((reported % 360) + 360) % 360 : null
  const speed = typeof speedMs === 'number' && Number.isFinite(speedMs) && speedMs >= 0 ? speedMs : null
  const moved = anchor ? metersBetween(anchor.lat, anchor.lon, lat, lon) : 0
  const fast = speed != null && speed >= COURSE_SPEED_MS
  const stuckSpeed = speed != null && speed < 0.4
  const farEnough = moved >= (fast ? COURSE_FAST_M : COURSE_MOVE_M)
  if (anchor && farEnough && !(stuckSpeed && moved < COURSE_MOVE_M)) {
    const course = travelBearing(anchor.lat, anchor.lon, lat, lon)
    const heading = device != null && compassDelta(device, course) <= HEADING_AGREE_DEG ? device : course
    return {fix: {lat, lon, heading}, anchor: {lat, lon, heading}}
  }
  const heading = anchor?.heading ?? null
  return {fix: {lat, lon, heading}, anchor: anchor ?? {lat, lon, heading}}
}

const ROUTE_BLUE = '#3E9BFF'

function hitsFrom(data: unknown): Hit[] {
  const rows = Array.isArray(data) ? data : []
  const next: Hit[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const hit = row as {label?: unknown; name?: unknown; address?: unknown; lat?: unknown; lon?: unknown}
    const lat = Number(hit.lat)
    const lon = Number(hit.lon)
    const label = typeof hit.label === 'string' ? hit.label.trim() : ''
    const name = typeof hit.name === 'string' && hit.name.trim() ? hit.name.trim() : (label.split(',')[0]?.trim() || label)
    const address = typeof hit.address === 'string' ? hit.address.trim() : ''
    if (!label || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    next.push({label, name, address, lat, lon})
  }
  return next
}

function lineData(coordinates: [number, number][]): RouteData {
  return {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}}
}

function pathMeters(coords: [number, number][]) {
  let meters = 0
  for (let i = 1; i < coords.length; i++) {
    meters += metersBetween(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
  }
  return meters
}

function maneuverOf(type: string, modifier: string): Maneuver {
  if (type === 'arrive') return 'arrive'
  if (modifier === 'uturn' || type === 'uturn') return 'uturn'
  if (modifier === 'slight left') return 'slight-left'
  if (modifier === 'slight right') return 'slight-right'
  if (modifier === 'left' || modifier === 'sharp left') return 'left'
  if (modifier === 'right' || modifier === 'sharp right') return 'right'
  return 'straight'
}

function guideFrom(body: {distance?: unknown; duration?: unknown; steps?: unknown}, coordinates: [number, number][]): Guide {
  const steps: GuideStep[] = []
  if (Array.isArray(body.steps)) {
    for (const row of body.steps) {
      if (!row || typeof row !== 'object') continue
      const step = row as {maneuver?: unknown; modifier?: unknown; name?: unknown; distance?: unknown}
      const distance = Number(step.distance)
      if (!Number.isFinite(distance) || distance < 0) continue
      steps.push({
        maneuver: maneuverOf(typeof step.maneuver === 'string' ? step.maneuver : '', typeof step.modifier === 'string' ? step.modifier : ''),
        name: typeof step.name === 'string' ? step.name : '',
        distance,
      })
    }
  }
  const distance = Number(body.distance)
  const duration = Number(body.duration)
  return {
    distance: Number.isFinite(distance) && distance > 0 ? distance : pathMeters(coordinates),
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    steps,
  }
}

function stepCursor(steps: GuideStep[], traveled: number) {
  let start = 0
  for (let i = 0; i < steps.length; i++) {
    const span = Math.max(0, steps[i].distance)
    const end = start + span
    if (traveled < end - 8 || i === steps.length - 1) {
      const into = Math.max(0, Math.min(span, traveled - start))
      return {index: i, remain: Math.max(0, span - into)}
    }
    start = end
  }
  return {index: 0, remain: steps[0]?.distance ?? 0}
}

function splitLabel(label: string) {
  const parts = label.split(',')
  const title = (parts[0] || label).trim()
  const rest = parts.slice(1).join(',').trim()
  return {title, rest}
}

function TurnArrow({kind}: {kind: Maneuver}) {
  if (kind === 'arrive') {
    return (
      <svg className="owned-map-turn" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2.4a6.2 6.2 0 0 0-6.2 6.2c0 4.7 6.2 12.6 6.2 12.6s6.2-7.9 6.2-12.6A6.2 6.2 0 0 0 12 2.4zm0 8.4a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4z"/>
      </svg>
    )
  }
  const d = kind === 'left'
    ? 'M16.5 20 V12.2 Q16.5 6.5 10.8 6.5 H5.2 M5.2 6.5 9.4 2.6 M5.2 6.5 9.4 10.4'
    : kind === 'right'
      ? 'M7.5 20 V12.2 Q7.5 6.5 13.2 6.5 H18.8 M18.8 6.5 14.6 2.6 M18.8 6.5 14.6 10.4'
      : kind === 'slight-left'
        ? 'M16 20.5 C15 14 12 10 5.2 6.2 M5.2 6.2 9.6 5.2 M5.2 6.2 6.8 10.4'
        : kind === 'slight-right'
          ? 'M8 20.5 C9 14 12 10 18.8 6.2 M18.8 6.2 14.4 5.2 M18.8 6.2 17.2 10.4'
          : kind === 'uturn'
            ? 'M8 20 V11.5 Q8 4.5 15 4.5 Q21 4.5 21 11 V16.2 M21 16.2 16.8 12.6 M21 16.2 21 16.2 M21 16.2 24.6 12.8'
            : 'M12 20.5 V5.2 M12 5.2 7.2 10 M12 5.2 16.8 10'
  return (
    <svg className="owned-map-turn" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

/** Keep the blue line attached to the car. Far off the polyline, keep the whole route. */
function sliceRoute(coords: [number, number][], lat: number, lon: number): [number, number][] {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < coords.length; i++) {
    const d = metersBetween(lat, lon, coords[i][1], coords[i][0])
    if (d < bestD) { bestD = d; best = i }
  }
  const here: [number, number] = [lon, lat]
  const rest = bestD > 800 ? coords : coords.slice(best)
  const tail = rest[rest.length - 1]
  if (!tail) return [here, [lon, lat]]
  const body = rest.filter(point => point[0] !== here[0] || point[1] !== here[1])
  return [here, ...(body.length ? body : [tail])]
}

function directLine(from: Fix, place: SavedPlace): [number, number][] {
  return [[from.lon, from.lat], [place.lon, place.lat]]
}

const MAP_BASEMAP_KEY = 'robaq-map-basemap'
type BasemapMode = 'satellite' | 'street'

/** Navigation starts in dark street mode, independently of the app theme. */
function bootBasemap(): BasemapMode { return 'street' }

function basemapStyle(mode: BasemapMode) {
  return mode === 'street' ? DARK_STYLE_URL : satelliteStyle
}

const CHARGER_NEAR = 4

function chargerBolt(): ImageData {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const pen = canvas.getContext('2d')
  if (!pen) return new ImageData(size, size)
  pen.clearRect(0, 0, size, size)
  pen.fillStyle = '#e82137'
  pen.strokeStyle = '#fff'
  pen.lineWidth = 4
  pen.beginPath()
  pen.arc(32, 32, 22, 0, Math.PI * 2)
  pen.fill()
  pen.stroke()
  pen.fillStyle = '#fff'
  pen.translate(8, 8)
  pen.scale(2, 2)
  pen.beginPath()
  pen.moveTo(13.2, 2.6)
  pen.lineTo(6.1, 13)
  pen.lineTo(11, 13)
  pen.lineTo(9.4, 21.4)
  pen.lineTo(18.2, 10.2)
  pen.lineTo(13.1, 10.2)
  pen.closePath()
  pen.fill()
  return pen.getImageData(0, 0, size, size)
}

function viewHolds(map: Map, lat: number, lon: number) {
  const bounds = map.getBounds()
  const south = bounds.getSouth()
  const north = bounds.getNorth()
  const west = bounds.getWest()
  const east = bounds.getEast()
  const latPad = Math.max(0.02, (north - south) * 0.2)
  if (lat < south - latPad || lat > north + latPad) return false
  const crosses = west > east
  const span = crosses ? (180 - west) + (east + 180) : east - west
  const lonPad = Math.max(0.02, span * 0.2)
  if (crosses) return lon >= west - lonPad || lon <= east + lonPad
  return lon >= west - lonPad && lon <= east + lonPad
}

/** Buildings and pitch controls are always enabled in navigation. */
function applyMap3d(map: Map) {
  for (const id of ['buildings-walls', 'buildings-roofs', 'building-3d']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
  }
  map.dragRotate.enable()
  map.touchPitch.enable()
  map.touchZoomRotate.enableRotation()
}

/** Positive Y shifts the target down so the GPS marker sits in the lower part of the screen. */
function behindOffset(_map: Map): [number, number] { return [0, 0] }

function cameraBearing(next: Fix): number | undefined {
  return next.heading != null && next.heading >= 0 ? next.heading : undefined
}

/** Centered follow. The marker stays at the camera center.
 *  The first frame sets zoom 16 and pitch 50. Later ticks update center and bearing only.
 *  Recenter restores the pitch without forcing zoom again. */
function easeBehind(map: Map, next: Fix, zoom: number | false, restorePitch = false) {
  const bearing = cameraBearing(next)
  if (zoom === false && !restorePitch) {
    map.jumpTo({center: [next.lon, next.lat], ...(bearing != null ? {bearing} : {})})
    return
  }
  map.easeTo({
    center: [next.lon, next.lat],
    offset: behindOffset(map),
    duration: zoom !== false || restorePitch ? 700 : 400,
    ...(bearing != null ? {bearing} : {}),
    ...(zoom !== false || restorePitch ? {pitch: DRIVE_PITCH} : {}),
    ...(zoom !== false ? {zoom} : {}),
  })
}

/** Left-button / one-finger pans. Pinch, rotate, and pitch must not stop follow. */
function isOneFingerPan(event: Event | undefined): boolean {
  if (!event) return false
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) return event.touches.length === 1
  if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    if (event.buttons !== 0 && event.buttons !== 1) return false
    return event.button === 0 || event.buttons === 1
  }
  return false
}

function fitRoute(map: Map, coordinates: [number, number][]) {
  if (coordinates.length < 2) return
  let west = coordinates[0][0]
  let east = west
  let south = coordinates[0][1]
  let north = south
  for (const [lon, lat] of coordinates) {
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  map.fitBounds([[west, south], [east, north]], {padding: 72, pitch: 0, duration: 800})
}

/** Add the GeoJSON source and Tesla-blue line even while raster tiles are still loading. */
function commitRoute(map: Map, data: RouteData): boolean {
  try {
    let created = false
    if (!map.getSource('route')) {
      map.addSource('route', {type: 'geojson', data})
      created = true
    }
    if (!map.getLayer('route-casing')) {
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': '#0A3F9E', 'line-width': 10, 'line-opacity': 0.95},
      })
      created = true
    }
    if (!map.getLayer('route-line')) {
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': ROUTE_BLUE, 'line-width': 6, 'line-opacity': 1},
      })
      created = true
    }
    if (created && map.getLayer('route-casing') && map.getLayer('route-line')) {
      map.moveLayer('route-casing')
      map.moveLayer('route-line')
    }
    const source = map.getSource('route') as GeoJSONSource | undefined
    if (!source) return false
    source.setData(data)
    return true
  } catch {
    return false
  }
}



export function MapPage({onClose, speedUnit = 'mph'}: {onClose: () => void; speedUnit?: 'km/h' | 'mph'}) {
  const {t, locale} = useLocale()
  const tRef = useRef(t)
  tRef.current = t
  const tesla = useTeslaLocation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const destRef = useRef<Marker | null>(null)
  const followRef = useRef(mapMemory.following)
  const drivingRef = useRef(mapMemory.driving)
  /** False only until the next driving camera frame applies START_ZOOM once. */
  const driveZoomedRef = useRef(true)
  const framedRef = useRef(false)
  const framedOpenRef = useRef(false)
  const pointRef = useRef<Fix | null>(null)
  const teslaOnRef = useRef(false)
  const editingRef = useRef(false)
  const drawnRef = useRef<RouteData>(mapMemory.trip && mapMemory.route && mapMemory.route.length >= 2 ? lineData(mapMemory.route) : EMPTY)
  const lastCommitted = useRef<RouteData | null>(null)
  const routeCoordsRef = useRef<[number, number][] | null>(mapMemory.route)
  const hitsQueryRef = useRef('')
  const flushRef = useRef<() => void>(() => {})
  const routeSeq = useRef(0)
  const [fix, setFix] = useState<Fix | null>(null)
  const [places, setPlaces] = useState(loadPlaces)
  const [selected, setSelected] = useState<PlaceId>(mapMemory.selected)
  const [editing, setEditing] = useState(false)
  const [editExtra, setEditExtra] = useState<ExtraId | null>(null)
  const [draft, setDraft] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [markerKind, setMarkerKind] = useState<MarkerKind>(loadMarkerKind)
  const [trip, setTrip] = useState<Trip | null>(mapMemory.trip)
  const [guide, setGuide] = useState<Guide | null>(mapMemory.guide)
  const [arrival, setArrival] = useState<Arrival | null>(null)
  const [following, setFollowing] = useState(mapMemory.following)
  const [basemap, setBasemap] = useState<BasemapMode>(bootBasemap)
  const [chargersOn, setChargersOn] = useState(false)
  const [nearbyChargers, setNearbyChargers] = useState<{site: Charger; distance: number}[]>([])
  const [chargerError, setChargerError] = useState(false)
  const [chargersLoaded, setChargersLoaded] = useState(false)
  const [searchTab, setSearchTab] = useState<'Recents' | 'Favorites'>('Recents')
  const [recents, setRecents] = useState<SavedPlace[]>([])
  const [driving, setDriving] = useState(mapMemory.driving)
  const [query, setQuery] = useState(mapMemory.query)
  const [queryHits, setQueryHits] = useState<Hit[]>([])
  const [querySearching, setQuerySearching] = useState(false)
  const [querySearched, setQuerySearched] = useState(false)
  const [queryOpen, setQueryOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [dropPin, setDropPin] = useState<{lat: number; lon: number; title?: string} | null>(null)
  const [addName, setAddName] = useState('')
  const [addAddress, setAddAddress] = useState('')
  const [addHits, setAddHits] = useState<Hit[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const [addSearched, setAddSearched] = useState(false)
  const kindRef = useRef(markerKind)
  const tripRef = useRef<Trip | null>(null)
  const arrivalRef = useRef<Arrival | null>(null)
  const arrivedRef = useRef(false)
  const queryOpenRef = useRef(false)
  const clearAskRef = useRef(false)
  const addingRef = useRef(false)
  const addQueryRef = useRef('')
  const placeMarkersRef = useRef<Marker[]>([])
  const placeHoldTimer = useRef(0)
  const suppressPlaceClick = useRef(false)
  const placeHoldAt = useRef({x: 0, y: 0, pointerId: -1})
  const chargersOnRef = useRef(false)
  const chargerPopupRef = useRef<Popup | null>(null)
  const syncChargersRef = useRef<(map: Map) => void>(() => {})
  const suppressChargerClick = useRef(false)
  const dropPinRef = useRef<{lat: number; lon: number; title?: string} | null>(null)
  useEffect(() => () => {
    if (placeHoldTimer.current) window.clearTimeout(placeHoldTimer.current)
  }, [])

  const courseRef = useRef<CourseAnchor | null>(null)
  const point: Fix | null = (() => {
    const coords = tesla.coordinates
    if (!coords) return fix
    const resolved = resolveTravelFix(courseRef.current, coords.latitude, coords.longitude, coords.heading, coords.speed)
    courseRef.current = resolved.anchor
    return resolved.fix
  })()

  pointRef.current = point
  teslaOnRef.current = tesla.enabled
  editingRef.current = editing
  kindRef.current = markerKind
  tripRef.current = trip
  drivingRef.current = driving
  arrivalRef.current = arrival
  queryOpenRef.current = queryOpen
  addingRef.current = adding
  flushRef.current = () => {
    const map = mapRef.current
    const data = drawnRef.current
    if (!map) return
    if (lastCommitted.current === data && map.getSource('route') && map.getLayer('route-line')) return
    if (commitRoute(map, data)) lastCommitted.current = data
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (queryOpenRef.current) { setQueryOpen(false); return }
      if (arrivalRef.current) { dismissArrival(); return }
      if (editingRef.current) { setEditing(false); return }
      if (addingRef.current) { setAdding(false); return }
      if (clearAskRef.current) { setClearAsk(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const onMarker = () => setMarkerKind(loadMarkerKind())
    window.addEventListener('robaq-marker', onMarker)
    return () => window.removeEventListener('robaq-marker', onMarker)
  }, [])

  function paintRoute(data: RouteData) {
    drawnRef.current = data
    const map = mapRef.current
    if (!map) return
    if (commitRoute(map, data)) lastCommitted.current = data
  }

  function showDestination(place: SavedPlace | null) {
    const map = mapRef.current
    const marker = destRef.current
    if (!map || !marker) return
    if (!place) { marker.remove(); return }
    marker.setLngLat([place.lon, place.lat]).addTo(map)
  }

  function dismissArrival() {
    arrivalRef.current = null
    setArrival(null)
  }

  function showArrival(place: SavedPlace) {
    tripRef.current = null
    setTrip(null)
    routeCoordsRef.current = null
    followRef.current = false
    setFollowing(false)
    drivingRef.current = false
    mapMemory.driving = false
    setDriving(false)
    routeSeq.current += 1
    arrivedRef.current = true
    paintRoute(EMPTY)
    showDestination(null)
    mapMemory.guide = null
    setGuide(null)
    const card = {label: place.label, left: 5}
    arrivalRef.current = card
    setArrival(card)
  }

  useEffect(() => {
    if (arrival) return
    if (!arrivedRef.current) return
    arrivedRef.current = false
    paintRoute(EMPTY)
    showDestination(null)
  }, [arrival])

  useEffect(() => {
    if (!arrival) return
    const timer = window.setTimeout(() => {
      setArrival(current => {
        if (!current) return null
        if (current.left <= 1) {
          arrivalRef.current = null
          return null
        }
        const next = {...current, left: current.left - 1}
        arrivalRef.current = next
        return next
      })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [arrival])

  function waitForPoint(ms: number): Promise<Fix | null> {
    if (pointRef.current) return Promise.resolve(pointRef.current)
    return new Promise(resolve => {
      const started = Date.now()
      const timer = window.setInterval(() => {
        if (pointRef.current || Date.now() - started >= ms) {
          window.clearInterval(timer)
          resolve(pointRef.current)
        }
      }, 250)
    })
  }

  function locate(): Promise<Fix | null> {
    if (pointRef.current) return Promise.resolve(pointRef.current)
    // Tesla's browser freezes if a second geolocation call starts while its watch is running.
    if (teslaOnRef.current || !navigator.geolocation) return waitForPoint(10000)
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        position => {
          const resolved = resolveTravelFix(courseRef.current, position.coords.latitude, position.coords.longitude, position.coords.heading, position.coords.speed)
          courseRef.current = resolved.anchor
          const next = Number.isFinite(resolved.fix.lat) && Number.isFinite(resolved.fix.lon) ? resolved.fix : null
          if (next) {
            pointRef.current = next
            setFix(current => current ?? next)
          }
          resolve(next ?? pointRef.current)
        },
        () => { void waitForPoint(4000).then(resolve) },
        {enableHighAccuracy: true, maximumAge: 10000, timeout: 12000},
      )
    })
  }

  function cancelRoute() {
    routeSeq.current += 1
    tripRef.current = null
    mapMemory.trip = null
    mapMemory.route = null
    setTrip(null)
    routeCoordsRef.current = null
    followRef.current = false
    setFollowing(false)
    const wasDriving = drivingRef.current
    drivingRef.current = false
    mapMemory.driving = false
    setDriving(false)
    if (wasDriving) mapRef.current?.easeTo({zoom: OPEN_ZOOM, pitch: 0, duration: 450})
    arrivedRef.current = false
    arrivalRef.current = null
    setArrival(null)
    setHint(null)
    paintRoute(EMPTY)
    showDestination(null)
    mapMemory.guide = null
    setGuide(null)
  }

  function rememberGuide(next: Guide | null) {
    mapMemory.guide = next
    setGuide(next)
  }

  async function navigate(id: TripId, place: SavedPlace, andDrive = false) {
    setRecents(old => [place, ...old.filter(item => item.lat !== place.lat || item.lon !== place.lon)].slice(0, 8))
    if (id === 'home' || id === 'work') setSelected(id)
    setEditing(false)
    arrivedRef.current = false
    arrivalRef.current = null
    setArrival(null)
    const seq = ++routeSeq.current
    const nextTrip = {id, place}
    mapMemory.trip = nextTrip
    tripRef.current = nextTrip
    setTrip(nextTrip)
    const freshStart = andDrive && !drivingRef.current
    followRef.current = andDrive
    setFollowing(andDrive)
    drivingRef.current = andDrive
    mapMemory.driving = andDrive
    setDriving(andDrive)
    if (freshStart) driveZoomedRef.current = false
    if (andDrive) setQueryOpen(false)
    showDestination(place)
    const known = pointRef.current
    if (known) {
      const straight = directLine(known, place)
      routeCoordsRef.current = straight
      mapMemory.route = straight
      paintRoute(lineData(straight))
      rememberGuide({distance: pathMeters(straight), duration: 0, steps: []})
    } else {
      routeCoordsRef.current = null
      mapMemory.route = null
      paintRoute(EMPTY)
      setHint('Waiting for location…')
    }
    const origin = await locate()
    if (seq !== routeSeq.current) return
    if (!origin) { setHint('Waiting for location…'); return }
    if (metersBetween(origin.lat, origin.lon, place.lat, place.lon) <= ARRIVAL_M) {
      setHint(null)
      showArrival(place)
      return
    }
    setHint(null)
    const straight = directLine(origin, place)
    routeCoordsRef.current = straight
    mapMemory.route = straight
    paintRoute(lineData(straight))
    rememberGuide({distance: pathMeters(straight), duration: 0, steps: []})
    try {
      const response = await fetch(`/api/route?from=${origin.lon},${origin.lat}&to=${place.lon},${place.lat}`)
      const body = await response.json() as {geometry?: {type?: string; coordinates?: unknown}; distance?: unknown; duration?: unknown; steps?: unknown}
      if (seq !== routeSeq.current) return
      const raw = body.geometry?.type === 'LineString' && Array.isArray(body.geometry.coordinates) ? body.geometry.coordinates : []
      const coordinates: [number, number][] = []
      for (const pair of raw) {
        if (!Array.isArray(pair) || pair.length < 2) continue
        const lon = Number(pair[0])
        const lat = Number(pair[1])
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
        coordinates.push([lon, lat])
      }
      // OSRM can fail. The straight line already on the map stays, so navigation is never blank.
      if (!response.ok || coordinates.length < 2) return
      routeCoordsRef.current = coordinates
      mapMemory.route = coordinates
      mapMemory.trip = tripRef.current
      rememberGuide(guideFrom(body, coordinates))
      const here = pointRef.current ?? origin
      paintRoute(lineData(sliceRoute(coordinates, here.lat, here.lon)))
      const view = mapRef.current
      if (!drivingRef.current && view) fitRoute(view, coordinates)
    } catch {
      if (seq !== routeSeq.current) return
    }
  }

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const map = new Map({
      container: el,
      style: basemapStyle(basemap),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 19,
      attributionControl: {compact: false},
      fadeDuration: 0,
      dragRotate: true,
      touchZoomRotate: true,
      touchPitch: true,
      pitchWithRotate: true,
    })
    map.touchZoomRotate.enableRotation()
    map.dragRotate.enable()
    map.touchPitch.enable()
    map.on('style.load', () => applyMap3d(map))
    const pin = document.createElement('div')
    const initialKind = kindRef.current
    pin.className = `owned-map-pin${initialKind === 'dot' ? ' is-puck' : ' is-vehicle'}`
    pin.dataset.kind = initialKind
    pin.innerHTML = markerMarkup(initialKind)
    // auto matches viewport and rotates by heading on top of the camera bearing, so the nose points backward except near north.
    const marker = new Marker({element: pin, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'viewport'})
    const destEl = document.createElement('div')
    destEl.className = 'owned-map-dest'
    destEl.innerHTML = '<span></span>'
    const dest = new Marker({element: destEl, anchor: 'center'})
    const flush = () => flushRef.current()
    map.on('style.load', flush)
    map.on('idle', flush)
    // Only a real one-finger pan stops follow. Pinch, rotate, pitch, and easeTo must not.
    map.on('dragstart', (event) => {
      if (drivingRef.current || !isOneFingerPan(event.originalEvent)) return
      followRef.current = false
      setFollowing(false)
    })
    map.on('moveend', () => syncChargersRef.current(map))
    map.on('style.load', () => syncChargersRef.current(map))
    const holdPress = {timer: 0, x: 0, y: 0, held: false, lat: 0, lon: 0, title: ''}
    const chargerUnder = (point: {x: number; y: number}) => {
      if (!map.getLayer('chargers-bolt')) return null
      const hit = map.queryRenderedFeatures([point.x, point.y], {layers: ['chargers-bolt']})[0]
      if (!hit || hit.geometry.type !== 'Point') return null
      const coords = hit.geometry.coordinates
      const lon = Number(coords[0])
      const lat = Number(coords[1])
      const name = typeof hit.properties?.name === 'string' ? hit.properties.name : ''
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
      return {lat, lon, name}
    }
    const beginHold = (point: {x: number; y: number}, lngLat: {lat: number; lng: number}, target: EventTarget | null) => {
      if (holdPress.timer) return
      if (target instanceof Element && target.closest('.maplibregl-ctrl, button, a, input, select, textarea, .owned-map-drop')) return
      if (dropPinRef.current) return
      const site = chargerUnder(point)
      holdPress.x = point.x
      holdPress.y = point.y
      holdPress.held = false
      holdPress.lat = site ? site.lat : lngLat.lat
      holdPress.lon = site ? site.lon : lngLat.lng
      holdPress.title = site ? site.name : ''
      if (!Number.isFinite(holdPress.lat) || !Number.isFinite(holdPress.lon)) return
      holdPress.timer = window.setTimeout(() => {
        holdPress.timer = 0
        holdPress.held = true
      }, 1000)
    }
    const moveHold = (point: {x: number; y: number}) => {
      if (!holdPress.timer) return
      if (Math.hypot(point.x - holdPress.x, point.y - holdPress.y) <= 12) return
      window.clearTimeout(holdPress.timer)
      holdPress.timer = 0
    }
    const endHold = () => {
      if (holdPress.timer) {
        window.clearTimeout(holdPress.timer)
        holdPress.timer = 0
      }
      if (!holdPress.held) return
      holdPress.held = false
      suppressChargerClick.current = true
      chargerPopupRef.current?.remove()
      setDropPin(holdPress.title ? {lat: holdPress.lat, lon: holdPress.lon, title: holdPress.title} : {lat: holdPress.lat, lon: holdPress.lon})
    }
    const cancelHold = () => {
      if (holdPress.held) return
      window.clearTimeout(holdPress.timer)
      holdPress.timer = 0
    }
    map.on('mousedown', event => beginHold(event.point, event.lngLat, event.originalEvent?.target ?? null))
    map.on('touchstart', event => beginHold(event.point, event.lngLat, event.originalEvent?.target ?? null))
    map.on('mousemove', event => moveHold(event.point))
    map.on('touchmove', event => moveHold(event.point))
    map.on('mouseup', endHold)
    map.on('touchend', endHold)
    map.on('touchcancel', cancelHold)
    map.on('dragstart', cancelHold)
    map.on('click', (event) => {
      if (suppressChargerClick.current) {
        suppressChargerClick.current = false
        return
      }
      if (dropPinRef.current) {
        const pressed = event.originalEvent?.target
        if (!(pressed instanceof Element && pressed.closest('.owned-map-drop-go, .owned-map-drop-add'))) setDropPin(null)
        return
      }
      if (map.getLayer('chargers-bolt')) {
        const hit = map.queryRenderedFeatures(event.point, {layers: ['chargers-bolt']})[0]
        const name = hit && typeof hit.properties?.name === 'string' ? hit.properties.name : ''
        if (name) {
          chargerPopupRef.current?.remove()
          const popup = new Popup({closeButton: true, closeOnClick: true, offset: 18, maxWidth: '240px'})
            .setLngLat(event.lngLat)
            .setText(name)
            .addTo(map)
          chargerPopupRef.current = popup
          return
        }
      }
      const target = event.originalEvent?.target
      if (target instanceof Element && target.closest('.maplibregl-ctrl, button, a, input, select, textarea, .owned-map-drop')) return
      const panel = queryOpenRef.current || editingRef.current || addingRef.current || clearAskRef.current || !!arrivalRef.current
      setQueryOpen(false)
      setEditing(false)
      setAdding(false)
      setClearAsk(false)
      if (arrivalRef.current) dismissArrival()
      if (panel) return
    })
    const resize = () => map.resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    mapRef.current = map
    markerRef.current = marker
    destRef.current = dest
    const opening = pointRef.current
    if (opening) {
      framedOpenRef.current = true
      framedRef.current = true
      if (drivingRef.current && tripRef.current) {
        map.easeTo({
          center: [opening.lon, opening.lat],
          zoom: START_ZOOM,
          pitch: DRIVE_PITCH,
          bearing: cameraBearing(opening) ?? 0,
          offset: behindOffset(map),
          duration: 0,
        })
      } else {
        map.jumpTo({center: [opening.lon, opening.lat], zoom: OPEN_ZOOM, pitch: 0, bearing: 0})
      }
    }
    flush()
    const active = tripRef.current
    const coords = routeCoordsRef.current
    if (active && coords && coords.length >= 2) {
      showDestination(active.place)
      const here = pointRef.current
      paintRoute(lineData(here ? sliceRoute(coords, here.lat, here.lon) : coords))
      if (!mapMemory.guide) rememberGuide({distance: pathMeters(coords), duration: 0, steps: []})
    } else if (active) {
      void navigate(active.id, active.place, drivingRef.current)
    }
    return () => {
      window.clearTimeout(holdPress.timer)
      observer.disconnect()
      marker.remove()
      dest.remove()
      map.remove()
      mapRef.current = null
      markerRef.current = null
      destRef.current = null
      for (const marker of placeMarkersRef.current) marker.remove()
      placeMarkersRef.current = []
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    for (const marker of placeMarkersRef.current) marker.remove()
    placeMarkersRef.current = []
    if (!map) return
    const slots = (['home', 'work', ...EXTRA_IDS] as const)
    const next: Marker[] = []
    for (const id of slots) {
      const saved = places[id]
      if (!saved) continue
      const marker = new Marker({element: savedMarkerEl(id), anchor: 'center'})
      marker.setLngLat([saved.lon, saved.lat]).addTo(map)
      next.push(marker)
    }
    placeMarkersRef.current = next
    return () => {
      for (const marker of next) marker.remove()
      if (placeMarkersRef.current === next) placeMarkersRef.current = []
    }
  }, [places])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !dropPin) return
    const el = document.createElement('div')
    el.className = 'owned-map-drop'
    const pin = document.createElement('div')
    pin.className = 'owned-map-drop-pin'
    const actions = document.createElement('div')
    actions.className = 'owned-map-drop-actions'
    const go = document.createElement('button')
    go.type = 'button'
    go.className = 'owned-map-drop-go'
    go.textContent = tRef.current('GO')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'owned-map-drop-add'
    btn.textContent = tRef.current('Add to favorite')
    const here = dropPin
    const label = here.title?.trim() || `${here.lat.toFixed(5)}, ${here.lon.toFixed(5)}`
    go.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      setDropPin(null)
      void navigate('search', {lat: here.lat, lon: here.lon, label}, true)
    })
    btn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const name = (here.title?.trim() || tRef.current('Favorite')).slice(0, 40)
      setPlaces(saveExtra('star', {lat: here.lat, lon: here.lon, label, name}))
      setDropPin(null)
    })
    actions.append(go, btn)
    el.append(pin, actions)
    const marker = new Marker({element: el, anchor: 'center'})
    marker.setLngLat([here.lon, here.lat]).addTo(map)
    return () => { marker.remove() }
  }, [dropPin])

  useEffect(() => {
    if (tesla.enabled) return
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      position => {
        const resolved = resolveTravelFix(courseRef.current, position.coords.latitude, position.coords.longitude, position.coords.heading, position.coords.speed)
        if (!Number.isFinite(resolved.fix.lat) || !Number.isFinite(resolved.fix.lon)) return
        courseRef.current = resolved.anchor
        setFix(resolved.fix)
      },
      () => {},
      {enableHighAccuracy: true, maximumAge: 5000, timeout: 12000},
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [tesla.enabled])

  useEffect(() => {
    mapMemory.selected = selected
    mapMemory.query = query
    mapMemory.following = following
    mapMemory.driving = driving
    mapMemory.trip = trip
    if (!trip) mapMemory.route = null
  }, [selected, query, following, driving, trip])

  useEffect(() => {
    if (!editing) return
    const q = draft.trim()
    if (q.length < 2) {
      setHits([])
      setSearching(false)
      setSearched(false)
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      const params = new URLSearchParams({q, lang: locale})
      fetch(`/api/geocode?${params}`, {signal: ctrl.signal})
        .then(response => response.ok ? response.json() as Promise<unknown> : [])
        .then(data => {
          if (ctrl.signal.aborted) return
          setHits(hitsFrom(data))
          setSearched(true)
        })
        .catch(() => {
          if (ctrl.signal.aborted) return
          setHits([])
          setSearched(true)
        })
        .finally(() => { if (!ctrl.signal.aborted) setSearching(false) })
    }, 450)
    return () => { window.clearTimeout(timer); ctrl.abort() }
  }, [draft, editing, locale])

  useEffect(() => {
    if (!adding) return
    const q = addAddress.trim()
    if (q.length < 2) {
      setAddHits([])
      setAddSearching(false)
      setAddSearched(false)
      addQueryRef.current = ''
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setAddSearching(true)
      const params = new URLSearchParams({q, lang: locale})
      fetch(`/api/geocode?${params}`, {signal: ctrl.signal})
        .then(response => response.ok ? response.json() as Promise<unknown> : [])
        .then(data => {
          if (ctrl.signal.aborted) return
          const next = hitsFrom(data)
          setAddHits(next)
          setAddSearched(true)
          addQueryRef.current = q
        })
        .catch(() => {
          if (ctrl.signal.aborted) return
          setAddHits([])
          setAddSearched(true)
        })
        .finally(() => { if (!ctrl.signal.aborted) setAddSearching(false) })
    }, 450)
    return () => { window.clearTimeout(timer); ctrl.abort() }
  }, [addAddress, adding, locale])

  useEffect(() => {
    if (!queryOpen) return
    const q = query.trim()
    if (q.length < 2) {
      setQueryHits([])
      setQuerySearching(false)
      setQuerySearched(false)
      hitsQueryRef.current = ''
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setQuerySearching(true)
      const params = new URLSearchParams({q, lang: locale})
      fetch(`/api/geocode?${params}`, {signal: ctrl.signal})
        .then(response => response.ok ? response.json() as Promise<unknown> : [])
        .then(data => {
          if (ctrl.signal.aborted) return
          const next = hitsFrom(data)
          setQueryHits(next)
          setQuerySearched(true)
          hitsQueryRef.current = q
        })
        .catch(() => {
          if (ctrl.signal.aborted) return
          setQueryHits([])
          setQuerySearched(true)
        })
        .finally(() => { if (!ctrl.signal.aborted) setQuerySearching(false) })
    }, 450)
    return () => { window.clearTimeout(timer); ctrl.abort() }
  }, [query, queryOpen, locale])

  const lat = point?.lat
  const lon = point?.lon
  const heading = point?.heading ?? null
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker || lat == null || lon == null) return
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    if (chargersOnRef.current) syncChargersRef.current(map)
    const active = tripRef.current
    if (active && !arrivalRef.current && metersBetween(lat, lon, active.place.lat, active.place.lon) <= ARRIVAL_M) {
      showArrival(active.place)
    }
    const lngLat: [number, number] = [lon, lat]
    const headed = heading != null && heading >= 0
    marker.setLngLat(lngLat)
    if (headed) marker.setRotation(heading)
    marker.getElement().classList.toggle('is-headed', kindRef.current === 'dot' && headed)
    if (!marker.getElement().isConnected) marker.addTo(map)
    const coords = routeCoordsRef.current
    if (coords && coords.length >= 2 && active && !arrivalRef.current) {
      // Two points is the straight fallback. Keep it glued to the car instead of slicing a stale start.
      const next = coords.length <= 2 ? directLine({lat, lon, heading}, active.place) : sliceRoute(coords, lat, lon)
      if (coords.length <= 2) {
        routeCoordsRef.current = next
        mapMemory.route = next
      }
      paintRoute(lineData(next))
    }
    if (!framedOpenRef.current) {
      framedOpenRef.current = true
      framedRef.current = true
      if (drivingRef.current && tripRef.current) {
        easeBehind(map, {lat, lon, heading}, driveZoomedRef.current ? false : START_ZOOM)
        driveZoomedRef.current = true
        return
      }
      map.easeTo({center: lngLat, zoom: OPEN_ZOOM, pitch: 0, bearing: 0, duration: 700})
      return
    }
    if (!followRef.current && !drivingRef.current) return
    if (drivingRef.current) {
      easeBehind(map, {lat, lon, heading}, driveZoomedRef.current ? false : START_ZOOM)
      driveZoomedRef.current = true
      return
    }
    if (!framedRef.current) {
      framedRef.current = true
      map.easeTo({center: lngLat, zoom: OPEN_ZOOM, pitch: 0, bearing: 0, duration: 700})
    } else {
      map.jumpTo({center: lngLat})
    }
  }, [lat, lon, heading, following, driving])

  useEffect(() => {
    const el = markerRef.current?.getElement()
    if (!el) return
    const headed = markerKind === 'dot' && heading != null && heading >= 0
    el.classList.toggle('is-vehicle', markerKind !== 'dot')
    el.classList.toggle('is-puck', markerKind === 'dot')
    el.classList.toggle('is-headed', headed)
    if (el.dataset.kind !== markerKind) {
      el.dataset.kind = markerKind
      el.innerHTML = markerMarkup(markerKind)
    }
  }, [markerKind, heading])

  function openEditor(id: PlaceId) {
    setEditExtra(null)
    setSelected(id)
    setDraft('')
    setHits([])
    setSearched(false)
    setSearching(false)
    setHint(null)
    setAdding(false)
    setEditing(true)
  }

  function openExtraEditor(id: ExtraId) {
    if (!places[id]) return
    setEditExtra(id)
    setDraft('')
    setHits([])
    setSearched(false)
    setSearching(false)
    setHint(null)
    setAdding(false)
    setEditing(true)
  }

  function deleteEditedPlace() {
    const id: PlaceId | ExtraId = editExtra ?? selected
    setPlaces(clearSavedPlace(id))
    if (tripRef.current?.id === id) cancelRoute()
    setEditExtra(null)
    setEditing(false)
    setDraft('')
    setHits([])
    setSearched(false)
  }

  function openAdd() {
    setEditing(false)
    setQueryOpen(false)
    setAddName('')
    setAddAddress('')
    setAddHits([])
    setAddSearched(false)
    setAddSearching(false)
    addQueryRef.current = ''
    setAdding(true)
  }

  function commitExtra(hit: Hit, name: string) {
    const id: ExtraId | null = !places.heart ? 'heart' : !places.flag ? 'flag' : !places.star ? 'star' : null
    if (!id || !name) return
    const saved: ExtraPlace = {lat: hit.lat, lon: hit.lon, label: hit.label, name}
    setPlaces(saveExtra(id, saved))
    setAdding(false)
    setAddHits([])
    setAddSearched(false)
  }

  async function submitExtra() {
    const name = addName.trim().slice(0, 40)
    if (!name) return
    const q = addAddress.trim()
    if (q.length < 2) return
    let hit = addQueryRef.current === q ? addHits[0] : undefined
    if (!hit) {
      setAddSearching(true)
      try {
        const params = new URLSearchParams({q, lang: locale})
        const response = await fetch(`/api/geocode?${params}`)
        const next = hitsFrom(response.ok ? await response.json() as unknown : [])
        if (addAddress.trim() !== q) return
        setAddHits(next)
        setAddSearched(true)
        addQueryRef.current = q
        hit = next[0]
      } catch {
        if (addAddress.trim() !== q) return
        setAddHits([])
        setAddSearched(true)
        return
      } finally {
        setAddSearching(false)
      }
    }
    if (!hit) return
    commitExtra(hit, name)
  }

  function recenter() {
    followRef.current = true
    setFollowing(true)
    const map = mapRef.current
    const go = (next: Fix) => {
      const current = mapRef.current
      if (!current) return
      if (drivingRef.current) {
        easeBehind(current, next, false, true)
        return
      }
      current.easeTo({center: [next.lon, next.lat], zoom: OPEN_ZOOM, pitch: 0, bearing: 0, duration: 600})
    }
    if (pointRef.current) { go(pointRef.current); return }
    if (!map) return
    void locate().then(next => { if (next) go(next) })
  }

  function stopDrive() {
    drivingRef.current = false
    mapMemory.driving = false
    setDriving(false)
    followRef.current = false
    setFollowing(false)
    mapRef.current?.easeTo({zoom: OPEN_ZOOM, pitch: 0, duration: 450})
  }

  function clearDrawnRoute() {
    setQuery('')
    setQueryOpen(false)
    setQueryHits([])
    setQuerySearched(false)
    hitsQueryRef.current = ''
    mapMemory.query = ''
    setEditing(false)
    setAdding(false)
    cancelRoute()
  }

  function zoomBy(delta: number) {
    const map = mapRef.current
    if (!map) return
    map.easeTo({zoom: Math.min(19, Math.max(map.getMinZoom(), map.getZoom() + delta)), duration: 180})
  }

  function northUp() {
    mapRef.current?.easeTo({bearing: 0, duration: 280})
  }

  // Rail no longer shows these. Pinch still zooms. Keep the handlers.
  void zoomBy
  void northUp

  function syncChargers(map: Map) {
    if (!map.isStyleLoaded()) return
    if (!chargersOnRef.current) {
      chargerPopupRef.current?.remove()
      const source = map.getSource('chargers') as GeoJSONSource | undefined
      source?.setData({type: 'FeatureCollection', features: []})
      return
    }
    if (!map.hasImage('charger-bolt')) map.addImage('charger-bolt', chargerBolt(), {pixelRatio: 2})
    if (!map.getSource('chargers')) map.addSource('chargers', {type: 'geojson', data: {type: 'FeatureCollection', features: []}})
    if (!map.getLayer('chargers-ring')) {
      map.addLayer({
        id: 'chargers-ring',
        type: 'circle',
        source: 'chargers',
        filter: ['==', ['get', 'near'], 1],
        paint: {'circle-radius': 18, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff'},
      })
    }
    if (!map.getLayer('chargers-bolt')) {
      map.addLayer({
        id: 'chargers-bolt',
        type: 'symbol',
        source: 'chargers',
        layout: {
          'icon-image': 'charger-bolt',
          'icon-size': ['case', ['==', ['get', 'near'], 1], 1.35, 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
    }
    if (map.getLayer('route-casing')) {
      map.moveLayer('chargers-ring', 'route-casing')
      map.moveLayer('chargers-bolt', 'route-casing')
    }
    void loadChargers().then(sites => {
      if (!chargersOnRef.current || mapRef.current !== map) return
      setChargersLoaded(true)
      paintChargers(map, sites)
    }).catch(() => { setChargerError(true) })
  }

  function paintChargers(map: Map, sites: Charger[]) {
    const source = map.getSource('chargers') as GeoJSONSource | undefined
    if (!source || !chargersOnRef.current) return
    const center = map.getCenter()
    const origin = pointRef.current ?? {lat: center.lat, lon: center.lng}
    const ranked = sites.map(site => ({site, distance: metersBetween(origin.lat, origin.lon, site.lat, site.lon)}))
    ranked.sort((a, b) => a.distance - b.distance)
    setNearbyChargers(ranked.slice(0, 12))
    setChargerError(false)
    const near = new Set(ranked.slice(0, CHARGER_NEAR).map(row => row.site.id))
    const features = []
    for (const site of sites) {
      const highlighted = near.has(site.id)
      if (!highlighted && !viewHolds(map, site.lat, site.lon)) continue
      features.push({
        type: 'Feature' as const,
        id: site.id,
        properties: {name: site.name, near: highlighted ? 1 : 0},
        geometry: {type: 'Point' as const, coordinates: [site.lon, site.lat] as [number, number]},
      })
    }
    source.setData({type: 'FeatureCollection', features})
  }

  function toggleChargers() {
    const next = !chargersOnRef.current
    chargersOnRef.current = next
    setChargersOn(next)
    if (next) { setQueryOpen(false); setChargerError(false) }
    const map = mapRef.current
    if (!map) return
    syncChargers(map)
  }

  function applyBasemap(next: BasemapMode) {
    setBasemap(next)
    try { localStorage.setItem(MAP_BASEMAP_KEY, next) } catch { /* The choice still applies for this view. */ }
    const map = mapRef.current
    if (!map) return
    map.setStyle(basemapStyle(next), {diff: false})
  }

  function toggleBasemap() {
    const next: BasemapMode = basemap === 'satellite' ? 'street' : 'satellite'
    applyBasemap(next)
  }

  function onPlace(id: PlaceId) {
    if (tripRef.current?.id === id) {
      cancelRoute()
      return
    }
    const place = places[id]
    if (!place) { openEditor(id); return }
    void navigate(id, place, true)
  }

  function onPlaceClick(id: PlaceId | ExtraId) {
    if (suppressPlaceClick.current) {
      suppressPlaceClick.current = false
      return
    }
    if (id === 'home' || id === 'work') { onPlace(id); return }
    const saved = places[id]
    if (!saved) return
    if (tripRef.current?.id === id) { cancelRoute(); return }
    void navigate(id, saved, true)
  }

  function placePointerDown(id: PlaceId | ExtraId, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return
    if (placeHoldTimer.current) window.clearTimeout(placeHoldTimer.current)
    placeHoldTimer.current = 0
    suppressPlaceClick.current = false
    if (!places[id]) return
    placeHoldAt.current = {x: event.clientX, y: event.clientY, pointerId: event.pointerId}
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* already released */ }
    placeHoldTimer.current = window.setTimeout(() => {
      placeHoldTimer.current = 0
      suppressPlaceClick.current = true
      if (id === 'home' || id === 'work') openEditor(id)
      else openExtraEditor(id)
    }, 1000)
  }

  function placePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!placeHoldTimer.current || placeHoldAt.current.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - placeHoldAt.current.x, event.clientY - placeHoldAt.current.y) <= 14) return
    window.clearTimeout(placeHoldTimer.current)
    placeHoldTimer.current = 0
  }

  function placePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (placeHoldAt.current.pointerId !== event.pointerId) return
    if (!placeHoldTimer.current) return
    window.clearTimeout(placeHoldTimer.current)
    placeHoldTimer.current = 0
  }

  function choose(hit: Hit) {
    const place: SavedPlace = {lat: hit.lat, lon: hit.lon, label: hit.label}
    if (editExtra) {
      const current = places[editExtra]
      if (!current) return
      const saved: ExtraPlace = {lat: place.lat, lon: place.lon, label: place.label, name: current.name}
      const id = editExtra
      setPlaces(saveExtra(id, saved))
      setEditExtra(null)
      setEditing(false)
      setAdding(false)
      setHits([])
      void navigate(id, saved, true)
      return
    }
    setPlaces(savePlace(selected, place))
    setEditing(false)
    setAdding(false)
    setHits([])
    void navigate(selected, place, true)
  }

  function goToQuery(hit: Hit) {
    setQuery(hit.name || hit.label)
    setQueryHits([])
    setQueryOpen(false)
    setQuerySearched(false)
    hitsQueryRef.current = ''
    setEditing(false)
    setAdding(false)
    void navigate('search', {lat: hit.lat, lon: hit.lon, label: hit.label}, true)
  }

  const homeOn = trip ? trip.id === 'home' : editing && selected === 'home'
  const workOn = trip ? trip.id === 'work' : editing && selected === 'work'
  const [clearAsk, setClearAsk] = useState(false)
  clearAskRef.current = clearAsk
  dropPinRef.current = dropPin
  syncChargersRef.current = syncChargers

  const routeLine = routeCoordsRef.current
  const remainMeters = guide && trip && routeLine && routeLine.length >= 2
    ? pathMeters(!point ? routeLine : routeLine.length <= 2 ? directLine(point, trip.place) : sliceRoute(routeLine, point.lat, point.lon))
    : guide?.distance ?? 0
  const showRoute = !!(trip && guide && routeLine && routeLine.length >= 2 && !arrival)
  const traveled = guide ? Math.max(0, guide.distance - remainMeters) : 0
  const cursor = guide && guide.steps.length ? stepCursor(guide.steps, traveled) : null
  const currentStep = cursor && guide ? guide.steps[cursor.index] : null
  const upcoming = guide && cursor
    ? guide.steps.slice(cursor.index + 1).filter(step => step.maneuver !== 'arrive' && step.name.trim()).slice(0, 4)
    : []
  const placeLabel = trip ? splitLabel(trip.place.label) : {title: '', rest: ''}
  const primaryName = currentStep && currentStep.maneuver !== 'arrive' && currentStep.name.trim()
    ? currentStep.name.trim()
    : placeLabel.title
  const primaryMeters = currentStep && currentStep.maneuver !== 'arrive' ? cursor!.remain : remainMeters
  const etaSeconds = guide && guide.duration > 0 && guide.distance > 0
    ? guide.duration * Math.min(1, Math.max(0, remainMeters / guide.distance))
    : 0

  function formatDistance(meters: number) {
    if (!Number.isFinite(meters) || meters < 0) meters = 0
    if (speedUnit === 'mph') {
      const miles = meters / 1609.344
      if (miles < 0.1) {
        const feet = Math.max(50, Math.round((meters * 3.28084) / 50) * 50)
        return t(`${feet} ft`)
      }
      const text = miles < 10 ? miles.toFixed(1) : String(Math.round(miles))
      return t(`${text} mi`)
    }
    if (meters < 950) {
      const rounded = Math.max(50, Math.round(meters / 50) * 50)
      return t(`${rounded} m`)
    }
    const km = meters / 1000
    const text = km < 10 ? km.toFixed(1) : String(Math.round(km))
    return t(`${text} km`)
  }

  function formatDuration(seconds: number) {
    const mins = Math.max(1, Math.round(seconds / 60))
    if (mins < 60) return t(`${mins} min`)
    const hours = Math.floor(mins / 60)
    const rest = mins % 60
    if (rest === 0) return t(`${hours} hr`)
    return t(`${hours} hr ${rest} min`)
  }

  function formatEta(seconds: number) {
    return new Date(Date.now() + seconds * 1000).toLocaleTimeString(locale === 'ka' ? 'ka-GE' : locale === 'ru' ? 'ru-RU' : undefined, {hour: 'numeric', minute: '2-digit'})
  }

  const routeCard = showRoute && guide && trip ? (
    <aside className="owned-map-guide" aria-label={primaryName}>
      <div className="owned-map-guide-next">
        <TurnArrow kind={currentStep && currentStep.maneuver !== 'arrive' ? currentStep.maneuver : 'straight'} />
        <div>
          <div className="owned-map-guide-dist">{formatDistance(primaryMeters)}</div>
          <div className="owned-map-guide-road">{primaryName}</div>
        </div>
      </div>
      <ul className="owned-map-guide-list">
        {upcoming.map((step, index) => (
          <li key={`${step.name}-${index}-${step.distance}`}>
            <TurnArrow kind={step.maneuver} />
            <span className="owned-map-guide-step-dist">{formatDistance(step.distance)}</span>
            <span className="owned-map-guide-step-name">{step.name}</span>
          </li>
        ))}
        <li className="is-dest">
          <TurnArrow kind="arrive" />
          <span className="owned-map-guide-dest">
            <strong>{placeLabel.title}</strong>
            {placeLabel.rest && <span>{placeLabel.rest}</span>}
          </span>
        </li>
      </ul>
      <button type="button" className="owned-map-guide-cancel" onClick={clearDrawnRoute}>{t('Cancel')}</button>
      <div className="owned-map-guide-meta">
        <span>{formatDistance(guide.distance)}</span>
        {guide.duration > 0 && <span>{formatDuration(guide.duration)}</span>}
        {etaSeconds > 0 && <span>{formatEta(etaSeconds)}</span>}
      </div>
    </aside>
  ) : null
  const routeBanner = showRoute && trip ? (
    <div className="owned-map-banner">{placeLabel.rest ? `${placeLabel.title}  ${placeLabel.rest}` : placeLabel.title}</div>
  ) : null

  return (
    <section className={`owned-map${driving ? ' is-driving' : ''}${trip?.id === 'search' && showRoute ? ' is-search-route' : ''}`} role="dialog" aria-modal="true" aria-label={t('Map')}>
      <div ref={canvasRef} className="owned-map-canvas" />
      <div className="owned-map-places">
        <div className="owned-map-search-line">
        <form className="owned-map-search" role="search" onSubmit={event => event.preventDefault()}>
          <div className="owned-map-search-row">
          <input
            value={query}
            onChange={event => { setQuery(event.target.value); setQueryOpen(true) }}
            onFocus={() => {setQueryOpen(true); if (chargersOnRef.current) toggleChargers()} }
            onClick={() => setQueryOpen(true)}
            aria-expanded={queryOpen}
            aria-controls="map-destination-menu"
            placeholder={t('Search address')}
            aria-label={t('Search address')}
            autoComplete="off"
            spellCheck={false}
          />
          </div>
          {queryOpen && querySearching && <p className="owned-map-search-status">{t('Searching…')}</p>}
          {queryOpen && !querySearching && querySearched && queryHits.length === 0 && <p className="owned-map-search-status">{t('No addresses found')}</p>}
          {queryOpen && queryHits.length > 0 && (
            <ul className="owned-map-suggest">
              {queryHits.map(hit => (
                <li key={`${hit.lat},${hit.lon},${hit.label}`}>
                  <button type="button" onClick={() => goToQuery(hit)}>
                    <span className="owned-map-suggest-name">{hit.name || hit.label}</span>
                    {hit.address && hit.address !== (hit.name || hit.label) && <span className="owned-map-suggest-address">{hit.address}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        {driving && <button type="button" className="owned-map-go is-stop" onClick={stopDrive}>{t('Stop')}</button>}
        </div>
        {queryOpen && <div id="map-destination-menu" className="owned-map-search-dropdown"><div className="owned-map-places-bar">
          <button type="button" className={`owned-map-pill${homeOn ? ' is-on' : ''}`} aria-pressed={homeOn} onClick={() => onPlaceClick('home')} onPointerDown={event => placePointerDown('home', event)} onPointerMove={placePointerMove} onPointerUp={placePointerUp} onPointerCancel={placePointerUp} onContextMenu={event => event.preventDefault()}>
            <SlotIcon id="home" />
            <span>{t('HOME')}</span>
          </button>
          <button type="button" className={`owned-map-pill${workOn ? ' is-on' : ''}`} aria-pressed={workOn} onClick={() => onPlaceClick('work')} onPointerDown={event => placePointerDown('work', event)} onPointerMove={placePointerMove} onPointerUp={placePointerUp} onPointerCancel={placePointerUp} onContextMenu={event => event.preventDefault()}>
            <SlotIcon id="work" />
            <span>{t('WORK')}</span>
          </button>
          {EXTRA_IDS.map(id => {
            const saved = places[id]
            if (!saved) return null
            const on = trip?.id === id
            return (
              <button key={id} type="button" className={`owned-map-pill${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onPlaceClick(id)} onPointerDown={event => placePointerDown(id, event)} onPointerMove={placePointerMove} onPointerUp={placePointerUp} onPointerCancel={placePointerUp} onContextMenu={event => event.preventDefault()}>
                <SlotIcon id={id} />
                <span>{saved.name}</span>
              </button>
            )
          })}
          {EXTRA_IDS.some(id => !places[id]) && (
            <button type="button" className="owned-map-pill owned-map-add" aria-label={t('Add place')} onClick={openAdd}>+</button>
          )}
        </div>
        <div className="owned-map-search-tabs">
          {(['Recents', 'Favorites'] as const).map(tab => <button type="button" key={tab} aria-pressed={searchTab === tab} onClick={() => setSearchTab(tab)}>{t(tab)}</button>)}
          <button type="button" onClick={toggleChargers}>{t('Charging')}</button>
        </div>
        <div className="owned-map-place-results">
          {(searchTab === 'Recents' ? recents : Object.values(places).filter((place): place is SavedPlace => Boolean(place))).map(place => <button type="button" key={`${place.lat},${place.lon}`} onClick={() => {setQueryOpen(false); void navigate('search', place, true)}}><strong>{place.label}</strong></button>)}
          {searchTab === 'Recents' && !recents.length && <p>{t('No recent destinations')}</p>}
        </div></div>}
        {editing && (
          <form className="owned-map-edit" onSubmit={event => event.preventDefault()}>
            <div className="owned-map-edit-head">
              <p className="owned-map-edit-for">{editExtra ? (places[editExtra]?.name ?? '') : t(selected === 'home' ? 'HOME' : 'WORK')}</p>
              <button type="button" className="owned-map-edit-del" onClick={deleteEditedPlace}>{t('Delete')}</button>
            </div>
            <input
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder={t('Address')}
              aria-label={t('Address')}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {searching && <p className="owned-map-search-status">{t('Searching…')}</p>}
            {!searching && searched && hits.length === 0 && <p className="owned-map-search-status">{t('No addresses found')}</p>}
            {hits.length > 0 && (
              <ul className="owned-map-suggest">
                {hits.map(hit => (
                  <li key={`${hit.lat},${hit.lon},${hit.label}`}>
                    <button type="button" onClick={() => choose(hit)}>{hit.label}</button>
                  </li>
                ))}
              </ul>
            )}
          </form>
        )}
        {adding && (
          <form className="owned-map-edit" onSubmit={event => { event.preventDefault(); void submitExtra() }}>
            <input
              className="owned-map-add-name"
              value={addName}
              onChange={event => setAddName(event.target.value.slice(0, 40))}
              placeholder={t('Place name')}
              aria-label={t('Place name')}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
            />
            <input
              value={addAddress}
              onChange={event => setAddAddress(event.target.value)}
              placeholder={t('Address')}
              aria-label={t('Address')}
              autoComplete="off"
              spellCheck={false}
            />
            {addSearching && <p className="owned-map-search-status">{t('Searching…')}</p>}
            {!addSearching && addSearched && addHits.length === 0 && <p className="owned-map-search-status">{t('No addresses found')}</p>}
            {addHits.length > 0 && (
              <ul className="owned-map-suggest">
                {addHits.map(hit => (
                  <li key={`${hit.lat},${hit.lon},${hit.label}`}>
                    <button type="button" onClick={() => {
                      const name = addName.trim().slice(0, 40)
                      if (!name) return
                      commitExtra(hit, name)
                    }}>{hit.label}</button>
                  </li>
                ))}
              </ul>
            )}
          </form>
        )}
        {hint && !editing && !adding && <p className="owned-map-hint">{t(hint)}</p>}
      </div>
      {chargersOn && <aside className="owned-map-charging-panel" aria-label={t('Nearby charging')}>
        <header><h2>{t('Nearby charging')}</h2><button type="button" aria-label={t('Close')} onClick={toggleChargers}>×</button></header>
        <p>{t('Tesla Superchargers · community map')}</p>
        <small>{t('Prices and live availability are not provided.')}</small>
        {!point && <small>{t('Distances are measured from the map center.')}</small>}
        {chargerError ? <p role="status">{t('Could not load charging locations.')} <button type="button" onClick={() => {setChargerError(false); if(mapRef.current) syncChargers(mapRef.current)}}>{t('Retry')}</button></p> : !nearbyChargers.length ? <p role="status">{t(chargersLoaded ? 'No charging locations found.' : 'Searching…')}</p> :
          <div className="owned-map-charging-results">{nearbyChargers.map(({site, distance}) => <button type="button" key={site.id} onClick={() => {toggleChargers(); void navigate('search', {label:site.name,lat:site.lat,lon:site.lon}, true)}}><span><strong>{site.name}</strong><small>Tesla Supercharger</small></span><span className="owned-map-charge-distance">ϟ<small>{formatDistance(distance)}</small></span></button>)}</div>}
      </aside>}
      {arrival && (
        <div className="owned-map-arrival" role="status" aria-live="polite">
          <button type="button" className="owned-map-arrival-x" aria-label={t('Close')} onClick={dismissArrival}>×</button>
          <h2>{t('You are at this place')}</h2>
          <p>{arrival.label}</p>
          <div className="owned-map-arrival-count" aria-hidden="true">{arrival.left}</div>
        </div>
      )}
      {!chargersOn && !queryOpen && routeCard}
      {!chargersOn && !queryOpen && routeBanner}
      <div className="owned-map-rail">
        <button type="button" className={`is-chargers${chargersOn ? ' is-on' : ''}`} aria-pressed={chargersOn} aria-label={t('Superchargers')} onClick={toggleChargers}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path fill="currentColor" d="M13.2 3.4 7.2 12.6h3.6l-1.2 7.2 6.6-10.2h-3.7l.7-6.2z"/></svg>
        </button>
        <button type="button" className="is-basemap" aria-pressed={basemap === 'satellite'} aria-label={basemap === 'street' ? t('Map') : t('Satellite')} onClick={toggleBasemap}>
          {basemap === 'street' ? (
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6"/><ellipse cx="12" cy="12" rx="3.3" ry="7.2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M5.1 12h13.8M6.4 8.6h11.2M6.4 15.4h11.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 8 7 7-3 3-7-7zM10 7l4-4 7 7-4 4M7 10l-4 4 7 7 4-4M14 3l7 7M17.5 6.5l-4 4M6.5 17.5l4-4M5 3a4 4 0 0 1 4 4M3 3a6 6 0 0 1 6 6"/></g></svg>
          )}
        </button>
        <button type="button" className={`is-gps${following ? ' is-on' : ''}`} aria-pressed={following} aria-label={t('Recenter')} onClick={recenter}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        </button>
      </div>
      <button type="button" className="owned-map-close" aria-label={t('Clear route')} onClick={() => setClearAsk(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
      </button>
      {clearAsk && (
        <div className="owned-map-warn" role="alertdialog" aria-modal="true" aria-labelledby="map-clear-title" aria-describedby="map-clear-copy">
          <h2 id="map-clear-title">{t('Clear the route?')}</h2>
          <p id="map-clear-copy">{t('This will clear the drawn route. Saved Home and Work stay.')}</p>
          <div className="owned-map-warn-actions">
            <button type="button" onClick={() => setClearAsk(false)}>{t('Cancel')}</button>
            <button type="button" className="is-danger" onClick={() => {
              setClearAsk(false)
                        setQuery('')
              setQueryOpen(false)
              setQueryHits([])
              setQuerySearched(false)
              hitsQueryRef.current = ''
              mapMemory.query = ''
              setEditing(false)
              cancelRoute()
              onClose()
            }}>{t('Clear route')}</button>
          </div>
        </div>
      )}
    </section>
  )
}
