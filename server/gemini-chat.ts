/** Server-only Gemini call. The API key stays in the request header and is never logged. */

export const PRIMARY_MODEL = 'gemini-3.5-flash-lite'
export const FALLBACK_MODEL = 'gemini-3.8-flash'
export const MAX_MESSAGE = 4000

export class ChatFailure extends Error {
  code: string
  constructor(code: string) { super(code); this.code = code }
}

function providerFailure(status: number, payload: unknown): ChatFailure {
  const error = (payload as { error?: { message?: string } } | null)?.error
  const message = error?.message ?? ''
  if (/API key not valid|API_KEY_INVALID|expired|leaked/i.test(message) || status === 401) return new ChatFailure('key_invalid')
  if (status === 403) return new ChatFailure('access_denied')
  if (status === 429) return new ChatFailure('quota')
  if (status === 404) return new ChatFailure('model_unavailable')
  return new ChatFailure('unavailable')
}

export type ChatSource = { title: string; url: string }
export type ChatTurn = { role: 'user' | 'assistant'; text: string }

type FetchLike = typeof fetch

export function systemInstruction(locale: string): string {
  const language = locale === 'ka' ? 'KA' : locale === 'ru' ? 'RU' : 'EN'
  return `You are the robaqAI assistant. Education and lawful use only. You do not have live web search in this chat. Do not claim to have searched or verified current facts. Explain when up-to-date information cannot be verified. Do not invent news. Reply in the user's language (KA, EN, or RU). The user's language is ${language}.`
}

export function sanitizeHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return []
  const turns: ChatTurn[] = []
  for (const item of value.slice(-8)) {
    if (!item || typeof item !== 'object') continue
    const role = (item as { role?: unknown }).role
    const text = (item as { text?: unknown }).text
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') continue
    const trimmed = text.trim().slice(0, MAX_MESSAGE)
    if (!trimmed) continue
    turns.push({ role, text: trimmed })
  }
  return turns
}

function chunkLink(chunk: unknown): ChatSource | null {
  if (!chunk || typeof chunk !== 'object') return null
  const record = chunk as { web?: { uri?: unknown; title?: unknown }; retrievedContext?: { uri?: unknown; title?: unknown } }
  const link = record.web ?? record.retrievedContext
  const url = typeof link?.uri === 'string' ? link.uri.trim() : ''
  if (!/^https?:\/\//i.test(url)) return null
  const title = typeof link?.title === 'string' && link.title.trim() ? link.title.trim().slice(0, 200) : url
  return { title, url }
}

/** Titles and links from Gemini groundingChunks. Empty when search returned none. */
export function sourcesFromPayload(payload: unknown): ChatSource[] {
  const candidate = (payload as { candidates?: { groundingMetadata?: { groundingChunks?: unknown[] } }[] } | null)?.candidates?.[0]
  const chunks = candidate?.groundingMetadata?.groundingChunks
  if (!Array.isArray(chunks)) return []
  const sources: ChatSource[] = []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    const source = chunkLink(chunk)
    if (!source || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
    if (sources.length === 8) break
  }
  return sources
}

function replyText(payload: unknown): string {
  const parts = (payload as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null)?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim()
}

function contents(history: ChatTurn[], message: string) {
  const rows: { role: 'user' | 'model'; text: string }[] = []
  for (const turn of history) {
    const role = turn.role === 'assistant' ? 'model' : 'user'
    const last = rows[rows.length - 1]
    if (last && last.role === role) last.text = `${last.text}\n\n${turn.text}`
    else rows.push({ role, text: turn.text })
  }
  while (rows.length && rows[0].role !== 'user') rows.shift()
  const last = rows[rows.length - 1]
  if (last && last.role === 'user') last.text = `${last.text}\n\n${message}`
  else rows.push({ role: 'user', text: message })
  return rows.map(row => ({ role: row.role, parts: [{ text: row.text }] }))
}

async function callModel(model: string, body: unknown, apiKey: string, fetchImpl: FetchLike, signal: AbortSignal) {
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    },
  )
  const payload = await response.json().catch(() => null)
  return { status: response.status, payload }
}

export async function generateGroundedReply(options: {
  apiKey: string
  message: string
  locale: string
  history?: ChatTurn[]
  fetchImpl?: FetchLike
}): Promise<{ text: string; sources: ChatSource[] }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction(options.locale) }] },
    contents: contents(options.history ?? [], options.message),
  }
  const signal = AbortSignal.timeout(24000)
  let result = await callModel(PRIMARY_MODEL, body, options.apiKey, fetchImpl, signal)
  if (result.status === 404 || result.status === 429) result = await callModel(FALLBACK_MODEL, body, options.apiKey, fetchImpl, signal)
  if (result.status !== 200) throw providerFailure(result.status, result.payload)
  const text = replyText(result.payload)
  if (!text) throw new Error('unavailable')
  return { text, sources: sourcesFromPayload(result.payload) }
}
