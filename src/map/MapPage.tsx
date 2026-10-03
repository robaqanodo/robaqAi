import {useEffect, useRef, useState} from 'react'
import {Map, Marker, NavigationControl} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {useLocale} from '../i18n/Locale'
import {useTeslaLocation} from '../tesla/location'
import {satelliteStyle} from './style'
import './map.css'

type Fix = {lat: number; lon: number; heading: number | null}

const DEFAULT_CENTER: [number, number] = [20, 20]
const DEFAULT_ZOOM = 1.6

export function MapPage({onClose}: {onClose: () => void}) {
  const {t} = useLocale()
  const tesla = useTeslaLocation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const followRef = useRef(true)
  const framedRef = useRef(false)
  const [fix, setFix] = useState<Fix | null>(null)
  const point: Fix | null = tesla.coordinates
    ? {
        lat: tesla.coordinates.latitude,
        lon: tesla.coordinates.longitude,
        heading: typeof tesla.coordinates.heading === 'number' && Number.isFinite(tesla.coordinates.heading) ? tesla.coordinates.heading : null,
      }
    : fix

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    const pin = document.createElement('div')
    pin.className = 'owned-map-pin'
    pin.innerHTML = '<span class="owned-map-heading"></span><span class="owned-map-dot"></span>'
    const marker = new Marker({element: pin, anchor: 'center'})
    map.on('dragstart', () => { followRef.current = false })
    const resize = () => map.resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    mapRef.current = map
    markerRef.current = marker
    return () => {
      observer.disconnect()
      marker.remove()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (tesla.enabled) return
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      position => {
        const heading = position.coords.heading
        setFix({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          heading: typeof heading === 'number' && Number.isFinite(heading) ? heading : null,
        })
      },
      () => {},
      {enableHighAccuracy: true, maximumAge: 5000, timeout: 12000},
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [tesla.enabled])

  const lat = point?.lat
  const lon = point?.lon
  const heading = point?.heading ?? null
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker || lat == null || lon == null) return
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    const lngLat: [number, number] = [lon, lat]
    const headed = heading != null && heading >= 0
    marker.setLngLat(lngLat).setRotation(headed ? heading : 0)
    marker.getElement().classList.toggle('is-headed', headed)
    if (!marker.getElement().isConnected) marker.addTo(map)
    if (!followRef.current) return
    if (!framedRef.current) {
      framedRef.current = true
      map.easeTo({center: lngLat, zoom: 15, duration: 700})
    } else {
      map.easeTo({center: lngLat, duration: 350})
    }
  }, [lat, lon, heading])

  return (
    <section className="owned-map" role="dialog" aria-modal="true" aria-label={t('Map')}>
      <div ref={canvasRef} className="owned-map-canvas" />
      <button type="button" className="owned-map-close" onClick={onClose} autoFocus>{t('Close')}</button>
    </section>
  )
}
