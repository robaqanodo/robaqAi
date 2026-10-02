import {useSyncExternalStore} from 'react'

type LocationState={coordinates:GeolocationCoordinates|null;status:string;enabled:boolean;speedKmh:number|null;permission:string}
type Fix={lat:number;lon:number;t:number;accuracy:number}

let state:LocationState={coordinates:null,status:'Location is off',enabled:false,speedKmh:null,permission:'unknown'}
let watch:number|null=null,expiry:ReturnType<typeof setTimeout>|undefined,retry:ReturnType<typeof setTimeout>|undefined,generation=0
let prevFix:Fix|null=null,smoothedKmh:number|null=null
const listeners=new Set<()=>void>()

const EARTH_M=6371000
const MAX_ACCURACY_M=60
const MIN_DT_S=0.75
const MAX_DT_S=10
const MAX_PLAUSIBLE_KMH=260
const SMOOTH_ALPHA=0.4

function update(next:Partial<LocationState>){state={...state,...next};listeners.forEach(fn=>fn())}
function resetSpeedTracking(){prevFix=null;smoothedKmh=null}

export function useTeslaLocation(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb)}},()=>state)}

export function haversineMeters(lat1:number,lon1:number,lat2:number,lon2:number){
 const r=Math.PI/180
 const dLat=(lat2-lat1)*r,dLon=(lon2-lon1)*r
 const a=Math.sin(dLat/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLon/2)**2
 return 2*EARTH_M*Math.asin(Math.min(1,Math.sqrt(a)))
}

/**
 * Prefer native coords.speed (m/s → km/h) when it is a finite number >= 0.
 * Otherwise derive km/h from successive fixes (haversine / Δt) with accuracy,
 * time-gap, plausibility filters and light EMA smoothing.
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
 const next:Fix={lat,lon,t:timestamp,accuracy:typeof accuracy==='number'&&Number.isFinite(accuracy)?accuracy:MAX_ACCURACY_M}
 if(typeof nativeSpeedMs==='number'&&Number.isFinite(nativeSpeedMs)&&nativeSpeedMs>=0){
  const raw=nativeSpeedMs*3.6
  return {speedKmh:raw,prev:next,smoothed:raw}
 }
 if(!prev)return {speedKmh:null,prev:next,smoothed:null}
 const dt=(timestamp-prev.t)/1000
 if(!Number.isFinite(dt)||dt<=0)return {speedKmh:previousSmoothed,prev,smoothed:previousSmoothed}
 if(dt<MIN_DT_S)return {speedKmh:previousSmoothed,prev,smoothed:previousSmoothed}
 if(dt>MAX_DT_S)return {speedKmh:null,prev:next,smoothed:null}
 if(next.accuracy>MAX_ACCURACY_M||prev.accuracy>MAX_ACCURACY_M)return {speedKmh:previousSmoothed,prev:next,smoothed:previousSmoothed}
 const dist=haversineMeters(prev.lat,prev.lon,lat,lon)
 const noise=Math.max(next.accuracy,prev.accuracy,8)*0.45
 let raw=dist<=noise?0:(dist/dt)*3.6
 if(!Number.isFinite(raw)||raw<0||raw>MAX_PLAUSIBLE_KMH)return {speedKmh:previousSmoothed,prev:next,smoothed:previousSmoothed}
 const smoothed=previousSmoothed==null?raw:previousSmoothed*(1-SMOOTH_ALPHA)+raw*SMOOTH_ALPHA
 return {speedKmh:smoothed,prev:next,smoothed}
}

export function stopTeslaLocation(){generation++;if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;clearTimeout(expiry);clearTimeout(retry);resetSpeedTracking();update({coordinates:null,status:'Location is off',enabled:false,speedKmh:null})}

export function enableTeslaLocation(){
 if(state.enabled)return
 if(!navigator.geolocation){update({status:'This browser does not provide location access.'});return}
 if(window.isSecureContext===false){update({status:'Location requires HTTPS. Open https://www.robaq.app.'});return}
 const current=++generation
 let attempts=0,watchVersion=0
 resetSpeedTracking()
 update({enabled:true,status:'Waiting for location…'})
 if(navigator.permissions?.query)void navigator.permissions.query({name:'geolocation'}).then(result=>{if(current===generation)update({permission:result.state})}).catch(()=>{})
 const recover=(status:string)=>{
  clearTimeout(expiry);clearTimeout(retry)
  if(watch!==null)navigator.geolocation.clearWatch(watch)
  watch=null;watchVersion++
  resetSpeedTracking()
  update({coordinates:null,speedKmh:null})
  if(++attempts<=3){update({status});retry=setTimeout(()=>{if(current===generation)start(false)},2000*attempts)}
  else{stopTeslaLocation();update({status:'No fresh location from the browser. More permissions cannot unlock vehicle GPS. Retry location or check the browser location settings.'})}
 }

 const start=(highAccuracy:boolean)=>{
  const version=++watchVersion
  if(watch!==null)navigator.geolocation.clearWatch(watch)
  watch=null
  const receive=(position:GeolocationPosition)=>{
   if(current!==generation||version!==watchVersion)return
   const age=Date.now()-position.timestamp
   if(!Number.isFinite(age)||age< -5000||age>15000){recover('The browser returned an old location. Requesting a fresh fix…');return}
   attempts=0
   const {speed,latitude,longitude,accuracy}=position.coords
   const resolved=resolveSpeedKmh(speed,latitude,longitude,position.timestamp,accuracy,prevFix,smoothedKmh)
   prevFix=resolved.prev
   smoothedKmh=resolved.smoothed
   update({coordinates:position.coords,status:'Location enabled',permission:'granted',speedKmh:resolved.speedKmh})
   clearTimeout(expiry)
   expiry=setTimeout(()=>{if(current===generation&&version===watchVersion)recover('Location updates stopped. Requesting a fresh fix…')},Math.max(0,15000-age))
  }
  const fail=(error:GeolocationPositionError)=>{
   if(current!==generation||version!==watchVersion)return
   clearTimeout(expiry);resetSpeedTracking();update({coordinates:null,speedKmh:null})
   if(error.code===1){stopTeslaLocation();update({permission:'denied',status:'Location blocked. Allow location for robaq.app in your browser, then try again.'});return}
   recover(error.code===3?'Location timed out. Retrying…':'Location signal unavailable. Retrying…')
  }
  try{
   const options={enableHighAccuracy:highAccuracy,timeout:30000,maximumAge:0}
   watch=navigator.geolocation.watchPosition(receive,fail,options)
   // A one-shot request can recover browsers whose existing watch stopped delivering fixes.
   if(attempts>0&&navigator.geolocation.getCurrentPosition)navigator.geolocation.getCurrentPosition(receive,fail,options)
  }catch{stopTeslaLocation();update({status:'This browser does not provide location access.'})}
 }
 start(true)
}
