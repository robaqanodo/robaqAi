// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { packInstalled } from '../src/translation/package'
import { translateOffline } from '../src/translation/client'
import { formatApiError, generateReply } from '../src/providers'

vi.mock('../src/providers', async (original) => ({
  ...await original<typeof import('../src/providers')>(),
  generateReply: vi.fn(),
}))
vi.mock('../src/brains', async (original) => ({
  ...await original<typeof import('../src/brains')>(),
  ensureDefaultOfflineBrain: vi.fn().mockResolvedValue({}),
}))

vi.mock('../src/translation/package', async original => ({ ...await original<typeof import('../src/translation/package')>(), packInstalled: vi.fn().mockResolvedValue(false) }))
vi.mock('../src/translation/client', () => ({ translateOffline: vi.fn(), stopTranslationWorker: vi.fn() }))

class Recognizer {
  static instances: Recognizer[] = []
  onresult: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  constructor() { Recognizer.instances.push(this) }
  say(text: string) {
    this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: true })] })
    this.onend?.()
  }
}
const synthesis = {
  cancel: vi.fn(), speak: vi.fn(),
  getVoices: () => [{ name: 'Daniel', lang: 'en-GB' }],
  addEventListener: vi.fn(), removeEventListener: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(packInstalled).mockResolvedValue(false)
  localStorage.clear()
  Recognizer.instances = []
  vi.stubGlobal('SpeechRecognition', Recognizer)
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }))
  Element.prototype.scrollTo = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function openConnectedChat() {
  localStorage.setItem('grok-chat-api-key', 'AIza-local-test-key')
  localStorage.setItem('grok-chat-api-provider', 'gemini')
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
}
function startVoice() {
  fireEvent.click(screen.getByRole('button', { name: 'Start voice conversation' }))
  return Recognizer.instances.at(-1)!
}
function removeKey() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Remove API Key/ }))
}

test('Gemini is selected by default and no conversation microphone is shown offline', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
  expect(screen.queryByRole('button', { name: 'Start voice conversation' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Add API Key/ }))
  expect(screen.getByRole('button', { name: 'Gemini' }).className).toContain('is-active')
})

test('voice transcripts and replies appear in chat, are read aloud, and listening resumes', async () => {
  vi.mocked(generateReply).mockResolvedValue('Hello from Birdoff')
  openConnectedChat()
  expect(screen.queryByRole('button', { name: 'API key' })).toBeNull()
  const recognition = startVoice()
  expect(document.querySelector('.landing-entry .intelligence-orb')?.getAttribute('data-state')).toBe('listening')
  expect(document.querySelector('.composer')?.classList.contains('is-voice-active')).toBe(true)
  expect(document.querySelector('.composer')?.getAttribute('data-provider')).toBe('gemini')
  expect(document.querySelector('.composer')?.getAttribute('data-voice-moving')).toBe('true')
  await act(async () => { recognition.say('Hello there') })
  expect(screen.getByText('Hello there')).toBeTruthy()
  expect(screen.getByText('Hello from Birdoff')).toBeTruthy()
  expect(synthesis.speak).toHaveBeenCalledTimes(1)
  expect(synthesis.speak.mock.calls[0][0].text).toBe('Hello from Birdoff')
  act(() => synthesis.speak.mock.calls[0][0].onstart())
  expect(document.querySelector('.landing-entry .intelligence-orb')?.getAttribute('data-state')).toBe('speaking')
  act(() => synthesis.speak.mock.calls[0][0].onend())
  expect(Recognizer.instances).toHaveLength(2)
})

test('removing the key stops microphone/audio and removes voice controls', () => {
  openConnectedChat()
  const recognition = startVoice()
  removeKey()
  expect(recognition.stop).toHaveBeenCalled()
  expect(synthesis.cancel).toHaveBeenCalled()
  expect(localStorage.getItem('grok-chat-api-key')).toBeNull()
  expect(document.querySelector('.composer.is-voice-active')).toBeNull()
  expect(document.querySelector('.composer-voice-line')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Stop voice conversation' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Start voice conversation' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'API key' })).toBeNull()
})

