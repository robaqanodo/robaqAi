import {useSyncExternalStore} from 'react'
type LocationState={coordinates:GeolocationCoordinates|null;status:string;enabled:boolean;speedKmh:number|null}
let state:LocationState={coordinates:null,status:'Location is off',enabled:false,speedKmh:null}
let watch:number|null=null,expiry:ReturnType<typeof setTimeout>|undefined,generation=0
const listeners=new Set<()=>void>()
function update(next:Partial<LocationState>){state={...state,...next};listeners.forEach(fn=>fn())}
export function useTeslaLocation(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb)}},()=>state)}
export function stopTeslaLocation(){generation++;if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;clearTimeout(expiry);update({coordinates:null,status:'Location is off',enabled:false,speedKmh:null})}
export function enableTeslaLocation(){
 if(state.enabled)return
 if(!navigator.geolocation){update({status:'Location unavailable'});return}
 const current=++generation
 update({enabled:true,status:'Waiting for location…'})
 try{watch=navigator.geolocation.watchPosition(position=>{
  if(current!==generation)return
  const {speed}=position.coords
  const fresh=Date.now()-position.timestamp<=15000
  update({coordinates:fresh?position.coords:null,status:fresh?'Location enabled':'Location unavailable',speedKmh:fresh&&typeof speed==='number'&&Number.isFinite(speed)&&speed>=0?speed*3.6:null})
  clearTimeout(expiry)
  expiry=setTimeout(()=>{update({coordinates:null,speedKmh:null,status:'Location unavailable'})},Math.max(0,15000-(Date.now()-position.timestamp)))
 },error=>{if(current!==generation)return;stopTeslaLocation();update({status:error.code===1?'Location permission denied':'Location unavailable'})},{enableHighAccuracy:true,timeout:15000,maximumAge:0})}catch{stopTeslaLocation();update({status:'Location unavailable'})}
}
