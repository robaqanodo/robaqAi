import type { ServerResponse } from 'node:http'
import { bodyOf, limit, redis, respond, sameOrigin, type ApiRequest } from '../server/redis.ts'
const presenceScript = `redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if ARGV[4]=='1' then redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]) else redis.call('ZREM',KEYS[1],ARGV[3]) end; redis.call('EXPIRE',KEYS[1],60); local members=redis.call('ZRANGE',KEYS[1],0,-1); local seen={}; local count=0; for _,m in ipairs(members) do local browser=string.match(m,'^([^:]+):'); if not seen[browser] then seen[browser]=true; count=count+1 end end; return count`
export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (!sameOrigin(req)) { respond(res, 403, { error: 'Same-origin requests only.' }); return }
  let body: Record<string, unknown>
  try { body = await bodyOf(req, 600) } catch { respond(res, 400, { error: 'Invalid presence.' }); return }
  const valid = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9-]{20,64}$/.test(value)
  if (!valid(body.browser) || !valid(body.tab) || typeof body.guest !== 'boolean') { respond(res, 400, { error: 'Invalid presence.' }); return }
  try {
    if (!await limit(req, 'presence', 240, 60)) { respond(res, 429, { error: 'Too many requests.' }); return }
    const now = Date.now()
    const guests = await redis<number>('EVAL', presenceScript, 1, 'robaq:presence', now - 35000, now, `${body.browser}:${body.tab}`, body.guest ? '1' : '0')
    respond(res, 200, { guests })
  } catch { respond(res, 503, { error: 'Presence is temporarily unavailable.' }) }
}
