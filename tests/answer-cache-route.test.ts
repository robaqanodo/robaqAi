import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
const mocks = vi.hoisted(() => ({ read: vi.fn(), claim: vi.fn(), finish: vi.fn(), generate: vi.fn() }))
vi.mock('../server/answer-cache.ts', async importOriginal => ({ ...await importOriginal<object>(), cachedAnswer: mocks.read, claimRefresh: mocks.claim, finishRefresh: mocks.finish }))
vi.mock('../server/gemini-chat.ts', async importOriginal => ({ ...await importOriginal<object>(), generateGroundedReply: mocks.generate }))
import handler from '../api/chat'
const text = 'HTML is a markup language used to structure content on web pages.'
async function request() {
  const req = Readable.from([JSON.stringify({ message: 'what is html', locale: 'en', history: [] })])
  Object.assign(req, { method: 'POST', headers: { origin: 'https://robaq.app', host: 'robaq.app' } })
  const res = { status: 0, body: '', writeHead(n: number) { this.status = n }, end(s: string) { this.body = s }, setHeader() {} }
  await handler(req as never, res as never)
  return { status: res.status, ...JSON.parse(res.body) }
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('GEMINI_API_KEY', 'test-only'); mocks.read.mockResolvedValue({ text, updatedAt: 1, checkedAt: 1 }); mocks.claim.mockResolvedValue('lease') })
afterEach(() => vi.unstubAllEnvs())
it('answers from fresh cache without calling Gemini', async () => {
  mocks.read.mockResolvedValue({ text, updatedAt: Date.now(), checkedAt: Date.now() })
  expect(await request()).toMatchObject({ status: 200, text, cached: true })
  expect(mocks.generate).not.toHaveBeenCalled()
})
it('serves stale answers without a key or when another request owns the lease', async () => {
  vi.stubEnv('GEMINI_API_KEY', '')
  expect(await request()).toMatchObject({ status: 200, text })
  vi.stubEnv('GEMINI_API_KEY', 'test-only'); mocks.claim.mockResolvedValue(null)
  expect(await request()).toMatchObject({ status: 200, text })
  expect(mocks.generate).not.toHaveBeenCalled()
})
it('keeps the stored answer if the provider fails', async () => {
  mocks.generate.mockRejectedValue(new Error('quota'))
  expect(await request()).toMatchObject({ status: 200, text, cached: true })
  expect(mocks.finish.mock.calls[0].at(-1)).toBeNull()
})
it('rejects a poor replacement and supplies the previous answer for review', async () => {
  mocks.generate.mockResolvedValue({ text: '', sources: [] })
  expect(await request()).toMatchObject({ status: 200, text, cached: true })
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ previousAnswer: text, history: [] }))
  expect(mocks.finish.mock.calls[0].at(-1)).toBe(text)
})
