import {useSyncExternalStore} from 'react'

type LocationState={coordinates:GeolocationCoordinates|null;status:string;enabled:boolean;speedKmh:number|null;permission:string}
type Fix={lat:number;lon:number;t:number;accuracy:number}

let state:LocationState={coordinates:null,status:'Location is off',enabled:false,speedKmh:null,permission:'unknown'}
let watch:number|null=null,expiry:ReturnType<typeof setTimeout>|undefined,generation=0
let prevFix:Fix|null=null,smoothedKmh:number|null=null
const listeners=new Set<()=>void>()

const EARTH_M=6371000
/** Fixes worse than this are not a position. Car browsers often report 30–150m. */
const REJECT_ACCURACY_M=3000
const ASSUMED_ACCURACY_M=40
const MIN_DT_S=0.75
/** Same window TeslaNav uses before a fix pair is too old to describe motion. */
const MAX_DT_S=30
const MAX_PLAUSIBLE_KMH=260
const SMOOTH_ALPHA=0.45
/** Native m/s above this is a real speed reading (phone / Tesla). At or below, trust position deltas. */
const MIN_NATIVE_SPEED_MS=0.4
const FRESH_MS=30_000
/**
 * TeslaNav's in-car watch: high accuracy, no cached fix, 10s timeout.
 * It primes with getCurrentPosition, then leaves watchPosition running.
 * It never clears that watch on timeout or on an old timestamp.
 * Restarting the watch (or polling getCurrentPosition) freezes Tesla's browser.
 */
const WATCH_TIMEOUT_MS=10_000
const WATCH_MAXIMUM_AGE_MS=0

function update(next:Partial<LocationState>){state={...state,...next};listeners.forEach(fn=>fn())}
function resetSpeedTracking(){prevFix=null;smoothedKmh=null}

export function useTeslaLocation(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb)}},()=>state)}

export function haversineMeters(lat1:number,lon1:number,lat2:number,lon2:number){
 const r=Math.PI/180
 const dLat=(lat2-lat1)*r,dLon=(lon2-lon1)*r
 const a=Math.sin(dLat/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLon/2)**2
 return 2*EARTH_M*Math.asin(Math.min(1,Math.sqrt(a)))
}

function watchOptions(highAccuracy:boolean):PositionOptions{
 return {enableHighAccuracy:highAccuracy,timeout:WATCH_TIMEOUT_MS,maximumAge:WATCH_MAXIMUM_AGE_MS}
}

/**
 * Prefer native coords.speed (m/s → km/h) when the browser reports real motion.
 * Tesla's browser often leaves speed null or stuck at 0 while latitude/longitude move.
 * Then km/h comes from the displacement since the last anchor, the same idea TeslaNav uses
 * to accept a fix pair (movement over 0–30s) — applied to speed, not heading.
 * The anchor is held while the move is still inside GPS noise so slow steps add up.
 */
