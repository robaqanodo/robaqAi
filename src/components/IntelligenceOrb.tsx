import {useEffect,useRef,useState} from 'react'
import teslaLogo from '../tesla/assets/tesla-logo.png'
import {attachLinkTeslaRings} from '../tesla/linkTeslaRings'
import { providerThemeClass, type ProviderId } from '../providers'
import './IntelligenceOrb.css'

type OrbProps = {
  teslaUnit?: 'km/h'|'mph'
  teslaSpeedKmh?: number|null
  teslaHomeVisible?: boolean
  teslaSpinning?: boolean
  teslaSettling?: boolean
  teslaSpinMs?: number
  teslaSpinKey?: number
  onTeslaSpinEnd?: () => void
  linkTesla?: boolean
  tesla?: boolean
  memberCount?:number
  modelColor?:string
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
  const [teslaIntroPlayed,setTeslaIntroPlayed]=useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const spinningRef = useRef(false)
  spinningRef.current = Boolean(props.teslaSpinning)
  useEffect(()=>{if(!props.linkTesla)setTeslaIntroPlayed(false)},[props.linkTesla])
  useEffect(()=>{
    if(!props.linkTesla||!rootRef.current)return
    return attachLinkTeslaRings(rootRef.current, ()=>spinningRef.current)
  },[props.linkTesla])
  const state = orbStateLabel(props).toLowerCase()
  const theme = props.hasApiKey ? providerThemeClass(props.provider ?? null) : ''
  const satellites = [...(props.birdColors ?? ['stock', 'stock']), ...(props.movieSyncActive ? ['movie'] : [])]
  const spinMs = Math.max(320, props.teslaSpinMs ?? 3000)
  return (
    <span
      ref={rootRef}
      className={`living-cell intelligence-orb${props.hasApiKey ? ' has-api-key' : ''}${theme ? ` ${theme}` : ''}${props.speaking ? ' is-speaking' : ''}${props.listening ? ' is-listening' : ''}`}
      data-model-active={props.modelColor?'true':undefined}
      data-state={state}
      data-provider={props.hasApiKey ? props.provider ?? 'neutral' : 'neutral'}
      data-connection={props.connectionIndicator ? (props.hasApiKey ? 'ready' : 'offline') : undefined}
      style={{ ['--model-color' as string]:props.modelColor??'#fff', ['--voice-level' as string]: String(Math.max(0, Math.min(1, props.voiceLevel ?? 0))), ['--tesla-spin-ms' as string]: `${spinMs}ms` }}
      aria-hidden="true"
    >
      <span className="capability-orbits">{satellites.map((kind, index) => <span key={kind + index} className={`capability-satellite satellite-${kind}`} style={{ ['--satellite-angle' as string]: `${index * 360 / Math.max(1, satellites.length)}deg` }}><svg viewBox="5 5 14 14"><circle cx="12" cy="12" r="7"/><circle className="satellite-highlight" cx="9" cy="9" r="2"/></svg>{kind==='model-buddy'&&<span className="satellite-buddy"/>}</span>)}</span>
      <span className="guest-orbits">{Array.from({ length: props.guestCount ?? 0 }, (_, index) => <span className="guest-seed firefly-guest" key={index} style={{ ['--satellite-angle' as string]: `${index * 137.508}deg`, ['--firefly-delay' as string]: `${-index*.71}s` }} />)}</span>
      <span className="guest-orbits">{Array.from({length:props.memberCount??0},(_,index)=><span className="guest-seed firefly-member" key={index} style={{['--satellite-angle' as string]:`${index*137.508+45}deg`,['--firefly-delay' as string]:`${-index*.83}s`}}/>)}</span>
      <span className="cell-boundary" />
      <span className="cell-ring cell-ring-outer" />
      <span className="cell-ring cell-ring-inner" />
      <span className="cell-blob" />
      <span className="cell-blob cell-blob-b" />
      {props.connectionIndicator
        ? <span className="cell-status-light" />
        : <span className={`cell-nucleus${props.linkTesla ? ' link-tesla-core' : props.tesla ? ' tesla-nucleus' : ''}${props.linkTesla && props.teslaSpinning ? ' is-core-spinning' : ''}${props.linkTesla && props.teslaSettling ? ' is-core-settling' : ''}`}>
          {props.linkTesla && <><svg key={props.teslaSpinning?`spin-${props.teslaSpinKey??0}`:'logo'} className={`tesla-core-logo${props.teslaHomeVisible!==false&&!teslaIntroPlayed&&!props.teslaSpinning?' is-opening':''}${props.teslaSpinning?' is-spinning':''}`} onAnimationEnd={event=>{if(event.target!==event.currentTarget)return;const name=event.animationName||'';if(props.teslaSpinning&&(name.includes('tesla-logo-orbit')||name.includes('tesla-logo-spin'))){props.onTeslaSpinEnd?.();return}if(!teslaIntroPlayed&&name.includes('tesla-logo-orbit'))setTeslaIntroPlayed(true)}} style={{visibility:typeof props.teslaSpeedKmh==='number'&&props.teslaSpeedKmh>=1?'hidden':'visible'}} viewBox="1000 300 1000 1000" overflow="hidden" aria-hidden="true"><image href={teslaLogo} width="3000" height="2000"/></svg>{typeof props.teslaSpeedKmh==='number'&&props.teslaSpeedKmh>=1&&<span className="tesla-core-speed"><strong>{Math.round(props.teslaSpeedKmh/(props.teslaUnit!=='km/h'?1.609344:1))}</strong><small>GPS · {props.teslaUnit??'mph'}</small></span>}</>}
          {!props.linkTesla && props.tesla && <svg className="tesla-emblem" viewBox="0 0 100 120" focusable="false" aria-hidden="true">
            <path fill="currentColor" d="M8 15 Q50 -3 92 15 L88 24 Q50 9 12 24 Z M16 30 Q50 16 84 30 L78 43 Q66 35 59 35 L50 111 L41 35 Q34 35 22 43 Z"/>
          </svg>}
        </span>}
      {props.hasApiKey && <span className="cell-api-glow" />}
    </span>
  )
}
