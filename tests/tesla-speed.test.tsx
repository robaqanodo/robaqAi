// @vitest-environment jsdom
import {act,cleanup,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {IntelligenceOrb} from '../src/components/IntelligenceOrb'
import {enableTeslaLocation,haversineMeters,resolveSpeedKmh,stopTeslaLocation,useTeslaLocation} from '../src/tesla/location'
let success:PositionCallback
let failure:PositionErrorCallback
const clearWatch=vi.fn()
function Core(){const {speedKmh}=useTeslaLocation();return <IntelligenceOrb linkTesla teslaSpeedKmh={speedKmh} teslaUnit="km/h"/>}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('navigator',{geolocation:{watchPosition:vi.fn((fn:PositionCallback,error:PositionErrorCallback)=>{success=fn;failure=error;return 1}),clearWatch}})})
afterEach(()=>{act(()=>stopTeslaLocation());cleanup();vi.useRealTimers();vi.unstubAllGlobals()})
function position(speed:number|null,extra:Partial<GeolocationCoordinates>&{timestamp?:number}={}){
 const {timestamp=Date.now(),...coords}=extra
 return {timestamp,coords:{speed,latitude:0,longitude:0,accuracy:5,altitude:null,altitudeAccuracy:null,heading:null,...coords}} as GeolocationPosition
}
it('replaces the logo with GPS speed, restores it at rest, and clears stale readings',()=>{const {container}=render(<Core/>);const logo=container.querySelector<SVGElement>('.tesla-core-logo')!;act(()=>enableTeslaLocation());act(()=>success(position(10)));expect(screen.getByText('36')).toBeTruthy();expect(logo.style.visibility).toBe('hidden');act(()=>success(position(0)));expect(container.querySelector('.tesla-core-speed')).toBeNull();expect(logo.style.visibility).toBe('visible');act(()=>success(position(20)));expect(screen.getByText('72')).toBeTruthy();act(()=>vi.advanceTimersByTime(30001));expect(container.querySelector('.tesla-core-speed')).toBeNull();expect(logo.style.visibility).toBe('visible')})
it('never substitutes a fabricated speed and stops watching when disabled',()=>{const {container}=render(<Core/>);act(()=>enableTeslaLocation());act(()=>success(position(null)));expect(container.querySelector('.tesla-core-speed')).toBeNull();act(()=>stopTeslaLocation());expect(clearWatch).toHaveBeenCalledWith(1);act(()=>success(position(50)));expect(container.querySelector('.tesla-core-speed')).toBeNull()})
it('converts km/h to mph without changing the source reading',()=>{render(<IntelligenceOrb linkTesla teslaSpeedKmh={100} teslaUnit="mph"/>);expect(screen.getByText('62')).toBeTruthy();expect(screen.getByText('GPS · mph')).toBeTruthy()})

it('recovers from a timeout with a lower-accuracy watch and accepts real speed',()=>{render(<Core/>);act(()=>enableTeslaLocation());act(()=>failure({code:3} as GeolocationPositionError));act(()=>vi.advanceTimersByTime(2000));expect(navigator.geolocation.watchPosition).toHaveBeenLastCalledWith(expect.any(Function),expect.any(Function),expect.objectContaining({enableHighAccuracy:false}));act(()=>success(position(10)));expect(screen.getByText('36')).toBeTruthy()})
it('does not retry after the user denies location permission',()=>{render(<Core/>);act(()=>enableTeslaLocation());act(()=>failure({code:1} as GeolocationPositionError));act(()=>vi.advanceTimersByTime(60000));expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1)})
it('re-requests a fresh fix when the browser repeatedly returns stale coordinates, then stops',()=>{const {container}=render(<Core/>);act(()=>enableTeslaLocation());for(let attempt=0;attempt<4;attempt++){act(()=>success({...position(25),timestamp:Date.now()-60000}));expect(container.querySelector('.tesla-core-speed')).toBeNull();if(attempt<3)act(()=>vi.advanceTimersByTime(2000*(attempt+1)))}expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(4);act(()=>vi.advanceTimersByTime(120000));expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(4)})

