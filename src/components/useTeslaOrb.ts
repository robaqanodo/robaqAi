import { useEffect, useRef, useState } from 'react'

export function isTeslaBrowser(agent: string) {
  return /\bTesla(?:\/|\s|$)|\bQtCarBrowser\b/i.test(agent)
}

/** Pointer capture keeps a swipe on the orb from becoming an Open chat click. */
export function useTeslaOrb(enabled: boolean) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [tesla] = useState(() => isTeslaBrowser(navigator.userAgent))
  useEffect(() => {
    const button = buttonRef.current
    const orb = button?.querySelector<HTMLElement>('.intelligence-orb')
    if (!tesla || !enabled || !button || !orb) return
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, pointer: number | null = null, x = 0, y = 0, last = 0
    let startX = 0, startY = 0, yaw = 0, pitch = 0, vx = 0, vy = 0, dragged = false, blockClick = false
    const paint = () => { orb.style.transform = `perspective(850px) rotateX(${pitch}deg) rotateY(${yaw}deg)` }
    const stop = () => { cancelAnimationFrame(frame); frame = 0; vx = vy = 0 }
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || pointer !== null) return
      stop(); pointer = event.pointerId; x = startX = event.clientX; y = startY = event.clientY
      last = performance.now(); dragged = false; blockClick = false
      button.setPointerCapture(pointer)
    }
    const move = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return
      const now = performance.now(), dt = Math.max(8, now - last)
      const dx = event.clientX - x, dy = event.clientY - y
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 7) dragged = true
      if (dragged) {
        const sensitivity = 360 / Math.max(180, button.clientWidth)
        yaw += dx * sensitivity; pitch -= dy * sensitivity
        vx = Math.max(-1.5, Math.min(1.5, dx * sensitivity / dt))
        vy = Math.max(-1.5, Math.min(1.5, -dy * sensitivity / dt))
        paint(); event.preventDefault()
      }
      x = event.clientX; y = event.clientY; last = now
    }
    const coast = (now: number) => {
      const dt = Math.min(32, now - last); last = now
      yaw += vx * dt; pitch += vy * dt
      const friction = Math.exp(-dt / 420); vx *= friction; vy *= friction; paint()
      if (Math.hypot(vx, vy) > .008) frame = requestAnimationFrame(coast)
      else { yaw %= 360; pitch %= 360; paint(); stop() }
    }
    const end = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return
      const captured = pointer; pointer = null; blockClick = dragged
      if (button.hasPointerCapture(captured)) button.releasePointerCapture(captured)
      if (event.type !== 'pointerup' || motion.matches || performance.now() - last > 100) { stop(); return }
      if (dragged) { last = performance.now(); frame = requestAnimationFrame(coast) }
    }
    const click = (event: MouseEvent) => {
      if (blockClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); blockClick = false }
    }
    const hide = () => { if (document.hidden) stop() }
    const motionChanged = () => { if (motion.matches) stop() }
    button.addEventListener('pointerdown', down)
    button.addEventListener('pointermove', move)
    button.addEventListener('pointerup', end)
    button.addEventListener('pointercancel', end)
    button.addEventListener('lostpointercapture', end)
    button.addEventListener('click', click, true)
    document.addEventListener('visibilitychange', hide)
    motion.addEventListener('change', motionChanged)
    return () => {
      stop(); orb.style.removeProperty('transform')
      button.removeEventListener('pointerdown', down); button.removeEventListener('pointermove', move)
      button.removeEventListener('pointerup', end); button.removeEventListener('pointercancel', end)
      button.removeEventListener('lostpointercapture', end); button.removeEventListener('click', click, true)
      document.removeEventListener('visibilitychange', hide); motion.removeEventListener('change', motionChanged)
    }
  }, [tesla, enabled])
  return { buttonRef, tesla }
}
