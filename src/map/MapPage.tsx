import {useEffect, useRef, useState} from 'react'
import {Map, Marker, NavigationControl, type GeoJSONSource} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {useLocale} from '../i18n/Locale'
import {IntelligenceOrb} from '../components/IntelligenceOrb'
import {useTeslaLocation} from '../tesla/location'
import {loadPlaces, savePlace, type PlaceId, type SavedPlace} from './places'
import {loadMarkerKind, markerMarkup, saveMarkerKind, type MarkerKind} from './marker'
import {satelliteStyle} from './style'
import './map.css'

type Fix = {lat: number; lon: number; heading: number | null}
type Hit = {label: string; lat: number; lon: number}
type RouteFeature = {
  type: 'Feature'
  properties: Record<string, never>
  geometry: {type: 'LineString'; coordinates: [number, number][]}
}
type RouteData = RouteFeature | {type: 'FeatureCollection'; features: []}
type Trip = {id: PlaceId; place: SavedPlace}
type Arrival = {label: string; left: number}

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

function ensureRoute(map: Map) {
  if (map.getSource('route')) return
  map.addSource('route', {type: 'geojson', data: EMPTY})
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#0b0b0b', 'line-width': 8, 'line-opacity': 0.92},
  })
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#ffffff', 'line-width': 4},
  })
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
  const followRef = useRef(true)
  const framedRef = useRef(false)
  const pointRef = useRef<Fix | null>(null)
  const teslaOnRef = useRef(false)
  const editingRef = useRef(false)
  const queuedRoute = useRef<RouteData | null>(null)
  const routeSeq = useRef(0)
  const [fix, setFix] = useState<Fix | null>(null)
  const [places, setPlaces] = useState(loadPlaces)
  const [selected, setSelected] = useState<PlaceId>('home')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [markerKind, setMarkerKind] = useState<MarkerKind>(loadMarkerKind)
  const [trip, setTrip] = useState<Trip | null>(null)
  const [arrival, setArrival] = useState<Arrival | null>(null)
  const [following, setFollowing] = useState(true)
  const settingsRef = useRef(false)
  const kindRef = useRef(markerKind)
  const tripRef = useRef<Trip | null>(null)
  const arrivalRef = useRef<Arrival | null>(null)
  const arrivedRef = useRef(false)

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (arrivalRef.current) { dismissArrival(); return }
      if (editingRef.current) { setEditing(false); return }
      if (settingsRef.current) { setSettingsOpen(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function paintRoute(data: RouteData) {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) { queuedRoute.current = data; return }
    ensureRoute(map)
    const source = map.getSource('route') as GeoJSONSource | undefined
    source?.setData(data)
    queuedRoute.current = null
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
    followRef.current = false
    routeSeq.current += 1
    arrivedRef.current = true
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

  async function navigate(id: PlaceId, place: SavedPlace) {
    setSelected(id)
    setEditing(false)
    arrivedRef.current = false
    arrivalRef.current = null
    setArrival(null)
    const seq = ++routeSeq.current
    paintRoute(EMPTY)
    const nextTrip = {id, place}
    tripRef.current = nextTrip
    setTrip(nextTrip)
    followRef.current = true
    showDestination(place)
    if (!pointRef.current) setHint('Waiting for location…')
    const origin = await locate()
    if (seq !== routeSeq.current) return
    if (!origin) { setHint('Waiting for location…'); return }
    if (metersBetween(origin.lat, origin.lon, place.lat, place.lon) <= ARRIVAL_M) {
      setHint(null)
      showArrival(place)
      return
    }
    setHint(null)
    try {
      const response = await fetch(`/api/route?from=${origin.lon},${origin.lat}&to=${place.lon},${place.lat}`)
      const body = await response.json() as {geometry?: {type?: string; coordinates?: [number, number][]}}
      if (seq !== routeSeq.current) return
      const coordinates = body.geometry?.type === 'LineString' ? body.geometry.coordinates : null
      if (!response.ok || !coordinates || coordinates.length < 2) {
        setHint('Route unavailable')
        return
      }
      paintRoute({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}})
      const map = mapRef.current
      if (map && followRef.current) {
        map.easeTo({center: [origin.lon, origin.lat], zoom: Math.max(map.getZoom(), 15), duration: 700})
      }
    } catch {
      if (seq !== routeSeq.current) return
      setHint('Route unavailable')
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
    })
    map.addControl(new NavigationControl({showCompass: false, visualizePitch: false}), 'bottom-left')
    map.touchZoomRotate.disableRotation()
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
    map.dragRotate.disable()
    map.on('dragstart', () => { followRef.current = false; setFollowing(false) })
    map.on('load', () => {
      ensureRoute(map)
      if (queuedRoute.current) {
        const source = map.getSource('route') as GeoJSONSource | undefined
        source?.setData(queuedRoute.current)
        queuedRoute.current = null
      }
    })
    const resize = () => map.resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    mapRef.current = map
    markerRef.current = marker
    destRef.current = dest
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
    if (!followRef.current) return
    if (!framedRef.current) {
      framedRef.current = true
      map.easeTo({center: lngLat, zoom: 15, duration: 700})
    } else {
      map.easeTo({center: lngLat, duration: 350})
    }
  }, [lat, lon, heading])

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
  }

  const homeOn = trip ? trip.id === 'home' : editing && selected === 'home'
  const workOn = trip ? trip.id === 'work' : editing && selected === 'work'

  return (
    <section className="owned-map" role="dialog" aria-modal="true" aria-label={t('Map')}>
      <div ref={canvasRef} className="owned-map-canvas" />
      <div className="owned-map-side">
      <div className="owned-map-places">
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
        <div className="owned-map-core" aria-hidden="true">
          <IntelligenceOrb linkTesla teslaHomeVisible={false} teslaSpeedKmh={speedKmh} teslaUnit={speedUnit} />
        </div>
      )}
      <button type="button" className={`owned-map-pill owned-map-gps${following ? ' is-on' : ''}`} aria-pressed={following} aria-label={t('GPS')} onClick={recenter}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.6 20.2 20.2c.35.78-.48 1.55-1.24 1.16L12 17.7l-6.96 3.66c-.76.39-1.59-.38-1.24-1.16L12 2.6z"/></svg>
      </button>
      </div>
      {arrival && (
        <div className="owned-map-arrival" role="status" aria-live="polite">
          <button type="button" className="owned-map-arrival-x" aria-label={t('Close')} onClick={dismissArrival}>×</button>
          <h2>{t('You are at this place')}</h2>
          <p>{arrival.label}</p>
          <div className="owned-map-arrival-count" aria-hidden="true">{arrival.left}</div>
        </div>
      )}
      <button type="button" className={`owned-map-pill owned-map-settings-btn${settingsOpen ? ' is-on' : ''}`} aria-expanded={settingsOpen} onClick={() => { setEditing(false); setSettingsOpen(open => !open) }}>{t('Map Settings')}</button>
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
      <button type="button" className="owned-map-close" onClick={onClose}>{t('Close')}</button>
    </section>
  )
}
