export type MarkerKind = 'dot' | 'original'

const KEY = 'robaq-map-marker'
const KINDS: MarkerKind[] = ['dot', 'original']

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
  // Same-tab storage events do not fire. The open map listens for this.
  window.dispatchEvent(new Event('robaq-marker'))
  return next
}

/** Default puck: rounded heading arrow, nose up, Tesla blue and white. Not a vehicle silhouette. */
const PUCK = `<svg class="owned-map-puck" viewBox="0 0 40 48" aria-hidden="true"><path fill="#3E6AE1" stroke="#fff" stroke-width="3" stroke-linejoin="round" d="M20 4.2c1.5 0 2.8.8 3.5 2.1L35.2 36.4c1.2 2.4-.6 5.2-3.3 5.2-1 0-1.9-.4-2.6-1.1L20 32.2l-9.3 8.3c-.7.7-1.6 1.1-2.6 1.1-2.7 0-4.5-2.8-3.3-5.2L16.5 6.3c.7-1.3 2-2.1 3.5-2.1z"/></svg>`

export function markerMarkup(kind: MarkerKind): string {
  return kind === 'original' ? PUCK.replace('#3E6AE1', '#E82127') : PUCK
}
