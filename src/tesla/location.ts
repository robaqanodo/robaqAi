import {useSyncExternalStore} from 'react'
type LocationState={coordinates:GeolocationCoordinates|null;status:string;enabled:boolean;speedKmh:number|null}
let state:LocationState={coordinates:null,status:'Location is off',enabled:false,speedKmh:null}
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
 const start=(highAccuracy:boolean)=>{
  const version=++watchVersion
  if(watch!==null)navigator.geolocation.clearWatch(watch)
  watch=null
  try{watch=navigator.geolocation.watchPosition(position=>{
   if(current!==generation||version!==watchVersion)return
   attempts=0
   const {speed}=position.coords
   const age=Date.now()-position.timestamp,fresh=age>=-5000&&age<=15000
   update({coordinates:fresh?position.coords:null,status:fresh?'Location enabled':'Waiting for a fresh location…',speedKmh:fresh&&typeof speed==='number'&&Number.isFinite(speed)&&speed>=0?speed*3.6:null})
   clearTimeout(expiry)
   expiry=setTimeout(()=>{if(current===generation)update({coordinates:null,speedKmh:null,status:'Waiting for a fresh location…'})},Math.max(0,15000-age))
  },error=>{
   if(current!==generation||version!==watchVersion)return
   clearTimeout(expiry);update({coordinates:null,speedKmh:null})
   if(error.code===1){stopTeslaLocation();update({status:'Location blocked. Allow location for robaq.app in your browser, then try again.'});return}
   if(watch!==null)navigator.geolocation.clearWatch(watch)
   watch=null;watchVersion++
   if(++attempts<=3){update({status:error.code===3?'Location timed out. Retrying…':'Location signal unavailable. Retrying…'});retry=setTimeout(()=>{if(current===generation)start(false)},2000*attempts)}
   else{stopTeslaLocation();update({status:'The browser is not providing location. Check its location permission and try again.'})}
  },{enableHighAccuracy:highAccuracy,timeout:30000,maximumAge:0})}catch{stopTeslaLocation();update({status:'This browser does not provide location access.'})}
 }
 start(true)
}
