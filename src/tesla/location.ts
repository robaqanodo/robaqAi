import {useSyncExternalStore} from 'react'
type LocationState={coordinates:GeolocationCoordinates|null;status:string;enabled:boolean;speedKmh:number|null;permission:string}
let state:LocationState={coordinates:null,status:'Location is off',enabled:false,speedKmh:null,permission:'unknown'}
let watch:number|null=null,expiry:ReturnType<typeof setTimeout>|undefined,retry:ReturnType<typeof setTimeout>|undefined,generation=0
const listeners=new Set<()=>void>()
function update(next:Partial<LocationState>){state={...state,...next};listeners.forEach(fn=>fn())}
export function useTeslaLocation(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb)}},()=>state)}
export function stopTeslaLocation(){generation++;if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;clearTimeout(expiry);clearTimeout(retry);update({coordinates:null,status:'Location is off',enabled:false,speedKmh:null})}
export function enableTeslaLocation(){
 if(state.enabled)return
 if(!navigator.geolocation){update({status:'This browser does not provide location access.'});return}
 if(window.isSecureContext===false){update({status:'Location requires HTTPS. Open https://www.robaq.app.'});return}
 const current=++generation
 let attempts=0,watchVersion=0
 update({enabled:true,status:'Waiting for location…'})
 if(navigator.permissions?.query)void navigator.permissions.query({name:'geolocation'}).then(result=>{if(current===generation)update({permission:result.state})}).catch(()=>{})
 const recover=(status:string)=>{
  clearTimeout(expiry);clearTimeout(retry)
  if(watch!==null)navigator.geolocation.clearWatch(watch)
  watch=null;watchVersion++
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
   const {speed}=position.coords
   update({coordinates:position.coords,status:'Location enabled',permission:'granted',speedKmh:typeof speed==='number'&&Number.isFinite(speed)&&speed>=0?speed*3.6:null})
   clearTimeout(expiry)
   expiry=setTimeout(()=>{if(current===generation&&version===watchVersion)recover('Location updates stopped. Requesting a fresh fix…')},Math.max(0,15000-age))
  }
  const fail=(error:GeolocationPositionError)=>{

   if(current!==generation||version!==watchVersion)return
   clearTimeout(expiry);update({coordinates:null,speedKmh:null})
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
