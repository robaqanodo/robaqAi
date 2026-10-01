import { useRef, useState } from 'react'
import { useLocale } from '../i18n/Locale'

export type WebsiteFrame = { x: number; y: number; zoom: number; locked: boolean }
export function WebsitePlayer({ url, name, host, frame, save }: { url: string; name: string; host: boolean; frame: WebsiteFrame; save: (frame: WebsiteFrame) => Promise<void> }) {
  const { t } = useLocale()
  const [locked, setLocked] = useState(frame.locked)
  const [position, setPosition] = useState({ x: frame.x, y: frame.y })
  const [zoom, setZoom] = useState(frame.zoom)
  const [moving, setMoving] = useState(false)
  const [saving, setSaving] = useState(false)
  const shown = host ? { ...position, zoom } : frame
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  return <div className="watch-browser">
    <div className="watch-browser-window"><iframe tabIndex={0} title={name} src={url} style={{ left: shown.x, top: shown.y, transform: `scale(${shown.zoom})` }} sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />
    {host && moving && !locked && <div className="watch-browser-drag" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, left: position.x, top: position.y } }} onPointerMove={e => { if (drag.current) setPosition({ x: Math.max(-2400, Math.min(0, drag.current.left + e.clientX - drag.current.x)), y: Math.max(-3000, Math.min(0, drag.current.top + e.clientY - drag.current.y)) }) }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} />}
    {host && !locked && <div className="watch-center-guide" aria-hidden="true"><i /><b /><span /></div>}
    </div>
    {host && <div className="watch-browser-tools">
      <button type="button" disabled={locked} aria-pressed={moving} onClick={() => setMoving(!moving)}>{t(moving ? 'Browse website' : 'Move frame')}</button>
      <input aria-label={t('Website zoom')} type="range" min="0.4" max="1.5" step="0.05" value={zoom} disabled={locked} onChange={e => setZoom(Number(e.target.value))} />
      <button type="button" disabled={locked} onClick={() => { setPosition({ x: 0, y: 0 }); setZoom(1); setMoving(false) }}>{t('Reset')}</button>
      <button type="button" aria-pressed={locked} disabled={saving} onClick={async () => { setSaving(true); try { await save({ ...position, zoom, locked: !locked }); setLocked(!locked); setMoving(false) } catch { /* Parent displays the error; keep editing state. */ } finally { setSaving(false) } }}>{t(locked ? 'Unlock frame' : 'Lock frame')}</button>
    </div>}
  </div>
}