it('derives km/h from successive GPS fixes when coords.speed is null',()=>{
 const {container}=render(<Core/>)
 act(()=>enableTeslaLocation())
 const t0=Date.now()
 act(()=>success(position(null,{latitude:41.7,longitude:44.8,timestamp:t0})))
 expect(container.querySelector('.tesla-core-speed')).toBeNull()
 act(()=>vi.advanceTimersByTime(1000))
 // ~0.0001° latitude ≈ 11.1 m in 1 s ≈ 40 km/h
 act(()=>success(position(null,{latitude:41.7001,longitude:44.8,timestamp:Date.now()})))
 expect(screen.getByText('40')).toBeTruthy()
})

it('resolveSpeedKmh prefers native speed and falls back to haversine delta',()=>{
 expect(haversineMeters(0,0,0,0)).toBe(0)
 const native=resolveSpeedKmh(10,0,0,1_000,5,null,null)
 expect(native.speedKmh).toBeCloseTo(36,5)
 const first=resolveSpeedKmh(null,41.7,44.8,1_000,5,null,null)
 expect(first.speedKmh).toBeNull()
 const second=resolveSpeedKmh(null,41.7001,44.8,2_000,5,first.prev,first.smoothed)
 expect(second.speedKmh).toBeGreaterThan(35)
 expect(second.speedKmh).toBeLessThan(45)
 const junk=resolveSpeedKmh(null,41.71,44.8,2_500,5,first.prev,null)
 // dt 0.5s < MIN_DT → keep previous smoothed (null)
 expect(junk.speedKmh).toBeNull()
 const badAcc=resolveSpeedKmh(null,41.7001,44.8,2_000,10_000,first.prev,null)
 expect(badAcc.speedKmh).toBeNull()
 // ~4 km/h walk: 0.00002° ≈ 2.22m. Coarse accuracy must not zero it.
 const walkA=resolveSpeedKmh(null,41.7,44.8,5_000,120,null,null)
 const walkB=resolveSpeedKmh(null,41.70002,44.8,7_000,120,walkA.prev,walkA.smoothed)
 expect(walkB.speedKmh).toBeGreaterThan(3)
 expect(walkB.speedKmh).toBeLessThan(6)
})

it('primes once like TeslaNav and derives walking speed when the browser only moves the fix',()=>{
 const getCurrentPosition=vi.fn()
 navigator.geolocation.getCurrentPosition=getCurrentPosition
 const {container}=render(<Core/>)
 act(()=>enableTeslaLocation())
 const options=expect.objectContaining({enableHighAccuracy:true,maximumAge:0,timeout:10000})
 expect(getCurrentPosition).toHaveBeenCalledTimes(1)
 expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function),expect.any(Function),options)
 expect(navigator.geolocation.watchPosition).toHaveBeenCalledWith(expect.any(Function),expect.any(Function),options)
 act(()=>vi.advanceTimersByTime(5000))
 expect(getCurrentPosition).toHaveBeenCalledTimes(1)
 const deliver=getCurrentPosition.mock.calls[0][0] as PositionCallback
 const t0=Date.now()
 act(()=>deliver(position(null,{latitude:41.7,longitude:44.8,accuracy:100,timestamp:t0-60000})))
 expect(container.querySelector('.tesla-core-speed')).toBeNull()
 act(()=>vi.advanceTimersByTime(2000))
 // ~0.00004° ≈ 4.4m in 2s ≈ 8 km/h. Speed is null and the timestamp is stale — still a walk.
 act(()=>deliver(position(null,{latitude:41.70004,longitude:44.8,accuracy:100,timestamp:Date.now()-60000})))
 expect(screen.getByText('8')).toBeTruthy()
})

it('uses position deltas when Tesla reports speed 0 while the fix is moving',()=>{
 const stopped=resolveSpeedKmh(0,41.7,44.8,10_000,30,null,null)
 expect(stopped.speedKmh).toBe(0)
 const walking=resolveSpeedKmh(0,41.70002,44.8,12_000,30,stopped.prev,stopped.smoothed)
 expect(walking.speedKmh).toBeGreaterThan(3)
 expect(walking.speedKmh).toBeLessThan(6)
})
