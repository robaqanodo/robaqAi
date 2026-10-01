import { accountRequest, usesOnlineAccounts } from './remote'
import { deviceSession } from './remember'
export type Message = { id: string; role: 'user' | 'assistant'; text: string }
export type Conversation = { id: string; title: string; messages: Message[]; updated: number; pinned?: boolean; archived?: boolean; deleted?: boolean }
export type Session = { id: string; email: string; key: CryptoKey; firstName?: string; lastName?: string; online?: boolean }
type RecordData = { firstName?: string; lastName?: string; version: 1; email: string; salt: string; iv: string; data: string }
const prefix = 'rai-account-v1:'
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))
const normalize = (email: string) => email.trim().toLowerCase()
async function accountId(email: string) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalize(email)))))
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
async function encrypt(key: CryptoKey, chats: Conversation[]) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(chats)))
  return { iv: encode(iv), data: encode(new Uint8Array(data)) }
}
export async function register(email: string, password: string, firstName = '', lastName = '', remember = false): Promise<Session> {
  email = normalize(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.')
  if (password.length < 10) throw new Error('Use a password with at least 10 characters.')
  const id = await accountId(email)
  if (localStorage.getItem(prefix + id)) throw new Error('This email already has an account on this device. Sign in instead.')
  if (usesOnlineAccounts()) await accountRequest('register', { email, password, firstName, lastName, remember })
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await derive(password, salt)
  const encrypted = await encrypt(key, [])
  // Recheck after derivation so concurrent registration cannot replace an account.
  if (localStorage.getItem(prefix + id)) throw new Error('This account already exists.')
  localStorage.setItem(prefix + id, JSON.stringify({ version: 1, email, firstName: firstName.trim().slice(0,80), lastName: lastName.trim().slice(0,80), salt: encode(salt), ...encrypted }))
  return { id, email, key, online: usesOnlineAccounts(), firstName: firstName.trim().slice(0,80), lastName: lastName.trim().slice(0,80) }
}
export async function signIn(email: string, password: string, remember = false): Promise<{ session: Session; chats: Conversation[] }> {
  email = normalize(email)
  if (!email.includes('@') && email !== 'admin') {
    const matches = Object.keys(localStorage).filter(key => key.startsWith(prefix)).flatMap(key => {
      try {
        const record = JSON.parse(localStorage.getItem(key) ?? '{}')
        return typeof record.email === 'string' && normalize(record.email).split('@')[0] === email ? [record.email] : []
      } catch { return [] }
    })
    if (matches.length > 1) throw new Error('More than one account uses this username. Enter your full email address.')
    if (matches.length === 1) email = matches[0]
  }
  const id = await accountId(email)
  await queues.get(id)?.catch(() => {})
  // Explicit local test account; it has no administrative privileges.
  if (normalize(email) === 'admin' && password === 'admin' && !localStorage.getItem(prefix + id)) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await derive(password, salt)
    const encrypted = await encrypt(key, [])
    if (!localStorage.getItem(prefix + id)) localStorage.setItem(prefix + id, JSON.stringify({ version: 1, email: 'admin', salt: encode(salt), ...encrypted }))
  }
  let onlineUser: { email: string; firstName: string; lastName: string } | undefined
  if (usesOnlineAccounts() && navigator.onLine) {
    try { onlineUser = (await accountRequest('login', { email, password, remember })).user }
    catch (error) {
      // Existing local accounts migrate only after their password has decrypted the vault.
      if (!(error instanceof Error && 'status' in error && error.status === 404)) throw error
      const legacy = localStorage.getItem(prefix + id)
      if (!legacy) throw error
      const record: RecordData = JSON.parse(legacy)
      const key = await derive(password, decode(record.salt))
      try { await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(record.iv)}, key, decode(record.data)) }
      catch { throw new Error('Email or password is incorrect.') }
      onlineUser = (await accountRequest('register', { email: record.email, password, remember, firstName: record.firstName, lastName: record.lastName })).user
    }
    if (!localStorage.getItem(prefix + id)) {
      const salt = crypto.getRandomValues(new Uint8Array(16)), key = await derive(password, salt)
      localStorage.setItem(prefix + id, JSON.stringify({ version: 1, ...onlineUser, salt: encode(salt), ...await encrypt(key, []) }))
    }
  }
  const stored = localStorage.getItem(prefix + id)
  if (!stored) throw new Error('No account was found here. Enter your full email, or open the same browser and site address used when registering.')
  const record: RecordData = JSON.parse(stored)
  const key = await derive(password, decode(record.salt))
  try {
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(record.iv) }, key, decode(record.data))
    const chats: Conversation[] = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(chats)) throw new Error('Invalid history')
    return { session: { id, email: record.email, key, online: Boolean(onlineUser), firstName: onlineUser?.firstName ?? record.firstName ?? '', lastName: onlineUser?.lastName ?? record.lastName ?? '' }, chats }
  } catch { throw new Error('Email or password is incorrect, or the local account data is damaged.') }
}
const queues = new Map<string, Promise<void>>()
export function saveChats(session: Session, chats: Conversation[]) {
  const snapshot = structuredClone(chats)
  const next = (queues.get(session.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const stored = localStorage.getItem(prefix + session.id)
    if (!stored) throw new Error('The local account is missing. Sign in again.')
    const record: RecordData = JSON.parse(stored)
    const encrypted = await encrypt(session.key, snapshot)
    const current = localStorage.getItem(prefix + session.id)
    if (!current || JSON.parse(current).salt !== record.salt) throw new Error('The account changed while saving. Sign in again.')
    localStorage.setItem(prefix + session.id, JSON.stringify({ ...JSON.parse(current), ...encrypted }))
  })
  queues.set(session.id, next)
  return next
}

