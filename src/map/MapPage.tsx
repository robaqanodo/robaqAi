import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react'
import {Map, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import {useLocale} from '../i18n/Locale'
import {IntelligenceOrb} from '../components/IntelligenceOrb'
import {useTeslaCoreInteraction} from '../tesla/useTeslaCoreInteraction'
import {useTeslaLocation} from '../tesla/location'
import {loadPlaces, savePlace, type PlaceId, type SavedPlace} from './places'
import {loadMarkerKind, markerMarkup, saveMarkerKind, type MarkerKind} from './marker'
import {satelliteStyle} from './style'
import './map.css'

// Vite bundles maplibre-gl.mjs into the app chunk, so the default worker URL
// (./maplibre-gl-worker.mjs next to that chunk) 404s. GeoJSON then never tiles:
// raster imagery and HTML markers still show, the route line does not.
setWorkerUrl(maplibreWorkerUrl)

type Fix = {lat: number; lon: number; heading: number | null}
type Hit = {label: string; lat: number; lon: number}
type RouteFeature = {
  type: 'Feature'
  properties: Record<string, never>
  geometry: {type: 'LineString'; coordinates: [number, number][]}
}
type RouteData = RouteFeature | {type: 'FeatureCollection'; features: []}
type TripId = PlaceId | 'search'
type Trip = {id: TripId; place: SavedPlace}
type Arrival = {label: string; left: number}
type MapMemory = {
  selected: PlaceId
  trip: Trip | null
  query: string
  route: [number, number][] | null
  following: boolean
}

/** Survives map close. Logo-hold keeps this. X confirm clears the trip, not saved places. */
const mapMemory: MapMemory = {
  selected: 'home',
  trip: null,
  query: '',
  route: null,
  following: true,
}

const DEFAULT_CENTER: [number, number] = [20, 20]
const DEFAULT_ZOOM = 1.6
const EMPTY: RouteData = {type: 'FeatureCollection', features: []}
const ARRIVAL_M = 50

function finiteFix(lat: number, lon: number, heading: number | null | undefined): Fix | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const head = typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 ? heading : null
  return {lat, lon, heading: head}
}

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)))
}

const ROUTE_BLUE = '#3E9BFF'

function hitsFrom(data: unknown): Hit[] {
  const rows = Array.isArray(data) ? data : []
  const next: Hit[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const hit = row as {label?: unknown; lat?: unknown; lon?: unknown}
    const lat = Number(hit.lat)
    const lon = Number(hit.lon)
    const label = typeof hit.label === 'string' ? hit.label : ''
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    next.push({label, lat, lon})
  }
  return next
}

function lineData(coordinates: [number, number][]): RouteData {
  return {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}}
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


