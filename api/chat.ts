import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { bodyOf, limit, redis, respond, sameOrigin, type ApiRequest } from '../server/redis.ts'
export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (!sameOrigin(req)) { respond(res,403,{error:'Same-origin requests only.'}); return }
  const token = req.headers.authorization?.replace(/^Bearer /,'') ?? ''
  if (!/^[a-f0-9]{64}$/.test(token)) { respond(res,401,{error:'Invalid chat session.'}); return }
  try {
    const body = await bodyOf(req, 1000000)
    const key = `robaq:chat:${createHash('sha256').update(token).digest('hex')}`
    if (body.action === 'close') {
      // The short marker contains no messages and prevents in-flight writes resurrecting a closed chat.
      await redis('EVAL', "redis.call('DEL',KEYS[1]); redis.call('SET',KEYS[2],'1','EX',120); return 1", 2, key, key + ':closed')
    } else if (body.action === 'save' && typeof body.encrypted === 'string' && body.encrypted.length <= 900000) {
      if (!await limit(req, 'temporary-chat', 120, 60)) { respond(res,429,{error:'Too many requests.'}); return }
      await redis('EVAL', "if redis.call('EXISTS',KEYS[2])==1 then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'EX',60); return 1", 2, key, key + ':closed', body.encrypted)
    } else { respond(res,400,{error:'Invalid chat request.'}); return }
    respond(res,200,{ok:true})
  } catch { respond(res,503,{error:'Temporary chat storage is unavailable.'}) }
}
