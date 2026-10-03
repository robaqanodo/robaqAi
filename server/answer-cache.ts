import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { redis, type ApiRequest } from './redis.ts'

const VERSION = 'v1'
const VISITOR_TTL = 30 * 86400
export const REFRESH_MS = 30 * 86400 * 1000
// Deliberately closed vocabulary: never submit arbitrary private text to shared storage.
const topics = ['html', 'css', 'javascript', 'python', 'algorithm', 'ალგორითმი', 'алгоритм', 'photosynthesis', 'ფოტოსინთეზი', 'фотосинтез', 'gravity', 'გრავიტაცია', 'гравитация', 'mathematics', 'მათემატიკა', 'математика', 'logic', 'ლოგიკა', 'логика']
export function cacheCandidate(message: string, locale: string, history: unknown) {
  if (Array.isArray(history) && history.length) return null
  const question = message.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?？]+$/, '').trim()
  const definitions = ['what is ', 'define ', 'რა არის ', 'что такое ']
  const general = ['how does ', 'explain ', 'explain the basics of ', 'ახსენით ', 'ამიხსენი ', 'объясни ', 'как работает ']
  const immediate = definitions.some(prefix => topics.includes(question.slice(prefix.length)) && question.startsWith(prefix))
  const eligible = immediate || general.some(prefix => question.startsWith(prefix) && topics.includes(question.slice(prefix.length)))
  const arithmetic = /^(?:what is |რამდენია |сколько будет )?\d{1,6}\s*[+*−-]\s*\d{1,6}$/.test(question)
  if (!eligible && !arithmetic) return null
  return { key: `robaq:answers:${VERSION}:${createHash('sha256').update(locale + ':' + question).digest('hex')}`, immediate: immediate || arithmetic }
}

function visitor(req: ApiRequest, res: ServerResponse): string | null {
  const secret = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!secret) return null
  const sign = (id: string) => createHmac('sha256', secret).update('answer-cache:' + id).digest('hex')
  const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('robaq_faq='))?.slice(10)
  let id = cookie?.split('.')[0] ?? ''
  const sig = cookie?.split('.')[1] ?? ''
  if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(sig) || !timingSafeEqual(Buffer.from(sig), Buffer.from(sign(id)))) {
    id = randomBytes(16).toString('hex')
    res.setHeader('Set-Cookie', `robaq_faq=${id}.${sign(id)}; HttpOnly; SameSite=Strict; Path=/api/chat; Max-Age=${VISITOR_TTL}${req.headers.host?.startsWith('localhost') || req.headers.host?.startsWith('127.0.0.1') ? '' : '; Secure'}`)
  }
  return sign(id)
}

export type StoredAnswer = { text: string; updatedAt: number; checkedAt: number; previousText?: string }

// Mechanical checks only; they do not establish factual correctness.
export function acceptableAnswer(message: string, text: string): boolean {
  if (!text.trim() || text.length > 16000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return false
  if (/https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|KAS\d{5}|API[_ -]?KEY|ignore (all |previous )?instructions/i.test(text)) return false
  const arithmetic = message.trim().replace(/[?？]+$/, '').match(/^(?:what is |რამდენია |сколько будет )?(\d{1,6})\s*([+*−-])\s*(\d{1,6})$/i)
  if (arithmetic) {
    const a = Number(arithmetic[1]), b = Number(arithmetic[3])
    const expected = arithmetic[2] === '+' ? a + b : arithmetic[2] === '*' ? a * b : a - b
    // Cache only an unambiguous bare result or equation, never an unverified explanation.
    const result = text.trim().replace(/\*\*/g, '').split('=').at(-1)?.trim().replace(/\.$/, '')
    return result === String(expected)
  }
  return text.trim().length >= 40 && !/I (?:cannot|can't)|as an AI|ვერ გიპასუხ|не могу ответить/i.test(text)
}

export async function cachedAnswer(key: string): Promise<StoredAnswer | null> {
  try {
    // PERSIST upgrades existing expiring v1 records without resetting their content.
    const raw = await redis<string | null>('EVAL', "local v=redis.call('GET',KEYS[1]); if v then redis.call('PERSIST',KEYS[1]) end; return v", 1, key)
    if (!raw) return null
    const record = JSON.parse(raw) as Partial<StoredAnswer>
    if (typeof record.text !== 'string' || !record.text.trim() || record.text.length > 16000) return null
    return { text: record.text, updatedAt: Number(record.updatedAt) || 0, checkedAt: Number(record.checkedAt) || 0, previousText: typeof record.previousText === 'string' ? record.previousText : undefined }
  } catch { return null }
}

export async function claimRefresh(key: string): Promise<string | null> {
  const token = randomBytes(16).toString('hex')
  try {
    return await redis('SET', key + ':refresh', token, 'EX', 120, 'NX') === 'OK' ? token : null
  } catch { return null }
}

export async function finishRefresh(key: string, token: string, previous: StoredAnswer, text: string | null) {
  const now = Date.now()
  // Failed provider calls back off for six hours; successful quality reviews for 30 days.
  const record: StoredAnswer = text === null
    ? { ...previous, checkedAt: now - REFRESH_MS + 6 * 3600000 }
    : { text, updatedAt: text === previous.text ? previous.updatedAt : now, checkedAt: now,
        previousText: text === previous.text ? previous.previousText : previous.text }
  try {
    await redis('EVAL', "if redis.call('GET',KEYS[2])~=ARGV[1] then return 0 end; if redis.call('EXISTS',KEYS[1])==1 then redis.call('SET',KEYS[1],ARGV[2]) end; redis.call('DEL',KEYS[2]); return 1", 2, key, key + ':refresh', token, JSON.stringify(record))
  } catch { /* Retain the old answer. The lease expires on its own. */ }
}

export async function rememberAnswer(req: ApiRequest, res: ServerResponse, candidate: { key: string; immediate: boolean }, text: string) {
  if (!text.trim() || text.length > 16000) return
  try {
    const id = visitor(req, res)
    if (!id) return
    await redis('EVAL', `
      redis.call('SADD',KEYS[2],ARGV[1])
      redis.call('EXPIRE',KEYS[2],ARGV[3])
      if ARGV[4]=='1' or redis.call('SCARD',KEYS[2])>=2 then
        redis.call('SET',KEYS[1],ARGV[2],'NX')
        redis.call('PERSIST',KEYS[1])
        redis.call('DEL',KEYS[2])
      end
      return 1`, 2, candidate.key, candidate.key + ':visitors', id,
      JSON.stringify({ text, updatedAt: Date.now(), checkedAt: Date.now() }), VISITOR_TTL, candidate.immediate ? '1' : '0')
  } catch { /* Cache failure must not hide a valid Gemini answer. */ }
}
