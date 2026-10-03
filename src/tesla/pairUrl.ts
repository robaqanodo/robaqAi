export const PAIR_CODE = /^[A-Za-z0-9_-]{22}$/

/** One-time pairing URL. The code is not an API key and the claim never goes in the link. */
export function pairUrl(code: string, origin = location.origin) {
  const url = new URL('/', origin)
  url.searchParams.set('pair', code)
  return url.toString()
}
