import type { ProviderId } from '../providers'

export type AccountKey = { apiKey: string; provider: ProviderId | null; updated: number }
export type SealedKey = { iv: string; data: string }

const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))

export async function deriveSyncKey(password: string, email: string) {
  const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`robaq-api-sync:${email.trim().toLowerCase()}`)))
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function sealJson(key: CryptoKey, value: AccountKey): Promise<SealedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  return { iv: encode(iv), data: encode(new Uint8Array(data)) }
}

export async function openJson(key: CryptoKey, iv: string, data: string): Promise<AccountKey> {
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, key, decode(data))
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<AccountKey>
  const provider = parsed.provider === 'gemini' || parsed.provider === 'openai' || parsed.provider === 'claude' ? parsed.provider : null
  if (typeof parsed.apiKey !== 'string' || typeof parsed.updated !== 'number' || !Number.isFinite(parsed.updated)) throw new Error('Invalid key vault')
  return { apiKey: parsed.apiKey, provider, updated: parsed.updated }
}
