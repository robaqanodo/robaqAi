import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { bodyOf, redis, respond, sameOrigin, type ApiRequest } from './redis.ts'

export const HANDOFF_TTL_SECONDS = 180
const CODE_RE = /^[A-Za-z0-9_-]{22}$/
const CLAIM_RE = /^[a-f0-9]{64}$/
const PROVIDERS = new Set(['gemini', 'openai', 'claude'])

export type HandoffRecord = { claim: string; expiresAt: number; apiKey?: string; provider?: string }

export interface HandoffStore {
  put(code: string, record: HandoffRecord, ttlSeconds: number): Promise<boolean>
  submit(code: string, apiKey: string, provider: string): Promise<0 | 1 | 2>
  take(code: string, claim: string): Promise<HandoffRecord | 'claim' | null>
  attempt(key: string, maximum: number, seconds: number): Promise<boolean>
}

export function memoryHandoffStore(): HandoffStore {
  const records = new Map<string, HandoffRecord>()
  const limits = new Map<string, { count: number; until: number }>()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [code, record] of records) if (record.expiresAt <= now) records.delete(code)
    for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key)
  }, 1000)
  sweep.unref()
  return {
    async put(code, record, ttlSeconds) {
      if (records.has(code)) return false
      records.set(code, record)
      const drop = setTimeout(() => records.delete(code), ttlSeconds * 1000)
      drop.unref()
      return true
    },
    async submit(code, apiKey, provider) {
      const record = records.get(code)
      if (!record || record.expiresAt <= Date.now()) { records.delete(code); return 0 }
      if (record.apiKey) return 2
      record.apiKey = apiKey
      record.provider = provider
      return 1
    },
    async take(code, claim) {
      const record = records.get(code)
      if (!record || record.expiresAt <= Date.now()) { records.delete(code); return null }
      const left = Buffer.from(claim)
      const right = Buffer.from(record.claim)
      if (left.length !== right.length || !timingSafeEqual(left, right)) return 'claim'
      if (!record.apiKey) return { claim: record.claim, expiresAt: record.expiresAt }
      records.delete(code)
      return { ...record }
    },
    async attempt(key, maximum, seconds) {
      const now = Date.now()
      let entry = limits.get(key)
      if (!entry || entry.until <= now) { entry = { count: 0, until: now + seconds * 1000 }; limits.set(key, entry) }
      return ++entry.count <= maximum
    },
  }
}

const submitScript = `local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local r=cjson.decode(raw); if r.apiKey and r.apiKey~='' then return 2 end; r.apiKey=ARGV[1]; r.provider=ARGV[2]; local ttl=redis.call('PTTL',KEYS[1]); if ttl<1 then return 0 end; redis.call('SET',KEYS[1],cjson.encode(r),'PX',ttl); return 1`
const takeScript = `local raw=redis.call('GET',KEYS[1]); if not raw then return nil end; local r=cjson.decode(raw); if r.claim~=ARGV[1] then return 'claim' end; if not r.apiKey or r.apiKey=='' then return raw end; redis.call('DEL',KEYS[1]); return raw`
const limitScript = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`

export function redisHandoffStore(): HandoffStore {
  const key = (code: string) => `robaq:handoff:${code}`
  return {
    async put(code, record, ttlSeconds) {
      const saved = await redis<string | null>('SET', key(code), JSON.stringify({ claim: record.claim, expiresAt: record.expiresAt }), 'EX', ttlSeconds, 'NX')
      return saved === 'OK'
    },
    async submit(code, apiKey, provider) {
      const result = await redis<number>('EVAL', submitScript, 1, key(code), apiKey, provider)
      return result === 1 || result === 2 || result === 0 ? result : 0
    },
    async take(code, claim) {
      const raw = await redis<string | null>('EVAL', takeScript, 1, key(code), claim)
      if (raw == null) return null
      if (raw === 'claim') return 'claim'
      return JSON.parse(raw) as HandoffRecord
    },
    async attempt(bucket, maximum, seconds) {
      const count = await redis<number>('EVAL', limitScript, 1, `robaq:handoff-limit:${bucket}`, seconds)
      return count <= maximum
    },
  }
}

function clientKey(req: ApiRequest) {
  const address = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'local').split(',')[0]
  return createHash('sha256').update(address).digest('hex').slice(0, 32)
}

export function keyHandoffHandler(store: HandoffStore = redisHandoffStore()) {
  return async (req: ApiRequest, res: ServerResponse) => {
    if (!sameOrigin(req)) { respond(res, 403, { error: 'Same-origin requests only.' }); return }
    try {
      const body = await bodyOf(req, 8000)
      const action = String(body.action ?? '')
      const ip = clientKey(req)
      if (action === 'create') {
        if (!await store.attempt(`create:${ip}`, 12, 600)) { respond(res, 429, { error: 'Too many codes. Wait a few minutes.' }); return }
        const claim = randomBytes(32).toString('hex')
        const expiresAt = Date.now() + HANDOFF_TTL_SECONDS * 1000
        let code = ''
        for (let attempt = 0; attempt < 5 && !code; attempt++) {
          const candidate = randomBytes(16).toString('base64url')
          if (await store.put(candidate, { claim, expiresAt }, HANDOFF_TTL_SECONDS)) code = candidate
        }
        if (!code) { respond(res, 503, { error: 'Could not start a phone link. Try again.' }); return }
        respond(res, 200, { code, claim, expiresAt })
        return
      }
      const code = String(body.code ?? '')
      if (!CODE_RE.test(code)) { respond(res, 410, { error: 'This code has expired.' }); return }
      if (action === 'submit') {
        if (!await store.attempt(`submit:${ip}`, 20, 600)) { respond(res, 429, { error: 'Too many attempts. Wait a few minutes.' }); return }
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
        const provider = String(body.provider ?? '')
        if (!PROVIDERS.has(provider) || apiKey.length < 16 || apiKey.length > 400 || /[^\x21-\x7E]/.test(apiKey)) {
          respond(res, 400, { error: 'Enter a valid API key.' }); return
        }
        const saved = await store.submit(code, apiKey, provider)
        if (saved === 0) { respond(res, 410, { error: 'This code has expired.' }); return }
        if (saved === 2) { respond(res, 409, { error: 'This code was already used.' }); return }
        respond(res, 200, { ok: true })
        return
      }
      if (action !== 'poll') { respond(res, 400, { error: 'Invalid request.' }); return }
      const claim = String(body.claim ?? '')
      if (!CLAIM_RE.test(claim)) { respond(res, 410, { error: 'This code has expired.' }); return }
      if (!await store.attempt(`poll:${ip}`, 180, 600)) { respond(res, 429, { error: 'Too many attempts. Wait a few minutes.' }); return }
      const record = await store.take(code, claim)
      if (record === 'claim' || !record) { respond(res, 410, { error: 'This code has expired.' }); return }
      if (!record.apiKey || !record.provider) { respond(res, 200, { status: 'waiting', expiresAt: record.expiresAt }); return }
      respond(res, 200, { status: 'ready', apiKey: record.apiKey, provider: record.provider })
    } catch (error) {
      const missing = error instanceof Error && error.message.includes('not connected')
      respond(res, 503, { error: missing ? 'Phone link is not configured on this server.' : 'Could not start a phone link. Try again.' })
    }
  }
}
