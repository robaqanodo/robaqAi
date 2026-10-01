import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
export type ApiRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> }
export function respond(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data))
}
export function sameOrigin(req: IncomingMessage) {
  try { return req.method === 'POST' && Boolean(req.headers.origin) && new URL(req.headers.origin!).host === req.headers.host } catch { return false }
}
export async function bodyOf(req: ApiRequest, maximum = 360000): Promise<Record<string, unknown>> {
  let raw = typeof req.body === 'string' ? req.body : req.body !== undefined ? JSON.stringify(req.body) : ''
  if (req.body === undefined) for await (const chunk of req) { raw += chunk; if (raw.length > maximum) throw new Error('Request too large.') }
  if (raw.length > maximum) throw new Error('Request too large.')
  const body = JSON.parse(raw)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request.')
  return body
}
export async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) throw new Error('MovieSync storage is not connected. Connect Upstash Redis in Vercel and redeploy.')
  const result = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(5000) })
  if (!result.ok) throw new Error('MovieSync storage is temporarily unavailable.')
  const value = await result.json() as { result: T; error?: string }
  if (value.error) throw new Error('MovieSync storage is temporarily unavailable.')
  return value.result
}
export async function limit(req: IncomingMessage, group: string, maximum: number, seconds: number) {
  const address = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0]
  const ip = createHash('sha256').update(address).digest('hex').slice(0, 32)
  const count = await redis<number>('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, `robaq:limit:${group}:${ip}`, seconds)
  return count <= maximum
}
