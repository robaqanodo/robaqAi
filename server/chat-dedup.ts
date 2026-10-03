import { createHmac, randomBytes } from 'node:crypto'
import { redis, type ApiRequest } from './redis.ts'
export type RequestLease = { key: string; token: string }
// Never cache private answers by IP: several people can share an address.
export async function claimChatRequest(req: ApiRequest, message: string, locale: string): Promise<RequestLease | 'duplicate' | null> {
  const secret = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!secret) return null
  const address = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim()
  if (!address) return null
  const fingerprint = createHmac('sha256', secret).update(JSON.stringify([address, message.normalize('NFC').trim().replace(/\s+/g, ' '), locale])).digest('hex')
  const key = `robaq:chat-dedup:${fingerprint}`, token = randomBytes(16).toString('hex')
  try {
    const claimed = await redis('SET', key, token, 'EX', 90, 'NX')
    return claimed === 'OK' ? { key, token } : 'duplicate'
  } catch { return null }
}
export async function finishChatRequest(lease: RequestLease | null, success: boolean) {
  if (!lease) return
  try {
    await redis('EVAL', "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; if ARGV[2]=='1' then redis.call('EXPIRE',KEYS[1],86400) else redis.call('DEL',KEYS[1]) end; return 1", 1, lease.key, lease.token, success ? '1' : '0')
  } catch { /* The short initial lease still expires. */ }
}
