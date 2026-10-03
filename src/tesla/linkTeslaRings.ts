/** Cumulative ring spin for the connected Tesla core.
 * CSS keyframe duration changes restart or jump the angle. This drives
 * rotate() from the live matrix so the angle only ever advances. */

const RISE_MS = 200
const SPIN_MS = 1800
const SETTLE_MS = 1100
const END_MS = SPIN_MS + SETTLE_MS
/** Idle matches the 12s CSS loops (clockwise). Peak burst speed is chosen so one
 * tap's relative travel is exactly 360deg and the 90deg stripe offset returns. */
const W_IDLE = 360 / 12000
const W_FAST = 360 / 4500

type Burst = { start: number }

function smootherstepIntegral(u: number) {
  const x = Math.min(1, Math.max(0, u))
  return 2.5 * x ** 4 - 3 * x ** 5 + x ** 6
}

/** Integral of the 0..1 burst envelope from elapsed a to b (ms). */
function envelopeIntegral(a: number, b: number) {
  if (b <= a) return 0
  const knots = [0, RISE_MS, SPIN_MS, END_MS]
  let acc = 0
  let cursor = a
  while (cursor < b - 1e-6) {
    let next = b
    for (const knot of knots) if (knot > cursor + 1e-6 && knot < next) next = knot
    acc += pieceIntegral(cursor, next)
    cursor = next
  }
  return acc
}

function pieceIntegral(a: number, b: number) {
  if (b <= 0 || a >= END_MS) return 0
  const left = Math.max(0, a)
  const right = Math.min(END_MS, b)
  if (right <= left) return 0
  if (right <= RISE_MS) {
    return RISE_MS * (smootherstepIntegral(right / RISE_MS) - smootherstepIntegral(left / RISE_MS))
  }
  if (left >= RISE_MS && right <= SPIN_MS) return right - left
  if (left >= SPIN_MS && right <= END_MS) {
    const u0 = (left - SPIN_MS) / SETTLE_MS
    const u1 = (right - SPIN_MS) / SETTLE_MS
    return (right - left) - SETTLE_MS * (smootherstepIntegral(u1) - smootherstepIntegral(u0))
  }
  return 0
}

export const LINK_TESLA_RING_FULL_ENVELOPE = envelopeIntegral(0, END_MS)

export function rotationDeg(transform: string) {
  if (!transform || transform === 'none') return 0
  const m = new DOMMatrix(transform)
  return Math.atan2(m.b, m.a) * (180 / Math.PI)
}

/** Advance both rings. Positive degrees are clockwise (CSS rotate). */
export function createLinkTeslaRingClock(small0: number, big0: number) {
  let small = small0
  let big = big0
  let last = 0
  let started = false
  let baked = 0
  let wasSpinning = false
  const bursts: Burst[] = []

  const envelopeAt = (now: number) => {
    let total = baked
    for (const burst of bursts) total += envelopeIntegral(0, Math.max(0, now - burst.start))
    return total
  }

  return {
    step(now: number, spinning: boolean) {
      if (!started) {
        last = now
        started = true
      }
      if (spinning && !wasSpinning) bursts.push({ start: now })
      wasSpinning = spinning
      const prev = envelopeAt(last)
      const curr = envelopeAt(now)
      const integ = curr - prev
      const dt = now - last
      small += W_IDLE * dt + (W_FAST - W_IDLE) * integ
      big += W_IDLE * dt - (W_FAST + W_IDLE) * integ
      last = now
      for (let i = bursts.length - 1; i >= 0; i--) {
        if (now - bursts[i].start >= END_MS) {
          baked += LINK_TESLA_RING_FULL_ENVELOPE
          bursts.splice(i, 1)
        }
      }
      return { small, big }
    },
  }
}

export function attachLinkTeslaRings(root: HTMLElement, spinning: () => boolean) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (motion.matches) return () => {}
  const boundary = root.querySelector<HTMLElement>('.cell-boundary')
  const core = root.querySelector<HTMLElement>('.link-tesla-core')
  if (!boundary || !core) return () => {}
  const big0 = rotationDeg(getComputedStyle(boundary).transform)
  const small0 = rotationDeg(getComputedStyle(core, '::after').transform)
  boundary.style.setProperty('--cell-ring-rot', `${big0}deg`)
  core.style.setProperty('--link-ring-rot', `${small0}deg`)
  root.classList.add('is-ring-driven')
  const clock = createLinkTeslaRingClock(small0, big0)
  let raf = 0
  const tick = (now: number) => {
    const { small, big } = clock.step(now, spinning())
    boundary.style.setProperty('--cell-ring-rot', `${big}deg`)
    core.style.setProperty('--link-ring-rot', `${small}deg`)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  const onMotion = () => {
    if (!motion.matches) return
    cancelAnimationFrame(raf)
    motion.removeEventListener('change', onMotion)
  }
  motion.addEventListener('change', onMotion)
  return () => {
    motion.removeEventListener('change', onMotion)
    cancelAnimationFrame(raf)
    // Hand the big ring back to its 12s CSS loop at the same angle (negative delay).
    const deg = Number.parseFloat(boundary.style.getPropertyValue('--cell-ring-rot'))
    if (Number.isFinite(deg)) {
      const norm = ((deg % 360) + 360) % 360
      boundary.style.animationDelay = `${-(norm / 360) * 12}s`
    }
    root.classList.remove('is-ring-driven')
    boundary.style.removeProperty('--cell-ring-rot')
    core.style.removeProperty('--link-ring-rot')
  }
}
