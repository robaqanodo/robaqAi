import { claimChatRequest, finishChatRequest } from '../server/chat-dedup.ts'
import { cacheCandidate, cachedAnswer, rememberAnswer, acceptableAnswer, claimRefresh, finishRefresh, REFRESH_MS } from '../server/answer-cache.ts'
import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { ChatFailure, generateGroundedReply, MAX_MESSAGE, sanitizeHistory } from '../server/gemini-chat.ts'
import { bodyOf, limit, redis, respond, sameOrigin, type ApiRequest } from '../server/redis.ts'

async function saveTemporary(req: ApiRequest, res: ServerResponse, body: Record<string, unknown>) {
  const token = req.headers.authorization?.replace(/^Bearer /,'') ?? ''
  if (!/^[a-f0-9]{64}$/.test(token)) { respond(res,401,{error:'Invalid chat session.'}); return }
  try {
    const key = `robaq:chat:${createHash('sha256').update(token).digest('hex')}`
    if (body.action === 'close') {
      await redis('EVAL', "redis.call('DEL',KEYS[1]); redis.call('SET',KEYS[2],'1','EX',120); return 1", 2, key, key + ':closed')
    } else if (body.action === 'save' && typeof body.encrypted === 'string' && body.encrypted.length <= 900000) {
      if (!await limit(req, 'temporary-chat', 120, 60)) { respond(res,429,{error:'Too many requests.'}); return }
      await redis('EVAL', "if redis.call('EXISTS',KEYS[2])==1 then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'EX',60); return 1", 2, key, key + ':closed', body.encrypted)
    } else { respond(res,400,{error:'Invalid chat request.'}); return }
    respond(res,200,{ok:true})
  } catch { respond(res,503,{error:'Temporary chat storage is unavailable.'}) }
}

async function answer(req: ApiRequest, res: ServerResponse, body: Record<string, unknown>) {
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) { respond(res, 400, { error: 'invalid' }); return }
  if (message.length > MAX_MESSAGE) { respond(res, 400, { error: 'too_long' }); return }
  const locale = body.locale === 'ka' || body.locale === 'ru' ? body.locale : 'en'
  const candidate = cacheCandidate(message, locale, body.history)
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? ''
  const saved = candidate ? await cachedAnswer(candidate.key) : null
  if (saved && candidate) {
    const token = apiKey && Date.now() - saved.checkedAt >= REFRESH_MS ? await claimRefresh(candidate.key) : null
    if (!token) { respond(res, 200, { text: saved.text, sources: [], cached: true }); return }
    try {
      const result = await generateGroundedReply({ apiKey, message, locale, history: [], previousAnswer: saved.text })
      const selected = acceptableAnswer(message, result.text) ? result.text : saved.text
      await finishRefresh(candidate.key, token, saved, selected)
      respond(res, 200, { text: selected, sources: [], cached: selected === saved.text })
    } catch {
      await finishRefresh(candidate.key, token, saved, null)
      respond(res, 200, { text: saved.text, sources: [], cached: true })
    }
    return
  }
  if (!apiKey) { respond(res, 503, { error: 'not_configured' }); return }
  const history = sanitizeHistory(body.history)
  const lease = await claimChatRequest(req, message, locale)
  if (lease === 'duplicate') { respond(res, 429, { error: 'duplicate' }); return }
  try {
    const result = await generateGroundedReply({ apiKey, message, locale, history })
    await finishChatRequest(lease, true)
    if (candidate && acceptableAnswer(message, result.text)) await rememberAnswer(req, res, candidate, result.text)
    respond(res, 200, { text: result.text, sources: result.sources })
  } catch (error) {
    await finishChatRequest(lease, false)
    const code = error instanceof ChatFailure ? error.code : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'unavailable'
    console.warn('Chat request failed:', code)
    respond(res, code === 'quota' ? 429 : 503, { error: code })
  }
}

export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (req.method !== 'POST') { respond(res, 405, { error: 'POST only.' }); return }
  if (!sameOrigin(req)) { respond(res, 403, { error: 'Same-origin requests only.' }); return }
  let body: Record<string, unknown>
  try { body = await bodyOf(req, 1000000) }
  catch { respond(res, 400, { error: 'Invalid chat request.' }); return }
  if (body.action === 'close' || body.action === 'save') { await saveTemporary(req, res, body); return }
  if ('message' in body) { await answer(req, res, body); return }
  respond(res, 400, { error: 'Invalid chat request.' })
}
