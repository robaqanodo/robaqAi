export type MarkerKind = 'dot' | 'model3' | 'modely' | 'models' | 'cybertruck'

const KEY = 'robaq-map-marker'
const KINDS: MarkerKind[] = ['dot', 'model3', 'modely', 'models', 'cybertruck']

/** Top-down silhouettes. Nose points up so map heading rotation stays correct. */
const SHELLS: Record<Exclude<MarkerKind, 'dot'>, {body: string; glass: string; cyber?: boolean}> = {
  model3: {
    body: 'M24 5c6.2.8 10 6.2 10.8 13.2l1 8.2c.5 1.4 1.8 2.2 1.8 3.6v5.2c0 1.4-1.3 2.2-1.8 3.5l-1.4 26.2C33.4 73.2 29.2 78 24 79c-5.2-1-9.4-5.8-10.4-13.9l-1.4-26.2c-.5-1.3-1.8-2.1-1.8-3.5v-5.2c0-1.4 1.3-2.2 1.8-3.6l1-8.2C14 11.2 17.8 5.8 24 5z',
    glass: 'M16.2 22.2c1.6-4.2 4.2-6.4 7.8-6.4s6.2 2.2 7.8 6.4l.8 7.2H15.4l.8-7.2zM16 52.5h16l-.6 8.2c-.6 3.2-3.2 5.2-7.4 5.2s-6.8-2-7.4-5.2L16 52.5z',
  },
  modely: {
    body: 'M24 7.5c7 .8 11.2 6.4 12 13.6l1.2 8.4c.8 1.6 2.4 2.4 2.4 4v22.2c0 7.6-5.4 13.2-13.6 14.3-8.2-1.1-13.6-6.7-13.6-14.3V33.5c0-1.6 1.6-2.4 2.4-4l1.2-8.4C12.8 13.9 17 8.3 24 7.5z',
    glass: 'M15.2 24.5c1.4-4.6 4.4-7 8.8-7s7.4 2.4 8.8 7l1 10.2H14.2l1-10.2zM15 50.5h18v14.2c0 3.4-3.6 5.8-9 5.8s-9-2.4-9-5.8V50.5z',
  },
  models: {
    body: 'M24 2.2c5.4.6 8.6 5.4 9.4 12.4l1.6 16.2c.4 4 .5 10 .2 18.2l-.8 22.2C33.8 78.4 29.6 82 24 82.6 18.4 82 14.2 78.4 13.6 71.2l-.8-22.2c-.3-8.2-.2-14.2.2-18.2l1.6-16.2C15.4 7.6 18.6 2.8 24 2.2z',
    glass: 'M17 20.4c1.2-4.8 3.6-7.4 7-7.4s5.8 2.6 7 7.4l.6 8.4H16.4l.6-8.4zM16.6 54.2h14.8l-.4 12.2c-.4 3.4-3 5.4-7 5.4s-6.6-2-7-5.4l-.4-12.2z',
  },
  cybertruck: {
    cyber: true,
    body: 'M14 10h20l8 16v40l-6 16H12L6 66V26l8-16z',
    glass: 'M16 26h16l4 10H12l4-10zM14 50h20v18H14V50z',
  },
}

export function loadMarkerKind(): MarkerKind {
  try {
    const raw = localStorage.getItem(KEY)
    return KINDS.includes(raw as MarkerKind) ? raw as MarkerKind : 'dot'
  } catch {
    return 'dot'
  }
}

export function saveMarkerKind(kind: MarkerKind): MarkerKind {
  const next = KINDS.includes(kind) ? kind : 'dot'
  try { localStorage.setItem(KEY, next) } catch { /* The choice still applies for this view. */ }
  return next
}

/** Default puck: rounded heading arrow, nose up, Tesla blue and white. Not a vehicle silhouette. */
const PUCK = `<svg class="owned-map-puck" viewBox="0 0 40 48" aria-hidden="true"><path fill="#3E6AE1" stroke="#fff" stroke-width="3" stroke-linejoin="round" d="M20 4.2c1.5 0 2.8.8 3.5 2.1L35.2 36.4c1.2 2.4-.6 5.2-3.3 5.2-1 0-1.9-.4-2.6-1.1L20 32.2l-9.3 8.3c-.7.7-1.6 1.1-2.6 1.1-2.7 0-4.5-2.8-3.3-5.2L16.5 6.3c.7-1.3 2-2.1 3.5-2.1z"/></svg>`

export function markerMarkup(kind: MarkerKind): string {
  if (kind === 'dot') return PUCK
  const shell = SHELLS[kind]
  const cyber = shell.cyber ? ' is-cyber' : ''
  return `<svg class="owned-map-vehicle${cyber}" viewBox="0 0 48 84" aria-hidden="true"><path class="shell" d="${shell.body}"/><path class="glass" d="${shell.glass}"/></svg>`
}
