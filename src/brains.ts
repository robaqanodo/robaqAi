/** Offline Brain AI Lab catalog + local download/storage for chat knowledge packs. */

import builtinOfflinePack from './nodo-offline.json'

export type OfflineLang = 'en' | 'ka' | 'ru'

export type BrainIntent = {
  id: string
  triggers: string[]
  replies: Partial<Record<OfflineLang, string>> & { en: string }
}

export type BrainFactPack = {
  id: string
  name: string
  version: number
  description: string
  facts: string[]
  /** When true, pack is treated as always-on for offline mock (no manual download). */
  alwaysOn?: boolean
  intents?: BrainIntent[]
}

export type BrainCatalogEntry = {
  id: string
  name: string
  description: string
  /** Public URL path to the JSON pack (bundled under /brains/). */
  url: string
  alwaysOn?: boolean
}

export const DEFAULT_OFFLINE_BRAIN_ID = 'nodo-offline'

/** Future brains append here; UI maps over the catalog. */
export const BRAIN_CATALOG: BrainCatalogEntry[] = [
  {
    id: 'nodo-offline',
    name: 'robaqAI Offline Guide',
    description: 'Always-on — greetings, API setup, create keys, FAQ (EN/KA/RU)',
    url: '/brains/nodo-offline.json',
    alwaysOn: true,
  },
  {
    id: 'test-1',
    name: 'Test 1',
    description: 'Offline knowledge pack — robaqAI / Georgian AI demo',
    url: '/brains/test-1.json',
  },
]

const LS_BRAINS = 'grok-chat-brains'

type StoredBrains = Record<string, BrainFactPack>

function asPack(raw: unknown): BrainFactPack | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as BrainFactPack
  if (!p.id || !Array.isArray(p.facts)) return null
  return p
}

/** Built-in always-on pack (bundled) so offline mock works without a prior download. */
export const BUILTIN_OFFLINE_PACK: BrainFactPack = asPack(builtinOfflinePack) ?? {
  id: DEFAULT_OFFLINE_BRAIN_ID,
  name: 'robaqAI Offline Guide',
  version: 1,
  description: 'Always-on offline help',
  alwaysOn: true,
  facts: [],
  intents: [],
}

