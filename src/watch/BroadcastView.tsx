import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../i18n/Locale'
export function BroadcastView({ stream, broadcasting, volume }: { stream: MediaStream | null; broadcasting: boolean; volume: number }) {
  const { t } = useLocale()
  const video = useRef<HTMLVideoElement>(null)
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    const element = video.current
    if (!element) return
    let cancelled = false
    element.srcObject = stream; setBlocked(false)
    if (stream) void element.play().catch(() => { if (!cancelled) setBlocked(true) })
    return () => { cancelled = true; element.srcObject = null }
  }, [stream])
  useEffect(() => { if (video.current) video.current.volume = volume }, [volume])
  return <div className="watch-broadcast-view">
    <video ref={video} autoPlay playsInline disablePictureInPicture tabIndex={-1} />
    {!stream && <div className="watch-broadcast-wait">{t(broadcasting ? 'Connecting to the host broadcast…' : 'Waiting for the host to start broadcasting. You can chat or send a voice reaction.')}</div>}
    {blocked && <button className="modal-btn watch-broadcast-enable" onClick={() => void video.current?.play().then(() => setBlocked(false)).catch(() => {})}>{t('Enable broadcast playback')}</button>}
  </div>
}