test('stale reply from a stopped session cannot enter a restarted conversation', async () => {
  let resolveReply!: (reply: string) => void
  vi.mocked(generateReply).mockImplementation(() => new Promise((resolve) => { resolveReply = resolve }))
  openConnectedChat()
  act(() => startVoice().say('First request'))
  await waitFor(() => expect(generateReply).toHaveBeenCalledTimes(1))
  expect(document.querySelector('.landing-entry .intelligence-orb')?.getAttribute('data-state')).toBe('thinking')
  fireEvent.click(screen.getByRole('button', { name: 'Stop voice conversation' }))
  startVoice()
  await act(async () => resolveReply('Stale response'))
  expect(screen.queryByText('Stale response')).toBeNull()
  expect(synthesis.speak).not.toHaveBeenCalled()
})

test('recognition permission errors stop the session without repeated retries', () => {
  openConnectedChat()
  const recognition = startVoice()
  act(() => recognition.onerror?.())
  expect(screen.queryByRole('button', { name: 'Stop voice conversation' })).toBeNull()
  expect(screen.getByText(/Voice stopped/)).toBeTruthy()
  expect(recognition.abort).toHaveBeenCalled()
})


test('menu microphone keeps chat closed and preserves the voice exchange', async () => {
  localStorage.setItem('grok-chat-api-key', 'AIza-local-test-key')
  localStorage.setItem('grok-chat-api-provider', 'gemini')
  vi.mocked(generateReply).mockResolvedValue('Landing reply')
  render(<App />)
  expect(document.querySelectorAll('.rail-mic')).toHaveLength(1)
  expect(document.querySelector('.landing-mic-art')).toBeNull()
  const recognition = startVoice()
  expect(document.querySelector('.rail-mic')?.getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('.app-shell.is-chat-open')).toBeNull()
  expect(document.querySelector('.app-shell.is-landing')).toBeTruthy()
  expect(document.querySelector('.rail-mic')?.getAttribute('data-voice-moving')).toBe('true')
  await act(async () => recognition.say('Landing question'))
  expect(synthesis.speak).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Stop voice conversation' }))
  expect(synthesis.cancel).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Start voice conversation' })).toBeTruthy()
  expect(screen.getByText('Landing question')).toBeTruthy()
  expect(screen.getByText('Landing reply')).toBeTruthy()
  expect(document.querySelector('.chat-intelligence .intelligence-orb')).toBeNull()
  expect(document.querySelector('.chat-intelligence')?.textContent).toBe('Birdoff')
})

test.each([
  ['AIza-local-test-key', 'Gemini', 'OpenAI'],
  ['sk-local-test-key', 'OpenAI', 'Anthropic'],
  ['sk-ant-local-test-key', 'Anthropic', 'Gemini'],
])('mismatched provider is rejected before saving %s', (key, correct, wrong) => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Add API Key/ }))
  fireEvent.change(screen.getByPlaceholderText('AIza… / sk-… / sk-ant-…'), { target: { value: key } })
  fireEvent.click(screen.getByRole('button', { name: wrong }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('alert').textContent).toBe(`Detected a ${correct} API key. Select ${correct} below to add this key.`)
  expect(localStorage.getItem('grok-chat-api-key')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: correct }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(localStorage.getItem('grok-chat-api-key')).toBe(key)
})

test('voice toggles placeholder and landing microphone artwork', () => {
  openConnectedChat()
  startVoice()
  expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('placeholder')).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Stop voice conversation' }))
  expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('placeholder')).toBe('Write a message…')
})

test('Updates is separate from Settings and offers both destinations', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(screen.queryByText('Check for Updates')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'AI Lab' }))
  expect(screen.getByRole('button', { name: 'Check for Updates' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'AI Lab' })).toBeTruthy()
})


