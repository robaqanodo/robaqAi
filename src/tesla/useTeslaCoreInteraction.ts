import {useCallback,useEffect,useRef,useState,type MouseEvent,type PointerEvent} from 'react'

const RAPID_MS=450
const LONG_PRESS_MS=3000
const MOVE_CANCEL_PX=14
const BASE_SPIN_MS=1100
const SETTLE_MS=1400

function spinDuration(burstSize:number){
  return Math.max(320,Math.round(BASE_SPIN_MS/Math.pow(Math.max(1,burstSize),.65)))
}

type Options={enabled:boolean;onLongPress:()=>void}

/**
 * Connected LinkyourTesla core: rapid-tap spin queue + 3s long-press to open panel.
 * Isolated taps mid-spin are ignored; taps within RAPID_MS of the previous tap grow the queue.
 * Taps still inside the opening rapid window retune the whole burst to a faster speed.
 */
export function useTeslaCoreInteraction({enabled,onLongPress}:Options){
  const [spinning,setSpinning]=useState(false)
  const [settling,setSettling]=useState(false)
  const [spinKey,setSpinKey]=useState(0)
  const [spinMs,setSpinMs]=useState(BASE_SPIN_MS)
  const remaining=useRef(0)
  const burstSize=useRef(0)
  const lastTapAt=useRef(0)
  const burstStartedAt=useRef(0)
  const handledKey=useRef(0)
  const spinKeyRef=useRef(0)
  const settleTimer=useRef(0)
  const longTimer=useRef(0)
  const spinWatch=useRef(0)
  const longFired=useRef(false)
  const pointerId=useRef<number|null>(null)
  const startX=useRef(0)
  const startY=useRef(0)
  const cancelled=useRef(false)
  const onLongPressRef=useRef(onLongPress)
  const advanceRef=useRef<()=>void>(()=>{})
  onLongPressRef.current=onLongPress

  const clearLong=useCallback(()=>{
    if(longTimer.current){window.clearTimeout(longTimer.current);longTimer.current=0}
  },[])

  const clearSettle=useCallback(()=>{
    if(settleTimer.current){window.clearTimeout(settleTimer.current);settleTimer.current=0}
  },[])

  const clearSpinWatch=useCallback(()=>{
    if(spinWatch.current){window.clearTimeout(spinWatch.current);spinWatch.current=0}
  },[])

  useEffect(()=>()=>{clearLong();clearSettle();clearSpinWatch()},[clearLong,clearSettle,clearSpinWatch])

  useEffect(()=>{
    if(enabled)return
    clearLong();clearSettle();clearSpinWatch()
    remaining.current=0;burstSize.current=0;lastTapAt.current=0;burstStartedAt.current=0
    setSpinning(false);setSettling(false);setSpinMs(BASE_SPIN_MS)
  },[enabled,clearLong,clearSettle,clearSpinWatch])

  const beginSettle=useCallback(()=>{
    clearSpinWatch()
    setSpinning(false)
    setSettling(true)
    clearSettle()
    settleTimer.current=window.setTimeout(()=>{
      settleTimer.current=0
      setSettling(false)
      burstSize.current=0
    },SETTLE_MS)
  },[clearSettle,clearSpinWatch])

  const runSpin=useCallback((ms:number)=>{
    setSpinMs(ms)
    setSpinning(true)
    setSpinKey(k=>{
      const next=k+1
      spinKeyRef.current=next
      clearSpinWatch()
      spinWatch.current=window.setTimeout(()=>{
        spinWatch.current=0
        advanceRef.current()
      },ms+80)
      return next
    })
  },[clearSpinWatch])

  const advanceAfterSpin=useCallback(()=>{
    const key=spinKeyRef.current
    if(handledKey.current===key)return
    handledKey.current=key
    clearSpinWatch()
    if(remaining.current<=0){beginSettle();return}
    remaining.current-=1
    if(remaining.current>0){
      runSpin(spinDuration(burstSize.current))
      return
    }
    beginSettle()
  },[clearSpinWatch,beginSettle,runSpin])

  advanceRef.current=advanceAfterSpin

  const startOrQueueTap=useCallback(()=>{
    const now=performance.now()
    const rapid=now-lastTapAt.current<=RAPID_MS
    lastTapAt.current=now

    if(remaining.current>0){
      if(!rapid)return
      remaining.current+=1
      burstSize.current+=1
      // Still in the opening burst window: retune speed and restart current spin.
      if(now-burstStartedAt.current<=RAPID_MS){
        handledKey.current=spinKeyRef.current
        runSpin(spinDuration(burstSize.current))
      }
      return
    }

    clearSettle()
    setSettling(false)
    remaining.current=1
    burstSize.current=1
    burstStartedAt.current=now
    runSpin(spinDuration(1))
  },[clearSettle,runSpin])

  const onSpinEnd=useCallback(()=>{
    advanceAfterSpin()
  },[advanceAfterSpin])

  const onPointerDown=useCallback((event:PointerEvent)=>{
    if(!enabled||!event.isPrimary||event.button!==0)return
    pointerId.current=event.pointerId
    startX.current=event.clientX
    startY.current=event.clientY
    cancelled.current=false
    longFired.current=false
    clearLong()
    longTimer.current=window.setTimeout(()=>{
      longTimer.current=0
      if(cancelled.current||pointerId.current===null)return
      longFired.current=true
      onLongPressRef.current()
    },LONG_PRESS_MS)
  },[enabled,clearLong])

  const onPointerMove=useCallback((event:PointerEvent)=>{
    if(!enabled||pointerId.current!==event.pointerId)return
    if(Math.hypot(event.clientX-startX.current,event.clientY-startY.current)>MOVE_CANCEL_PX){
      cancelled.current=true
      clearLong()
    }
  },[enabled,clearLong])

  const endPointer=useCallback((event:PointerEvent,commitTap:boolean)=>{
    if(!enabled||pointerId.current!==event.pointerId)return
    pointerId.current=null
    clearLong()
    if(!commitTap||longFired.current||cancelled.current)return
    startOrQueueTap()
  },[enabled,clearLong,startOrQueueTap])

  const onPointerUp=useCallback((event:PointerEvent)=>{
    endPointer(event,true)
  },[endPointer])

  const onPointerCancel=useCallback((event:PointerEvent)=>{
    endPointer(event,false)
  },[endPointer])

  const onClickCapture=useCallback((event:MouseEvent)=>{
    if(!enabled)return
    event.preventDefault()
    event.stopPropagation()
  },[enabled])

  return {
    spinning,
    settling,
    spinKey,
    spinMs,
    onSpinEnd,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  }
}
