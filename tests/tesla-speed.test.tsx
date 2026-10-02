// @vitest-environment jsdom
import {act,cleanup,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {IntelligenceOrb} from '../src/components/IntelligenceOrb'
import {enableTeslaLocation,stopTeslaLocation,useTeslaLocation} from '../src/tesla/location'
let success:PositionCallback
let failure:PositionErrorCallback
const clearWatch=vi.fn()
function Core(){const {speedKmh}=useTeslaLocation();return <IntelligenceOrb linkTesla teslaSpeedKmh={speedKmh} teslaUnit="km/h"/>}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('navigator',{geolocation:{watchPosition:vi.fn((fn:PositionCallback,error:PositionErrorCallback)=>{success=fn;failure=error;return 1}),clearWatch}})})
afterEach(()=>{act(()=>stopTeslaLocation());cleanup();vi.useRealTimers();vi.unstubAllGlobals()})
function position(speed:number|null){return {timestamp:Date.now(),coords:{speed,latitude:0,longitude:0,accuracy:5,altitude:null,altitudeAccuracy:null,heading:null}} as GeolocationPosition}
it('replaces the logo with GPS speed, restores it at rest, and clears stale readings',()=>{const {container}=render(<Core/>);const logo=container.querySelector<SVGElement>('.tesla-core-logo')!;act(()=>enableTeslaLocation());act(()=>success(position(10)));expect(screen.getByText('36')).toBeTruthy();expect(logo.style.visibility).toBe('hidden');act(()=>success(position(0)));expect(container.querySelector('.tesla-core-speed')).toBeNull();expect(logo.style.visibility).toBe('visible');act(()=>success(position(20)));expect(screen.getByText('72')).toBeTruthy();act(()=>vi.advanceTimersByTime(15001));expect(container.querySelector('.tesla-core-speed')).toBeNull();expect(logo.style.visibility).toBe('visible')})
it('never substitutes a fabricated speed and stops watching when disabled',()=>{const {container}=render(<Core/>);act(()=>enableTeslaLocation());act(()=>success(position(null)));expect(container.querySelector('.tesla-core-speed')).toBeNull();act(()=>stopTeslaLocation());expect(clearWatch).toHaveBeenCalledWith(1);act(()=>success(position(50)));expect(container.querySelector('.tesla-core-speed')).toBeNull()})
it('converts km/h to mph without changing the source reading',()=>{render(<IntelligenceOrb linkTesla teslaSpeedKmh={100} teslaUnit="mph"/>);expect(screen.getByText('62')).toBeTruthy();expect(screen.getByText('GPS · mph')).toBeTruthy()})

it('recovers from a timeout with a lower-accuracy watch and accepts real speed',()=>{render(<Core/>);act(()=>enableTeslaLocation());act(()=>failure({code:3} as GeolocationPositionError));act(()=>vi.advanceTimersByTime(2000));expect(navigator.geolocation.watchPosition).toHaveBeenLastCalledWith(expect.any(Function),expect.any(Function),expect.objectContaining({enableHighAccuracy:false}));act(()=>success(position(10)));expect(screen.getByText('36')).toBeTruthy()})
it('does not retry after the user denies location permission',()=>{render(<Core/>);act(()=>enableTeslaLocation());act(()=>failure({code:1} as GeolocationPositionError));act(()=>vi.advanceTimersByTime(60000));expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1)})
it('re-requests a fresh fix when the browser repeatedly returns stale coordinates, then stops',()=>{const {container}=render(<Core/>);act(()=>enableTeslaLocation());for(let attempt=0;attempt<4;attempt++){act(()=>success({...position(25),timestamp:Date.now()-60000}));expect(container.querySelector('.tesla-core-speed')).toBeNull();if(attempt<3)act(()=>vi.advanceTimersByTime(2000*(attempt+1)))}expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(4);act(()=>vi.advanceTimersByTime(120000));expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(4)})