test('unrecognized Gemini key formats use the selected provider without rejecting the key', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Add API Key/ }))
  const key = 'unrecognized-format-local-test-token'
  fireEvent.change(screen.getByPlaceholderText('AIza… / sk-… / sk-ant-…'), { target: { value: key } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(localStorage.getItem('grok-chat-api-key')).toBe(key)
  expect(localStorage.getItem('grok-chat-api-provider')).toBe('gemini')
})


test('navigation keeps settings in the rail and API removal inside settings', () => {
  localStorage.setItem('grok-chat-api-key', 'AIza-local-test-key')
  localStorage.setItem('grok-chat-api-provider', 'gemini')
  render(<App />)
  expect(screen.queryByRole('button', { name: 'Updates' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Remove API Key/ }))
  expect(localStorage.getItem('grok-chat-api-key')).toBeNull()
  expect(screen.getByRole('button', { name: 'AI Lab' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Start voice conversation' })).toBeNull()
})


test('service overload is not reported as exhausted credits', () => {
  expect(formatApiError(new Error('[503] This model is currently experiencing high demand.'))).toContain('temporarily busy')
  expect(formatApiError(new Error('insufficient_quota'))).toContain('quota or credits have been exhausted')
  expect(formatApiError(new Error('429 rate limit'))).toContain('Please wait')
})

test('update checker compares versions and only offers secure downloads', async () => {
  const { checkForUpdate, currentVersion } = await import('../src/updates')
  vi.stubEnv('VITE_UPDATE_MANIFEST_URL', 'https://updates.example.test/manifest.json')
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: currentVersion }) })
  vi.stubGlobal('fetch', fetchMock)
  try {
    expect((await checkForUpdate()).status).toBe('current')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ version: '999.0.0', downloadUrl: 'https://updates.example.test/app.zip' }) })
    expect(await checkForUpdate()).toEqual({ status: 'available', version: '999.0.0', downloadUrl: 'https://updates.example.test/app.zip' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ version: '999.0.0', downloadUrl: 'javascript:alert(1)' }) })
    await expect(checkForUpdate()).rejects.toThrow('invalid')
    vi.stubEnv('VITE_UPDATE_MANIFEST_URL', '')
    await expect(checkForUpdate()).rejects.toThrow('not configured')
  } finally { vi.unstubAllEnvs() }
})

test('AI Lab opens translators on a separate page and keeps the truck guide as Soon only', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'AI Lab' }))
  expect(screen.getByText("STDG 1.0 (Truck Driver's Guide)")).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Manual Submit' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Translator' }))
  expect(screen.getByText('🇬🇧 English (en)')).toBeTruthy()
  expect(screen.getByText('🇬🇪 Georgian (ka)')).toBeTruthy()
  expect(screen.getByText('🇷🇺 Russian (ru)')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Manual Submit' })).toBeTruthy()
  expect(screen.queryByText("STDG 1.0 (Truck Driver's Guide)")).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Back to AI Lab' }))
  expect(screen.getByRole('heading', { name: 'AI Lab', exact: true })).toBeTruthy()
})


test('installed translator answers in offline chat without an API', async () => {
  vi.mocked(packInstalled).mockResolvedValue(true)
  vi.mocked(translateOffline).mockResolvedValue('გამარჯობა')
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
  await screen.findByRole('checkbox', { name: 'Offline Translator' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hello' } })
  fireEvent.submit(document.querySelector('form.composer')!)
  await waitFor(() => expect(translateOffline).toHaveBeenCalledWith('Hello', 'en', 'ka'))
  await screen.findByText('გამარჯობა')
  expect(generateReply).not.toHaveBeenCalled()
})

test('installed translator has no separate translation editor in the AI Lab', async () => {
  vi.mocked(packInstalled).mockResolvedValue(true)
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'AI Lab' }))
  fireEvent.click(screen.getByRole('button', { name: 'Translator' }))
  await screen.findByText('Ready to use in chat. Open chat and choose your languages under Offline Translator.')
  expect(screen.queryByRole('textbox', { name: 'Text to translate' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Open', exact: true })).toBeNull()
})
