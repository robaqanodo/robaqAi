/** Shared types, key detection, storage, and reply router for Gemini / OpenAI / Claude. */

import { getOfflineKnowledgeContext } from './brains'

export type ProviderId = 'gemini' | 'openai' | 'claude'

export type ChatTurn = {
  role: 'user' | 'assistant'
  text: string
}

export type PendingFile = {
  id: string
  name: string
  mimeType: string
  /** Raw base64 (no data: prefix) for inlineData, or decoded UTF-8 text for text/* */
  data: string
  kind: 'inline' | 'text'
}

export const LS_API_KEY = 'grok-chat-api-key'
export const LS_PROVIDER = 'grok-chat-api-provider'
export const LS_API_UPDATED = 'grok-chat-api-key-updated'

const SYSTEM_PROMPT =
  'You are a helpful assistant in a chat UI. Always reply in the same language the user is using (including Georgian). Do not force English or translate unless asked. Keep answers concise unless asked for detail.'

export { SYSTEM_PROMPT }

/** Base system prompt plus any downloaded Brain AI Lab offline packs. */
export function getSystemPrompt(): string {
  const extra = getOfflineKnowledgeContext()
  return extra ? `${SYSTEM_PROMPT}\n\n${extra}` : SYSTEM_PROMPT
}

const TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
  'text/xml',
])

function isTextMime(mime: string, name: string): boolean {
  if (TEXT_MIMES.has(mime)) return true
  if (mime.startsWith('text/')) return true
  return /\.(txt|md|csv|json|xml|html|htm|ts|tsx|js|jsx|css|py|rb|go|rs|java|c|cpp|h|sh)$/i.test(
    name,
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Could not read file'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.readAsDataURL(file)
  })
}

function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read file'))
        return
      }
      resolve(reader.result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.readAsText(file)
  })
}

export async function preparePendingFile(file: File, id: string): Promise<PendingFile> {
  const mimeType = file.type || 'application/octet-stream'
  if (isTextMime(mimeType, file.name)) {
    const data = await fileToText(file)
    return {
      id,
      name: file.name,
      mimeType: mimeType.startsWith('text/') ? mimeType : 'text/plain',
      data,
      kind: 'text',
    }
  }
  const data = await fileToBase64(file)
  return { id, name: file.name, mimeType, data, kind: 'inline' }
}

/** Strip quotes, env wrappers, Bearer, and whitespace from a pasted key. */
export function normalizeApiKey(raw: string): string {
  let key = raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '')
  if (!key) return ''
  // KEY=value / export KEY="value" pastes from .env
  const env = key.match(
    /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/,
  )
  if (env) key = env[1].trim()
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim()
  }
  key = key.replace(/^Bearer\s+/i, '').trim()
  // API keys never contain spaces; strip wrapping newlines from rich paste
  key = key.replace(/\s+/g, '')
  return key
}

export const PROVIDER_OPTIONS: { id: ProviderId; label: string; hint: string }[] = [
  { id: 'gemini', label: 'Gemini', hint: 'Google AI Studio' },
  { id: 'openai', label: 'OpenAI', hint: 'sk-…' },
  { id: 'claude', label: 'Anthropic', hint: 'sk-ant-…' },
]

/**
 * Detect provider from a pasted API key.
 * Order: Claude (sk-ant-…) → OpenAI (sk-…) → Gemini (AIza… / Google-like).
 * Soft Gemini: classic AIza, AI… long keys, or Google-ish shapes.
 */
export function detectProvider(apiKey: string): ProviderId | null {
  const key = normalizeApiKey(apiKey)
  if (!key) return null
  if (/^sk-ant-/i.test(key)) return 'claude'
  if (/^sk-/i.test(key)) return 'openai'
  // Classic Google AI Studio / Gemini keys
  if (/^AIza[0-9A-Za-z_-]{8,}/i.test(key)) return 'gemini'
  // Soft: AI + long token (some newer Google key shapes)
  if (/^AI[a-zA-Z0-9_-]{20,}$/.test(key)) return 'gemini'
  // Google-like: long URL-safe token mentioning google/gemini/genai, or AIza anywhere
  if (/AIza[0-9A-Za-z_-]{8,}/i.test(key)) return 'gemini'
  if (
    /^[A-Za-z0-9_-]{32,}$/.test(key) &&
    /(?:google|gemini|genai|googleapis)/i.test(key)
  ) {
    return 'gemini'
  }
  // Longish alphanumeric with no sk-/sk-ant- prefix — likely Gemini if it starts with AI
  if (/^AI/i.test(key) && key.length >= 25 && /^[A-Za-z0-9_-]+$/.test(key)) {
    return 'gemini'
  }
  return null
}