function AddressField({title, saved, onSave}: {title: string; saved: SavedPlace | null; onSave: (place: SavedPlace) => void}) {
  const {t, locale} = useLocale()
  const [draft, setDraft] = useState(saved?.label ?? '')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => { setDraft(saved?.label ?? '') }, [saved?.label])

  useEffect(() => {
    if (!open) return
    const q = draft.trim()
    if (q.length < 2 || q === (saved?.label ?? '')) {
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
          const rows = Array.isArray(data) ? data : []
          const next: Hit[] = []
          for (const row of rows) {
            if (!row || typeof row !== 'object') continue
            const hit = row as {label?: unknown; lat?: unknown; lon?: unknown}
            const lat = Number(hit.lat)
            const lon = Number(hit.lon)
            const label = typeof hit.label === 'string' ? hit.label : ''
            if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
            next.push({label, lat, lon})
          }
          setHits(next)
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
  }, [draft, locale, open, saved?.label])

  return (
    <div className="owned-map-field">
      <p className="owned-map-edit-for">{title}</p>
      <input
        value={draft}
        onChange={event => { setDraft(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={t('Address')}
        aria-label={title}
        autoComplete="off"
        spellCheck={false}
      />
      {open && searching && <p className="owned-map-search-status">{t('Searching…')}</p>}
      {open && !searching && searched && hits.length === 0 && <p className="owned-map-search-status">{t('No addresses found')}</p>}
      {open && hits.length > 0 && (
        <ul className="owned-map-suggest">
          {hits.map(hit => (
            <li key={`${hit.lat},${hit.lon},${hit.label}`}>
              <button type="button" onClick={() => { onSave({lat: hit.lat, lon: hit.lon, label: hit.label}); setDraft(hit.label); setHits([]); setOpen(false) }}>{hit.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MapPage({onClose, speedKmh = null, speedUnit = 'mph', showCore = false}: {onClose: () => void; speedKmh?: number | null; speedUnit?: 'km/h' | 'mph'; showCore?: boolean}) {
  const {t, locale} = useLocale()
  const tesla = useTeslaLocation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const destRef = useRef<Marker | null>(null)
  const followRef = useRef(mapMemory.following)
  const framedRef = useRef(false)
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
  const [draft, setDraft] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [markerKind, setMarkerKind] = useState<MarkerKind>(loadMarkerKind)
  const [trip, setTrip] = useState<Trip | null>(mapMemory.trip)
  const [arrival, setArrival] = useState<Arrival | null>(null)
  const [following, setFollowing] = useState(mapMemory.following)
  const [query, setQuery] = useState(mapMemory.query)
  const [queryHits, setQueryHits] = useState<Hit[]>([])
  const [querySearching, setQuerySearching] = useState(false)
  const [querySearched, setQuerySearched] = useState(false)
  const [queryOpen, setQueryOpen] = useState(false)
  const settingsRef = useRef(false)
  const kindRef = useRef(markerKind)
  const tripRef = useRef<Trip | null>(null)
  const arrivalRef = useRef<Arrival | null>(null)
  const arrivedRef = useRef(false)
  const queryOpenRef = useRef(false)
  const clearAskRef = useRef(false)

  const point: Fix | null = tesla.coordinates
    ? finiteFix(tesla.coordinates.latitude, tesla.coordinates.longitude, tesla.coordinates.heading)
    : fix

  pointRef.current = point
  teslaOnRef.current = tesla.enabled
  editingRef.current = editing
  settingsRef.current = settingsOpen
  kindRef.current = markerKind
  tripRef.current = trip
  arrivalRef.current = arrival
  queryOpenRef.current = queryOpen
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
      if (settingsRef.current) { setSettingsOpen(false); return }
      if (clearAskRef.current) { setClearAsk(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    routeSeq.current += 1
    arrivedRef.current = true
    paintRoute(EMPTY)
    showDestination(null)
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
          const next = finiteFix(position.coords.latitude, position.coords.longitude, position.coords.heading)
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
    arrivedRef.current = false
    arrivalRef.current = null
    setArrival(null)
    setHint(null)
    paintRoute(EMPTY)
    showDestination(null)
  }

  async function navigate(id: TripId, place: SavedPlace) {
    if (id !== 'search') setSelected(id)
    setEditing(false)
    arrivedRef.current = false
    arrivalRef.current = null
    setArrival(null)
    const seq = ++routeSeq.current
    const nextTrip = {id, place}
    mapMemory.trip = nextTrip
    tripRef.current = nextTrip
    setTrip(nextTrip)
    followRef.current = true
    setFollowing(true)
    framedRef.current = false
    showDestination(place)
    const known = pointRef.current
    if (known) {
      const straight = directLine(known, place)
      routeCoordsRef.current = straight
      mapMemory.route = straight
      paintRoute(lineData(straight))
      const map = mapRef.current
      if (map) {
        framedRef.current = true
        map.easeTo({center: [known.lon, known.lat], zoom: Math.max(map.getZoom(), 15), duration: 700})
      }
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
    const framed = mapRef.current
    if (framed && followRef.current) {
      framedRef.current = true
      framed.easeTo({center: [origin.lon, origin.lat], zoom: Math.max(framed.getZoom(), 15), duration: 700})
    }
    try {
      const response = await fetch(`/api/route?from=${origin.lon},${origin.lat}&to=${place.lon},${place.lat}`)
      const body = await response.json() as {geometry?: {type?: string; coordinates?: unknown}}
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
      const here = pointRef.current ?? origin
      paintRoute(lineData(sliceRoute(coordinates, here.lat, here.lon)))
    } catch {
      if (seq !== routeSeq.current) return
    }
  }

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const map = new Map({
      container: el,
      style: satelliteStyle,
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
    map.addControl(new NavigationControl({showCompass: false, visualizePitch: false}), 'bottom-left')
    map.touchZoomRotate.enableRotation()
    map.dragRotate.enable()
    map.touchPitch.enable()
    const pin = document.createElement('div')
    const initialKind = kindRef.current
    pin.className = `owned-map-pin${initialKind === 'dot' ? ' is-puck' : ' is-vehicle'}`
    pin.dataset.kind = initialKind
    pin.innerHTML = markerMarkup(initialKind)
    const marker = new Marker({element: pin, anchor: 'center'})
    const destEl = document.createElement('div')
    destEl.className = 'owned-map-dest'
    destEl.innerHTML = '<span></span>'
    const dest = new Marker({element: destEl, anchor: 'center'})
    const flush = () => flushRef.current()
    map.on('style.load', flush)
    map.on('idle', flush)
    // Only a real finger/mouse pan stops follow. easeTo also moves the camera and must not.
    map.on('dragstart', (event) => {
      if (!event.originalEvent) return
      followRef.current = false
      setFollowing(false)
    })
    map.on('click', (event) => {
      const target = event.originalEvent?.target
      if (target instanceof Element && target.closest('.maplibregl-ctrl, button, a, input, select, textarea')) return
      setSettingsOpen(false)
      setQueryOpen(false)
      setEditing(false)
      setClearAsk(false)
      if (arrivalRef.current) dismissArrival()
    })
    const resize = () => map.resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    mapRef.current = map
    markerRef.current = marker
    destRef.current = dest
    flush()
    const active = tripRef.current
    const coords = routeCoordsRef.current
    if (active && coords && coords.length >= 2) {
      showDestination(active.place)
      const here = pointRef.current
      paintRoute(lineData(here ? sliceRoute(coords, here.lat, here.lon) : coords))
    } else if (active) {
      void navigate(active.id, active.place)
    }
    return () => {
      observer.disconnect()
      marker.remove()
      dest.remove()
      map.remove()
      mapRef.current = null
      markerRef.current = null
      destRef.current = null
    }
  }, [])

  useEffect(() => {
    if (tesla.enabled) return
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      position => {
        const next = finiteFix(position.coords.latitude, position.coords.longitude, position.coords.heading)
        if (next) setFix(next)
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
    mapMemory.trip = trip
    if (!trip) mapMemory.route = null
  }, [selected, query, following, trip])

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
          const rows = Array.isArray(data) ? data : []
          const next: Hit[] = []
          for (const row of rows) {
            if (!row || typeof row !== 'object') continue
            const hit = row as {label?: unknown; lat?: unknown; lon?: unknown}
            const lat = Number(hit.lat)
            const lon = Number(hit.lon)
            const label = typeof hit.label === 'string' ? hit.label : ''
            if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
            next.push({label, lat, lon})
          }
          setHits(next)
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
          const rows = Array.isArray(data) ? data : []
          const next: Hit[] = []
          for (const row of rows) {
            if (!row || typeof row !== 'object') continue
            const hit = row as {label?: unknown; lat?: unknown; lon?: unknown}
            const lat = Number(hit.lat)
            const lon = Number(hit.lon)
            const label = typeof hit.label === 'string' ? hit.label : ''
            if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
            next.push({label, lat, lon})
          }
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
    const active = tripRef.current
    if (active && !arrivalRef.current && metersBetween(lat, lon, active.place.lat, active.place.lon) <= ARRIVAL_M) {
      showArrival(active.place)
    }
    const lngLat: [number, number] = [lon, lat]
    const headed = heading != null && heading >= 0
    marker.setLngLat(lngLat).setRotation(headed ? heading : 0)
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
    if (!followRef.current) return
    if (!framedRef.current) {
      framedRef.current = true
      map.easeTo({center: lngLat, zoom: 15, duration: 700})
    } else {
      map.easeTo({center: lngLat, duration: 400})
    }
  }, [lat, lon, heading, following])

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

  function commitPlace(id: PlaceId, place: SavedPlace) {
    const next = savePlace(id, place)
    setPlaces(next)
    if (tripRef.current?.id === id) void navigate(id, place)
  }

  function openEditor(id: PlaceId) {
    setSelected(id)
    setDraft('')
    setHits([])
    setSearched(false)
    setSearching(false)
    setHint(null)
    setSettingsOpen(false)
    setEditing(true)
  }

  function recenter() {
    followRef.current = true
    setFollowing(true)
    const map = mapRef.current
    const go = (next: Fix) => {
      if (!mapRef.current) return
      mapRef.current.easeTo({center: [next.lon, next.lat], zoom: Math.max(mapRef.current.getZoom(), 15), duration: 600})
    }
    if (pointRef.current) { go(pointRef.current); return }
    if (!map) return
    void locate().then(next => { if (next) go(next) })
  }

  function onPlace(id: PlaceId) {
    const place = places[id]
    if (!place) { openEditor(id); return }
    void navigate(id, place)
  }

  function choose(hit: Hit) {
    const place: SavedPlace = {lat: hit.lat, lon: hit.lon, label: hit.label}
    setPlaces(savePlace(selected, place))
    setEditing(false)
    setHits([])
    void navigate(selected, place)
  }

  function goToQuery(hit: Hit) {
    setQuery(hit.label)
    setQueryHits([])
    setQueryOpen(false)
    setQuerySearched(false)
    hitsQueryRef.current = hit.label
    setEditing(false)
    void navigate('search', {lat: hit.lat, lon: hit.lon, label: hit.label})
  }

  async function goFromSearch() {
    const q = query.trim()
    if (q.length < 2) return
    let hit = hitsQueryRef.current === q ? queryHits[0] : undefined
    if (!hit) {
      setQueryOpen(true)
      setQuerySearching(true)
      try {
        const params = new URLSearchParams({q, lang: locale})
        const response = await fetch(`/api/geocode?${params}`)
        const next = hitsFrom(response.ok ? await response.json() as unknown : [])
        if (query.trim() !== q) return
        setQueryHits(next)
        setQuerySearched(true)
        hitsQueryRef.current = q
        hit = next[0]
      } catch {
        if (query.trim() !== q) return
        setQueryHits([])
        setQuerySearched(true)
        return
      } finally {
        setQuerySearching(false)
      }
    }
    if (!hit) return
    goToQuery(hit)
  }

  const homeOn = trip ? trip.id === 'home' : editing && selected === 'home'
  const workOn = trip ? trip.id === 'work' : editing && selected === 'work'
  const [holding, setHolding] = useState(false)
  const [clearAsk, setClearAsk] = useState(false)
  clearAskRef.current = clearAsk
  const mapCore = useTeslaCoreInteraction({enabled: showCore, onLongPress: onClose, longPressMs: 1000})
  function startHold(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return
    setHolding(true)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* already released */ }
    mapCore.onPointerDown(event)
  }
  function moveHold(event: ReactPointerEvent<HTMLButtonElement>) {
    mapCore.onPointerMove(event)
  }
  function endHold(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setHolding(false)
    mapCore.onPointerUp(event)
  }
  function cancelHold(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setHolding(false)
    mapCore.onPointerCancel(event)
  }

  return (
    <section className="owned-map" role="dialog" aria-modal="true" aria-label={t('Map')}>
      <div ref={canvasRef} className="owned-map-canvas" />
      <div className="owned-map-places">
        <form className="owned-map-search" role="search" onSubmit={event => { event.preventDefault(); void goFromSearch() }}>
          <div className="owned-map-search-row">
          <input
            value={query}
            onChange={event => { setQuery(event.target.value); setQueryOpen(true) }}
            onFocus={() => setQueryOpen(true)}
            placeholder={t('Search address')}
            aria-label={t('Search address')}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="owned-map-go">{t('GO')}</button>
          </div>
          {queryOpen && querySearching && <p className="owned-map-search-status">{t('Searching…')}</p>}
          {queryOpen && !querySearching && querySearched && queryHits.length === 0 && <p className="owned-map-search-status">{t('No addresses found')}</p>}
          {queryOpen && queryHits.length > 0 && (
            <ul className="owned-map-suggest">
              {queryHits.map(hit => (
                <li key={`${hit.lat},${hit.lon},${hit.label}`}>
                  <button type="button" onClick={() => goToQuery(hit)}>{hit.label}</button>
                </li>
              ))}
            </ul>
          )}
        </form>
        <div className="owned-map-places-bar">
          <button type="button" className={`owned-map-pill${homeOn ? ' is-on' : ''}`} aria-pressed={homeOn} onClick={() => onPlace('home')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.5 10.6 12 4.2l7.5 6.4V20a1 1 0 0 1-1 1h-4.2v-5.2H9.7V21H5.5a1 1 0 0 1-1-1v-9.4z"/></svg>
            <span>{t('HOME')}</span>
          </button>
          <button type="button" className={`owned-map-pill${workOn ? ' is-on' : ''}`} aria-pressed={workOn} onClick={() => onPlace('work')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 4.5h6a1.5 1.5 0 0 1 1.5 1.5V7H19a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5V6A1.5 1.5 0 0 1 9 4.5zM9.5 7h5V6h-5v1z"/></svg>
            <span>{t('WORK')}</span>
          </button>
        </div>
        {editing && (
          <form className="owned-map-edit" onSubmit={event => event.preventDefault()}>
            <p className="owned-map-edit-for">{t(selected === 'home' ? 'HOME' : 'WORK')}</p>
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
        {hint && !editing && <p className="owned-map-hint">{t(hint)}</p>}
      </div>
      {showCore && (
        <button
          type="button"
          className={`owned-map-core${holding ? ' is-holding' : ''}`}
          aria-label={t('Hold to close the map')}
          onPointerDown={startHold}
          onPointerMove={moveHold}
          onPointerUp={endHold}
          onPointerCancel={cancelHold}
          onClickCapture={mapCore.onClickCapture}
          onContextMenu={event => event.preventDefault()}
        >
          <IntelligenceOrb
            linkTesla
            teslaHomeVisible={false}
            teslaSpeedKmh={speedKmh}
            teslaUnit={speedUnit}
            teslaSpinning={mapCore.spinning}
            teslaSettling={mapCore.settling}
            teslaSpinMs={mapCore.spinMs}
            teslaSpinKey={mapCore.spinKey}
            onTeslaSpinEnd={mapCore.onSpinEnd}
          />
        </button>
      )}
      {arrival && (
        <div className="owned-map-arrival" role="status" aria-live="polite">
          <button type="button" className="owned-map-arrival-x" aria-label={t('Close')} onClick={dismissArrival}>×</button>
          <h2>{t('You are at this place')}</h2>
          <p>{arrival.label}</p>
          <div className="owned-map-arrival-count" aria-hidden="true">{arrival.left}</div>
        </div>
      )}
      <div className="owned-map-dock">
      {settingsOpen && (
        <div className="owned-map-settings" role="dialog" aria-label={t('Map Settings')}>
          <AddressField title={t('HOME')} saved={places.home} onSave={place => commitPlace('home', place)} />
          <AddressField title={t('WORK')} saved={places.work} onSave={place => commitPlace('work', place)} />
          <label className="owned-map-marker-pick">
            <span>{t('GPS icon')}</span>
            <select
              value={markerKind}
              aria-label={t('GPS icon')}
              onChange={event => setMarkerKind(saveMarkerKind(event.target.value as MarkerKind))}
            >
              <option value="dot">{t('Default')}</option>
              <option value="model3">Model 3</option>
              <option value="modely">Model Y</option>
              <option value="models">Model S</option>
              <option value="cybertruck">Cybertruck</option>
            </select>
          </label>
        </div>
      )}
      <button type="button" className={`owned-map-pill owned-map-gps${following ? ' is-on' : ''}`} aria-pressed={following} aria-label={t('GPS')} onClick={recenter}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.6 20.2 20.2c.35.78-.48 1.55-1.24 1.16L12 17.7l-6.96 3.66c-.76.39-1.59-.38-1.24-1.16L12 2.6z"/></svg>
      </button>
      <button type="button" className={`owned-map-pill owned-map-settings-btn${settingsOpen ? ' is-on' : ''}`} aria-expanded={settingsOpen} onClick={() => { setEditing(false); setSettingsOpen(open => !open) }}>{t('Map Settings')}</button>
      </div>
      {trip && (
        <button type="button" className="owned-map-cancel" onClick={cancelRoute}>{t('Cancel')}</button>
      )}
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
