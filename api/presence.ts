import type { ServerResponse } from 'node:http'
import { bodyOf, limit, redis, respond, sameOrigin, type ApiRequest } from '../server/redis.ts'
const presenceScript = `for i=1,2 do redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',ARGV[1]); redis.call('ZREM',KEYS[i],ARGV[3]) end; if ARGV[4]~='0' then redis.call('ZADD',KEYS[tonumber(ARGV[4])],ARGV[2],ARGV[3]) end; local users={}; local counts={0,0}; for i=2,1,-1 do redis.call('EXPIRE',KEYS[i],60); for _,m in ipairs(redis.call('ZRANGE',KEYS[i],0,-1)) do local b=string.match(m,'^([^:]+):'); if not users[b] then users[b]=true;counts[i]=counts[i]+1 end end end;return counts`
export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (!sameOrigin(req)) { respond(res, 403, { error: 'Same-origin requests only.' }); return }
  let body: Record<string, unknown>
  try { body = await bodyOf(req, 600) } catch { respond(res, 400, { error: 'Invalid presence.' }); return }
  const valid = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9-]{20,64}$/.test(value)
  if (!valid(body.browser) || !valid(body.tab) || typeof body.guest !== 'boolean') { respond(res, 400, { error: 'Invalid presence.' }); return }
  try {
    if (!await limit(req, 'presence', 240, 60)) { respond(res, 429, { error: 'Too many requests.' }); return }
    const now = Date.now()
    const counts = await redis<number[]>('EVAL', presenceScript, 2, 'robaq:presence:guests', 'robaq:presence:members', now - 35000, now, `${body.browser}:${body.tab}`, body.active===false?'0':body.guest?'1':'2')
    respond(res, 200, { guests:counts[0],members:counts[1] })
  } catch { respond(res, 503, { error: 'Presence is temporarily unavailable.' }) }
}