export function resolveSpeedKmh(
 nativeSpeedMs:number|null|undefined,
 lat:number,
 lon:number,
 timestamp:number,
 accuracy:number|null|undefined,
 prev:Fix|null,
 previousSmoothed:number|null,
):{speedKmh:number|null;prev:Fix|null;smoothed:number|null}{
 const next:Fix={lat,lon,t:timestamp,accuracy:typeof accuracy==='number'&&Number.isFinite(accuracy)&&accuracy>=0?accuracy:ASSUMED_ACCURACY_M}
 const nativeOk=typeof nativeSpeedMs==='number'&&Number.isFinite(nativeSpeedMs)&&nativeSpeedMs>=0
 if(nativeOk&&nativeSpeedMs>MIN_NATIVE_SPEED_MS){
  const raw=nativeSpeedMs*3.6
  return {speedKmh:raw,prev:next,smoothed:raw}
 }
 if(!prev){
  if(nativeOk)return {speedKmh:0,prev:next,smoothed:null}
  return {speedKmh:null,prev:next,smoothed:null}
 }
 const dt=(timestamp-prev.t)/1000
 if(!Number.isFinite(dt)||dt<=0)return {speedKmh:nativeOk?0:previousSmoothed,prev,smoothed:nativeOk?null:previousSmoothed}
 if(dt<MIN_DT_S)return {speedKmh:nativeOk?0:previousSmoothed,prev,smoothed:nativeOk?null:previousSmoothed}
 if(dt>MAX_DT_S)return {speedKmh:nativeOk?0:null,prev:next,smoothed:null}
 if(next.accuracy>REJECT_ACCURACY_M||prev.accuracy>REJECT_ACCURACY_M)return {speedKmh:nativeOk?0:previousSmoothed,prev:next,smoothed:nativeOk?null:previousSmoothed}
 const dist=haversineMeters(prev.lat,prev.lon,lat,lon)
 // Floor stays under a short walking step (~2m). Do not scale it with coarse accuracy
 // or a 100m Tesla fix hides walking. Sub-meter jitter still stays put.
 const noise=Math.min(1.5,Math.max(0.4,Math.min(next.accuracy,prev.accuracy)*0.008))
 if(dist<=noise){
  if(dt>8||nativeOk)return {speedKmh:0,prev:dt>8?next:prev,smoothed:null}
  return {speedKmh:previousSmoothed,prev,smoothed:previousSmoothed}
 }
 const raw=(dist/dt)*3.6
 if(!Number.isFinite(raw)||raw<0||raw>MAX_PLAUSIBLE_KMH)return {speedKmh:nativeOk?0:previousSmoothed,prev:next,smoothed:nativeOk?null:previousSmoothed}
 const smoothed=previousSmoothed==null?raw:previousSmoothed*(1-SMOOTH_ALPHA)+raw*SMOOTH_ALPHA
 return {speedKmh:smoothed,prev:next,smoothed}
}

export function stopTeslaLocation(){generation++;if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;clearTimeout(expiry);resetSpeedTracking();update({coordinates:null,status:'Location is off',enabled:false,speedKmh:null})}

export function enableTeslaLocation(){
 if(state.enabled)return
 if(!navigator.geolocation){update({status:'This browser does not provide location access.'});return}
 if(window.isSecureContext===false){update({status:'Location requires HTTPS. Open https://www.robaq.app.'});return}
 const current=++generation
 resetSpeedTracking()
 update({enabled:true,status:'Waiting for location…'})
 if(navigator.permissions?.query)void navigator.permissions.query({name:'geolocation'}).then(result=>{if(current===generation)update({permission:result.state})}).catch(()=>{})
 const hideStaleSpeed=()=>{
  clearTimeout(expiry)
  expiry=setTimeout(()=>{if(current===generation)update({speedKmh:null})},FRESH_MS)
 }
 const options=watchOptions(true)
 const receive=(position:GeolocationPosition)=>{
  if(current!==generation)return
  const native=position.coords.speed
  const nativeUsable=typeof native==='number'&&Number.isFinite(native)&&native>=0
  const {latitude,longitude,accuracy}=position.coords
  // TeslaNav stores the sample as-is, including a cached timestamp. Tesla's browser
  // often reports a live speed on a timestamp older than 15s. Rejecting that showed
  // nothing in the car while the phone (fresh timestamps) still worked.
  let timestamp=position.timestamp
  if(!Number.isFinite(timestamp)||(prevFix!==null&&timestamp<=prevFix.t))timestamp=Date.now()
  const resolved=resolveSpeedKmh(nativeUsable?native:null,latitude,longitude,timestamp,accuracy,prevFix,smoothedKmh)
  prevFix=resolved.prev
  smoothedKmh=resolved.smoothed
  update({coordinates:position.coords,status:'Location enabled',permission:'granted',speedKmh:resolved.speedKmh})
  hideStaleSpeed()
 }
 const fail=(error:GeolocationPositionError)=>{
  if(current!==generation)return
  if(error.code===1){stopTeslaLocation();update({permission:'denied',status:'Location blocked. Allow location for robaq.app in your browser, then try again.'});return}
  // TeslaNav's error callback only sets a message. watchPosition keeps running and
  // later success callbacks still arrive. clearWatch here is what made Tesla go quiet.
  update({status:error.code===3?'Location timed out. Still watching…':'Location signal unavailable. Still watching…'})
 }
 try{
  navigator.geolocation.getCurrentPosition?.(receive,fail,options)
  watch=navigator.geolocation.watchPosition(receive,fail,options)
 }catch{stopTeslaLocation();update({status:'This browser does not provide location access.'})}
}
