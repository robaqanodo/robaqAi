import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { ServerResponse } from 'node:http'
import { bodyOf, limit, redis, respond, sameOrigin, type ApiRequest } from '../server/redis.ts'
const derive = promisify(scrypt)
type Account = { id: string; email: string; firstName: string; lastName: string; salt: string; hash: string; generation: string; keyVault?: { iv: string; data: string } }
type Login = { id: string; generation: string }
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const cookieName = 'robaq_session'
const publicUser = ({ id, email, firstName, lastName }: Account) => ({ id, email, firstName, lastName })
function cookie(req: ApiRequest) { return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '' }
function setCookie(res: ServerResponse, value: string, age?: number) {
  res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Secure${age === undefined ? '' : `; Max-Age=${age}`}`)
}
export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (!sameOrigin(req)) { respond(res, 403, { error: 'Same-origin requests only.' }); return }
  try {
    const body = await bodyOf(req, 4000)
    const action = String(body.action)
    const currentToken = cookie(req)
    const sessionKey = /^[a-f0-9]{64}$/.test(currentToken) ? `robaq:login:${hash(currentToken)}` : ''
    const sessionRaw = sessionKey ? await redis<string | null>('GET', sessionKey) : null
    const session: Login | null = sessionRaw ? JSON.parse(sessionRaw) : null
    const userRaw = session ? await redis<string | null>('GET', `robaq:account:${session.id}`) : null
    const current: Account | null = userRaw ? JSON.parse(userRaw) : null
    const authenticated = current && session && current.generation === session.generation ? current : null
    if (action === 'logout') {
      if (sessionKey) await redis('DEL', sessionKey)
      setCookie(res, '', 0); respond(res, 200, { ok: true }); return
    }
    if (['me', 'profile', 'delete', 'key-vault'].includes(action)) {
      if (!authenticated) { setCookie(res, '', 0); respond(res, 401, { error: 'Sign in again.' }); return }
      if (action === 'delete') {
        await redis('EVAL', "local old=redis.call('GET',KEYS[1]); if old and cjson.decode(old).generation==ARGV[1] then redis.call('DEL',KEYS[1]) end; redis.call('DEL',KEYS[2]); return 1", 2, `robaq:account:${authenticated.id}`, sessionKey, authenticated.generation)
        setCookie(res, '', 0); respond(res, 200, { ok: true }); return
      }
      if (action === 'profile' || action === 'key-vault') {
        if (action === 'profile') {
          authenticated.firstName = String(body.firstName ?? '').trim().slice(0, 80)
          authenticated.lastName = String(body.lastName ?? '').trim().slice(0, 80)
        } else {
          if ('apiKey' in body || 'provider' in body) { respond(res, 400, { error: 'Invalid account request.' }); return }
          const iv = String(body.iv ?? '')
          const data = String(body.data ?? '')
          if (!/^[A-Za-z0-9+/]{16,88}={0,2}$/.test(iv) || !/^[A-Za-z0-9+/]{24,2500}={0,2}$/.test(data)) { respond(res, 400, { error: 'Invalid account request.' }); return }
          authenticated.keyVault = { iv, data }
        }
        // Update only the existing generation; deletion cannot be undone by a concurrent save.
        const saved = await redis<number>('EVAL', "local old=redis.call('GET',KEYS[1]); if not old or cjson.decode(old).generation~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1", 1, `robaq:account:${authenticated.id}`, authenticated.generation, JSON.stringify(authenticated))
        if (!saved) { respond(res, 401, { error: 'Sign in again.' }); return }
        if (action === 'key-vault') { respond(res, 200, { ok: true }); return }
      }
      respond(res, 200, { user: publicUser(authenticated), keyVault: authenticated.keyVault ?? null }); return
    }
    if (!['register', 'login'].includes(action)) { respond(res, 400, { error: 'Invalid account request.' }); return }
    if (!await limit(req, 'login', 12, 60)) { respond(res, 429, { error: 'Too many attempts. Wait a minute.' }); return }
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length > 256 || password.length < 1) { respond(res, 400, { error: 'Enter a valid email address.' }); return }
    const id = hash(email), key = `robaq:account:${id}`
    let account: Account
    if (action === 'register') {
      if (password.length < 10) { respond(res, 400, { error: 'Use a password with at least 10 characters.' }); return }
      const salt = randomBytes(16).toString('hex')
      account = { id, email, firstName: String(body.firstName ?? '').trim().slice(0,80), lastName: String(body.lastName ?? '').trim().slice(0,80), salt, hash: (await derive(password, salt, 64) as Buffer).toString('hex'), generation: randomBytes(16).toString('hex') }
      if (!await redis('SET', key, JSON.stringify(account), 'NX')) { respond(res, 409, { error: 'This account already exists.' }); return }
    } else {
      const raw = await redis<string | null>('GET', key)
      if (!raw) { respond(res, 404, { error: 'No online account was found. Create an account first.' }); return }
      account = JSON.parse(raw)
      const check = await derive(password, account.salt, 64) as Buffer
      if (!timingSafeEqual(check, Buffer.from(account.hash, 'hex'))) { respond(res, 401, { error: 'Email or password is incorrect.' }); return }
    }
    const token = randomBytes(32).toString('hex'), seconds = body.remember === true ? 30 * 86400 : 86400
    await redis('SET', `robaq:login:${hash(token)}`, JSON.stringify({ id, generation: account.generation }), 'EX', seconds)
    if (sessionKey) await redis('DEL', sessionKey)
    setCookie(res, token, body.remember === true ? seconds : undefined)
    respond(res, 200, { user: publicUser(account), keyVault: account.keyVault ?? null })
  } catch { respond(res, 503, { error: 'Account service is unavailable. Please try again.' }) }
}