function readStore(): StoredBrains {
  try {
    const raw = localStorage.getItem(LS_BRAINS)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as StoredBrains
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: StoredBrains): void {
  try {
    localStorage.setItem(LS_BRAINS, JSON.stringify(store))
  } catch {
    /* ignore quota / private mode */
  }
}

export function isBrainDownloaded(id: string): boolean {
  if (id === DEFAULT_OFFLINE_BRAIN_ID) return true
  return Boolean(readStore()[id])
}

export function listDownloadedBrains(): BrainFactPack[] {
  const store = readStore()
  const packs = Object.values(store)
  if (!store[DEFAULT_OFFLINE_BRAIN_ID]) {
    packs.unshift(BUILTIN_OFFLINE_PACK)
  }
  return packs
}

export function getDownloadedBrain(id: string): BrainFactPack | null {
  if (id === DEFAULT_OFFLINE_BRAIN_ID) {
    return readStore()[id] ?? BUILTIN_OFFLINE_PACK
  }
  return readStore()[id] ?? null
}

/** Fetch pack from public URL and persist locally for offline chat use. */
export async function downloadBrain(id: string): Promise<BrainFactPack> {
  const entry = BRAIN_CATALOG.find((b) => b.id === id)
  if (!entry) throw new Error(`Unknown brain: ${id}`)

  // Always-on builtin: seed immediately, refresh from network when possible
  if (id === DEFAULT_OFFLINE_BRAIN_ID) {
    const store = readStore()
    store[DEFAULT_OFFLINE_BRAIN_ID] = BUILTIN_OFFLINE_PACK
    writeStore(store)
  }

  const res = await fetch(entry.url)
  if (!res.ok) {
    if (id === DEFAULT_OFFLINE_BRAIN_ID) return BUILTIN_OFFLINE_PACK
    throw new Error(`Download failed (${res.status})`)
  }
  const pack = asPack(await res.json())
  if (!pack) {
    if (id === DEFAULT_OFFLINE_BRAIN_ID) return BUILTIN_OFFLINE_PACK
    throw new Error('Invalid brain pack')
  }

  const store = readStore()
  store[pack.id] = pack
  writeStore(store)
  return pack
}

/**
 * Ensure the always-on offline guide is installed (localStorage + builtin fallback).
 * Safe to call on every app load; does not require the user to open AI Lab first.
 */
export async function ensureDefaultOfflineBrain(): Promise<BrainFactPack> {
  const existing = readStore()[DEFAULT_OFFLINE_BRAIN_ID]
  if (existing?.intents?.length && existing.version === BUILTIN_OFFLINE_PACK.version) return existing

  // Seed builtin synchronously so matching works before fetch finishes
  const store = readStore()
  store[DEFAULT_OFFLINE_BRAIN_ID] = BUILTIN_OFFLINE_PACK
  writeStore(store)

  try {
    return await downloadBrain(DEFAULT_OFFLINE_BRAIN_ID)
  } catch {
    return BUILTIN_OFFLINE_PACK
  }
}

/** Context string appended to the system prompt when packs are installed. */
export function getOfflineKnowledgeContext(): string {
  const packs = listDownloadedBrains()
  if (packs.length === 0) return ''
  const blocks = packs.map((p) => {
    const facts = p.facts.map((f) => `- ${f}`).join('\n')
    return `[Brain: ${p.name}]\n${facts}`
  })
  return (
    'You also have these offline knowledge packs installed. Use them when relevant:\n\n' +
    blocks.join('\n\n')
  )
}

/** Detect reply language from the user message (Georgian / Russian / English). */
export function detectOfflineLang(text: string): OfflineLang {
  const t = text || ''
  if (/[\u10A0-\u10FF]/.test(t)) return 'ka'
  if (/[\u0400-\u04FF]/.test(t)) return 'ru'
  return 'en'
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreIntent(query: string, intent: BrainIntent): number {
  const q = normalizeForMatch(query)
  if (!q) return 0
  let best = 0
  for (const raw of intent.triggers) {
    const t = normalizeForMatch(raw)
    if (!t) continue
    if (q === t) best = Math.max(best, 100)
    else if (q.includes(t)) best = Math.max(best, 60 + Math.min(t.length, 30))
    else if (t.length >= 4 && t.includes(q) && q.length >= 3) best = Math.max(best, 40)
    else {
      // token overlap for multi-word queries
      const qTokens = q.split(/[^a-z0-9\u10a0-\u10ff\u0400-\u04ff]+/i).filter((w) => w.length > 2)
      const tTokens = t.split(/[^a-z0-9\u10a0-\u10ff\u0400-\u04ff]+/i).filter((w) => w.length > 2)
      let hits = 0
      for (const tok of tTokens) {
        if (qTokens.some((qt) => qt === tok || qt.includes(tok) || tok.includes(qt))) hits += 1
      }
      if (hits > 0 && tTokens.length > 0) {
        best = Math.max(best, Math.round((hits / tTokens.length) * 50))
      }
    }
  }
  // Disambiguate create vs save: creation verbs boost create_key; settings/save boost save_api
  const createCue = /create|generat|get (an? )?api|make (an? )?key|aistudio|ai studio|platform\.openai|console\.anthropic|создать|сгенерир|получить ключ|შექმნ/i.test(q)
  const saveCue = /add (an? )?api|save (my )?key|paste|settings|добавить|сохранить|вставить|დამატ|შენახვ|პარამეტრ/i.test(q)
  if (intent.id === 'create_key' && createCue) best += 25
  if (intent.id === 'save_api' && saveCue) best += 25
  if (intent.id === 'save_api' && createCue && !saveCue) best = Math.max(0, best - 20)
  if (intent.id === 'create_key' && saveCue && !createCue) best = Math.max(0, best - 20)
  return best
}

function pickReply(intent: BrainIntent, lang: OfflineLang): string {
  return intent.replies[lang] || intent.replies.en
}

function collectIntentPacks(): BrainFactPack[] {
  const packs = listDownloadedBrains()
  // Guarantee builtin intents even if store was cleared mid-session
  if (!packs.some((p) => p.id === DEFAULT_OFFLINE_BRAIN_ID && (p.intents?.length ?? 0) > 0)) {
    return [BUILTIN_OFFLINE_PACK, ...packs.filter((p) => p.id !== DEFAULT_OFFLINE_BRAIN_ID)]
  }
  return packs
}

const FALLBACK_REPLIES: Record<OfflineLang, string> = {
  en: "I'm sorry, I don't have information on that topic yet. For full access, I recommend adding an API key. Want instructions?",
  ka: 'ბოდიში, ამ თემაზე ინფორმაცია ჯერ არ მაქვს. სრული წვდომისთვის გირჩევ API გასაღების დამატებას. გინდა ინსტრუქცია?',
  ru: 'Извини, у меня пока нет информации по этой теме. Для полного доступа рекомендую добавить API-ключ. Хочешь инструкцию?',
}

export type OfflineAnswerContext = {
  previousUserQuery?: string
  previousAssistantReply?: string
}

/** True when a reply is the localized no-match prompt, for follow-up handling. */
export function isOfflineFallbackReply(text: string): boolean {
  return Object.values(FALLBACK_REPLIES).some((reply) => reply === text.trim())
}

function isAffirmativeOrInstructionRequest(query: string): boolean {
  const q = normalizeForMatch(query)
  if (!q) return false
  return (
    /^(yes|yeah|yep|sure|okay|ok|please|да|ага|конечно|хочу|давай|კი|დიახ|კარგი|მინდა)(?:\s|[,.!?]|$)/u.test(q) ||
    /\b(want|need|show|give|tell|instruction|instructions|steps|how to)\b/u.test(q) ||
    /(?:инструкц|шаги|покажи|хочу|давай|как\s+добав|как\s+созд)/u.test(q) ||
    /(?:ინსტრუქც|ნაბიჯ|მაჩვენე|მინდა|მომეცი|როგორ\s+დამატ|როგორ\s+შექმნ)/u.test(q)
  )
}

function instructionIntentForFollowUp(query: string): 'save_api' | 'create_key' {
  const q = normalizeForMatch(query)
  return /create|generat|get (an? )?api|make (an? )?key|aistudio|ai studio|platform\.openai|console\.anthropic|созда|сгенер|получить ключ|შექმნ|გენერ|სად ავიღო/u.test(q)
    ? 'create_key'
    : 'save_api'
}

/**
 * Intent-aware offline lookup (no API).
 * Matches greeting / save-api / create-key / faq / smalltalk and replies in the same language as the user (ka/ru/en).
 */
export function answerFromOfflineBrains(query: string, context?: OfflineAnswerContext): string | null {
  const q = query.trim()
  if (!q) return null

  const lang = detectOfflineLang(q)
  const packs = collectIntentPacks()

  // A fallback explicitly asks whether the user wants setup instructions. Resolve a
  // short yes/affirmative against the previous fallback instead of treating it as
  // unrelated small talk.
  if (
    context?.previousAssistantReply &&
    isOfflineFallbackReply(context.previousAssistantReply) &&
    isAffirmativeOrInstructionRequest(q)
  ) {
    const requestedId = instructionIntentForFollowUp(q)
    const requestedIntent = packs
      .flatMap((pack) => pack.intents ?? [])
      .find((intent) => intent.id === requestedId)
    if (requestedIntent) return pickReply(requestedIntent, lang)
  }

  type Scored = { score: number; intent: BrainIntent; packName: string }
  let best: Scored | null = null

  for (const pack of packs) {
    for (const intent of pack.intents ?? []) {
      const score = scoreIntent(q, intent)
      if (score > 0 && (!best || score > best.score)) {
        best = { score, intent, packName: pack.name }
      }
    }
  }

  // Prefer a clear intent hit; soft threshold avoids random weak overlaps
  if (best && best.score >= 35) {
    return pickReply(best.intent, lang)
  }

  // Legacy fact substring match (other downloaded packs without intents)
  const allFacts = packs.flatMap((p) => p.facts.map((f) => ({ pack: p.name, fact: f })))
  const hit = allFacts.find(({ fact }) => {
    const fl = fact.toLowerCase()
    const words = fl.split(/[^a-z0-9\u10a0-\u10ff\u0400-\u04ff]+/i).filter((w) => w.length > 3)
    const ql = q.toLowerCase()
    return (
      words.some((w) => ql.includes(w)) ||
      ql.split(/\s+/).some((w) => w.length > 3 && fl.includes(w))
    )
  })
  if (hit) {
    // Return the matched fact itself; don't wrap it in attribution or an API upsell.
    return hit.fact
  }

  // Warm default so offline never feels empty
  return FALLBACK_REPLIES[lang]
}
