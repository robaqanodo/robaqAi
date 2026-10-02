import {useCallback,useEffect,useRef,useState,type MouseEvent,type PointerEvent} from 'react'

const LONG_PRESS_MS=3000
const MOVE_CANCEL_PX=14
const SPIN_MS=1050
const SETTLE_MS=1100

type Options={enabled:boolean;onLongPress:()=>void}

/** Connected LinkyourTesla core: one natural spin per tap; mid-spin taps ignored; 3s long-press opens panel. */
export function useTeslaCoreInteraction({enabled,onLongPress}:Options){
  const [spinning,setSpinning]=useState(false)
  const [settling,setSettling]=useState(false)
  const [spinKey,setSpinKey]=useState(0)
  const spinningRef=useRef(false)
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
  const finishRef=useRef<()=>void>(()=>{})
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
    spinningRef.current=false
    setSpinning(false);setSettling(false)
  },[enabled,clearLong,clearSettle,clearSpinWatch])

  const beginSettle=useCallback(()=>{
    clearSpinWatch()
    spinningRef.current=false
    setSpinning(false)
    setSettling(true)
    clearSettle()
    settleTimer.current=window.setTimeout(()=>{
      settleTimer.current=0
      setSettling(false)
    },SETTLE_MS)
  },[clearSettle,clearSpinWatch])

  const finishSpin=useCallback(()=>{
    const key=spinKeyRef.current
    if(handledKey.current===key)return
    handledKey.current=key
    beginSettle()
  },[beginSettle])

  finishRef.current=finishSpin

  const startSpin=useCallback(()=>{
    if(spinningRef.current)return
    clearSettle()
    setSettling(false)
    spinningRef.current=true
    setSpinning(true)
    setSpinKey(k=>{
      const next=k+1
      spinKeyRef.current=next
      clearSpinWatch()
      spinWatch.current=window.setTimeout(()=>{
        spinWatch.current=0
        finishRef.current()
      },SPIN_MS+80)
      return next
    })
  },[clearSettle,clearSpinWatch])

  const onSpinEnd=useCallback(()=>{
    finishSpin()
  },[finishSpin])

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
    startSpin()
  },[enabled,clearLong,startSpin])

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
    spinMs:SPIN_MS,
    onSpinEnd,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  }
}