export async function updateProfile(session: Session, firstName: string, lastName: string): Promise<Session> {
  await queues.get(session.id)?.catch(() => {})
  const stored = localStorage.getItem(prefix + session.id)
  if (!stored) throw new Error('The local account is missing. Sign in again.')
  if (session.online) await accountRequest('profile', { firstName, lastName })
  const names = {firstName: firstName.trim().slice(0,80), lastName: lastName.trim().slice(0,80)}
  localStorage.setItem(prefix + session.id, JSON.stringify({...JSON.parse(stored), ...names}))
  const updated = {...session, ...names}
  if ((await deviceSession())?.id === session.id) await deviceSession(updated)
  return updated
}
export async function deleteAccount(session: Session): Promise<void> {
  if (session.online) await accountRequest('delete')
  await deviceSession(null)
  await queues.get(session.id)?.catch(() => {})
  localStorage.removeItem(prefix + session.id)
  queues.delete(session.id)
}

export async function rememberSession(session: Session, remember: boolean) {
  await deviceSession(remember ? session : null)
}
export async function restoreSession(): Promise<{session: Session; chats: Conversation[]} | null> {
  const session = await deviceSession()
  if (!session) return null
  if (session.online && navigator.onLine) {
    try { const result = await accountRequest('me'); if (result.user.email !== session.email) { await deviceSession(null); return null }; Object.assign(session, {firstName:result.user.firstName,lastName:result.user.lastName}) }
    catch (error) { if (error instanceof Error && 'status' in error && error.status === 401) await deviceSession(null); return null }
  }
  const stored = localStorage.getItem(prefix + session.id)
  if (!stored) { await deviceSession(null); return null }
  try {
    const record: RecordData = JSON.parse(stored)
    const bytes = await crypto.subtle.decrypt({ name:'AES-GCM', iv:decode(record.iv) }, session.key, decode(record.data))
    return {session, chats:JSON.parse(new TextDecoder().decode(bytes))}
  } catch { await deviceSession(null); return null }
}
export async function signOut() {
  await deviceSession(null)
  if (usesOnlineAccounts()) await accountRequest('logout')
}