export function isValidProvider(v: string | null | undefined): v is ProviderId {
  return v === 'gemini' || v === 'openai' || v === 'claude'
}

export function loadStoredCredentials(): { apiKey: string; provider: ProviderId | null } {
  try {
    const raw = localStorage.getItem(LS_API_KEY) ?? ''
    const apiKey = normalizeApiKey(raw)
    const stored = localStorage.getItem(LS_PROVIDER)
    let provider: ProviderId | null = isValidProvider(stored) ? stored : null
    if (apiKey) {
      const detected = detectProvider(apiKey)
      // Prefer fresh detection; keep stored provider when key is ambiguous
      if (detected) provider = detected
      else if (!provider) provider = null
    } else {
      provider = null
    }
    return { apiKey, provider }
  } catch {
    return { apiKey: '', provider: null }
  }
}

export function saveCredentials(apiKey: string, provider: ProviderId | null): void {
  try {
    const trimmed = normalizeApiKey(apiKey)
    if (trimmed) {
      localStorage.setItem(LS_API_KEY, trimmed)
      if (provider) localStorage.setItem(LS_PROVIDER, provider)
      else localStorage.removeItem(LS_PROVIDER)
    } else {
      localStorage.removeItem(LS_API_KEY)
      localStorage.removeItem(LS_PROVIDER)
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearCredentials(): void {
  saveCredentials('', null)
}

export function formatApiError(err: unknown, provider?: ProviderId | null): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/API_KEY_INVALID|api key not valid|invalid api key|incorrect api key|authentication|401|unauthorized/i.test(raw)) {
    const hint =
      provider === 'openai'
        ? 'OpenAI (sk-…)'
        : provider === 'claude'
          ? 'Anthropic (sk-ant-…)'
          : provider === 'gemini'
            ? 'Google AI Studio (AIza…)'
            : 'Anthropic (sk-ant-…), Gemini (AIza…), or OpenAI (sk-…)'
    return `Invalid API key. Open API and paste a valid key — ${hint}.`
  }
  if (/503|high demand|overloaded|temporarily unavailable/i.test(raw)) {
    return 'This AI service is temporarily busy. Please try again shortly, or switch to another API provider: Gemini, OpenAI, or Anthropic.'
  }
  if (/insufficient_quota|quota.{0,40}(exceeded|exhausted)|exceeded.{0,40}quota|credit.{0,30}(exhausted|balance|insufficient)|billing|resource_exhausted/i.test(raw)) {
    return 'Your API usage quota or credits have been exhausted. Please replenish your account or add an API key from another provider: Gemini, OpenAI, or Anthropic.'
  }
  if (/rate.?limit|429/i.test(raw)) {
    return 'Your API request limit has been reached. Please wait a moment and try again, or switch to Gemini, OpenAI, or Anthropic.'
  }
  if (/CORS|Failed to fetch|NetworkError|network/i.test(raw)) {
    return 'Network error reaching the API. Check your connection and try again.'
  }
  if (/SAFETY|blocked|content_policy|content.?filter/i.test(raw)) {
    return 'That reply was blocked for safety. Try rephrasing.'
  }
  if (/unrecognized.?provider|unknown.?key|could not detect/i.test(raw)) {
    return 'Could not detect provider. Pick Gemini, OpenAI, or Anthropic and paste a matching key (AIza… / sk-… / sk-ant-…).'
  }
  const short = raw
    .trim()
    .replace(/^(?:Error:\s*:?[\s]*)+/i, '')
    .replace(/^\[GoogleGenerativeAI Error\]:\s*/i, '')
    .slice(0, 280)
  return short ? `API error: ${short}` : 'Request failed.'
}

export async function generateReply(
  provider: ProviderId,
  apiKey: string,
  history: ChatTurn[],
  userText: string,
  files: PendingFile[],
): Promise<string> {
  const key = normalizeApiKey(apiKey)
  if (!key) throw new Error('Missing API key')

  if (provider === 'gemini') {
    const { generateGeminiReply } = await import('./gemini')
    return generateGeminiReply(key, history, userText, files)
  }
  if (provider === 'openai') {
    const { generateOpenAIReply } = await import('./openai')
    return generateOpenAIReply(key, history, userText, files)
  }
  if (provider === 'claude') {
    const { generateClaudeReply } = await import('./claude')
    return generateClaudeReply(key, history, userText, files)
  }
  throw new Error('Unrecognized provider')
}

/** Theme class suffix for LivingCell / shell styling. */
export function providerThemeClass(provider: ProviderId | null): string {
  if (!provider) return ''
  return `theme-${provider}`
}
