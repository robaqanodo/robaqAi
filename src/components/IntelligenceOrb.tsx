import { providerThemeClass, type ProviderId } from '../providers'
import './IntelligenceOrb.css'

type OrbProps = {
  hasApiKey?: boolean
  provider?: ProviderId | null
  listening?: boolean
  speaking?: boolean
  thinking?: boolean
  responding?: boolean
  voiceLevel?: number
  subtitle?: string
  connectionIndicator?: boolean
  birdCount?: number
  birdPalette?: 'default' | 'rainbow' | 'gold' | 'purple' | 'green' | 'mixed'
  birdColors?: string[]
  movieSyncActive?: boolean
  guestCount?: number
}

export function orbStateLabel(state: OrbProps) {
  if (state.speaking) return 'Speaking'
  if (state.thinking) return 'Thinking'
  if (state.listening) return 'Listening'
  if (state.responding) return 'Responding'
  return state.hasApiKey ? 'Ready' : 'Offline'
}

/** Original living-cell layers and morphing animations from App.css. */
export function IntelligenceOrb(props: OrbProps) {
  const state = orbStateLabel(props).toLowerCase()
  const theme = props.hasApiKey ? providerThemeClass(props.provider ?? null) : ''
  const satellites = [...(props.birdColors ?? ['stock', 'stock']), ...(props.movieSyncActive ? ['movie'] : [])]
  const activeSatellites = satellites.filter(kind => kind !== 'stock')
  return (
    <span
      className={`living-cell intelligence-orb${props.hasApiKey ? ' has-api-key' : ''}${theme ? ` ${theme}` : ''}${props.speaking ? ' is-speaking' : ''}${props.listening ? ' is-listening' : ''}`}
      data-state={state}
      data-provider={props.hasApiKey ? props.provider ?? 'neutral' : 'neutral'}
      data-connection={props.connectionIndicator ? (props.hasApiKey ? 'ready' : 'offline') : undefined}
      style={{ ['--voice-level' as string]: String(Math.max(0, Math.min(1, props.voiceLevel ?? 0))) }}
      aria-hidden="true"
    >
      <span className="capability-orbits">{satellites.map((kind, index) => <span key={kind + index} className={`capability-satellite satellite-${kind}`} style={{ ['--satellite-angle' as string]: `${kind === 'stock' ? 90 + index * 180 : activeSatellites.indexOf(kind) * 360 / Math.max(1, activeSatellites.length)}deg` }}><svg viewBox="0 0 24 24">{kind === 'movie' ? <><rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 5 3-5 3Z"/></> : kind === 'translator' ? <path d="M3 5h11M8 2v3m4 0c0 6-5 9-9 10m2-8c1 4 4 6 7 7m1 7 4-11 4 11m-6-4h4"/> : <><circle cx="12" cy="12" r="7"/><circle className="satellite-highlight" cx="9" cy="9" r="2"/></>}</svg></span>)}</span>
      <span className="guest-orbits">{Array.from({ length: props.guestCount ?? 0 }, (_, index) => <span className="guest-seed" key={index} style={{ ['--satellite-angle' as string]: `${index * 360 / Math.max(1, props.guestCount ?? 0)}deg` }} />)}</span>
      <span className="cell-ring cell-ring-outer" />
      <span className="cell-ring cell-ring-inner" />
      <span className="cell-blob" />
      <span className="cell-blob cell-blob-b" />
      {props.connectionIndicator
        ? <span className="cell-status-light" />
        : <span className="cell-nucleus" />}
      {props.hasApiKey && <span className="cell-api-glow" />}
    </span>
  )
}
