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
  return (
    <span
      className={`living-cell intelligence-orb${props.hasApiKey ? ' has-api-key' : ''}${theme ? ` ${theme}` : ''}${props.speaking ? ' is-speaking' : ''}${props.listening ? ' is-listening' : ''}`}
      data-state={state}
      data-provider={props.hasApiKey ? props.provider ?? 'neutral' : 'neutral'}
      data-connection={props.connectionIndicator ? (props.hasApiKey ? 'ready' : 'offline') : undefined}
      style={{ ['--voice-level' as string]: String(Math.max(0, Math.min(1, props.voiceLevel ?? 0))) }}
      aria-hidden="true"
    >
      <span className={`bird-flock bird-palette-${props.birdPalette ?? 'default'}`}>{Array.from({length: Math.max(0, props.birdCount ?? 5)}, (_, bird) => <span className={`orb-bird orb-particle${props.birdColors?.[bird] ? ` orb-bird-${props.birdColors[bird]}` : ''}`} key={bird} style={{animationDelay: `${bird * -4.7}s`, animationDuration: `${25 + (bird % 5) * 2}s`}}><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><circle className="particle-highlight" cx="7" cy="7" r="2"/></svg></span>)}</span>
      {props.movieSyncActive && <span className="movie-orbit-flock">{Array.from({ length: 8 }, (_, index) => <span className="movie-orbit" key={index} style={{ animationDelay: `${index * -5.75}s`, animationDuration: `${38 + index * 2}s` }}><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 5 3-5 3Z"/></svg></span>)}</span>}
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
