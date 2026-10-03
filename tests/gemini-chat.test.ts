import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from '../api/chat'
import { sourcesFromPayload } from '../server/gemini-chat'
import type { ApiRequest } from '../server/redis'

function fakeReq(payload: object, method = 'POST') {
  const stream = Readable.from([JSON.stringify(payload)]) as ApiRequest
  stream.method = method
  stream.headers = { origin: 'http://127.0.0.1:8787', host: '127.0.0.1:8787', 'content-type': 'application/json' }
  stream.socket = { remoteAddress: '127.0.0.1' } as ApiRequest['socket']
  return stream
}
function fakeRes() {
  return { status: 0, body: '', writeHead(code: number) { this.status = code }, end(data?: string) { this.body = data ?? '' }, setHeader() {} }
}
async function call(payload: object, method = 'POST') {
  const res = fakeRes()
  await handler(fakeReq(payload, method), res as never)
  return { status: res.status, body: res.body ? JSON.parse(res.body) as Record<string, unknown> : {} }
}

const saved = process.env.GEMINI_API_KEY
afterEach(() => {
  if (saved === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = saved
  vi.unstubAllGlobals()
})

describe('default web chat', () => {
  it('reads source titles and links from groundingChunks', () => {
    expect(sourcesFromPayload({
      candidates: [{ groundingMetadata: { groundingChunks: [
        { web: { uri: 'https://example.com/a', title: 'Alpha' } },
        { web: { uri: 'https://example.com/a', title: 'Alpha again' } },
        { retrievedContext: { uri: 'https://example.com/b', title: 'Beta' } },
        { web: { uri: 'notaurl', title: 'Skip' } },
      ] } }],
    })).toEqual([
      { title: 'Alpha', url: 'https://example.com/a' },
      { title: 'Beta', url: 'https://example.com/b' },
    ])
    expect(sourcesFromPayload({ candidates: [{ content: { parts: [{ text: 'No search hit' }] } }] })).toEqual([])
  })

  it('rejects non-POST and does not answer without a server key', async () => {
    delete process.env.GEMINI_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await call({ message: 'hi' }, 'GET')).status).toBe(405)
    const missing = await call({ message: 'hi' })
    expect(missing.status).toBe(503)
    expect(missing.body).toEqual({ error: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(missing.body)).not.toMatch(/AIza|GEMINI_API_KEY/)
  })

  it('uses gemini-3.8-flash, falls back on 404, and returns text plus sources', async () => {
    process.env.GEMINI_API_KEY = 'server-test-key'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: 'A grounded reply' }] },
          groundingMetadata: { groundingChunks: [{ web: { uri: 'https://news.example/story', title: 'Story' } }] },
        }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await call({ message: 'What happened today?', locale: 'ka', history: [{ role: 'user', text: 'Earlier' }] })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ text: 'A grounded reply', sources: [{ title: 'Story', url: 'https://news.example/story' }] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = fetchMock.mock.calls[0]
    const second = fetchMock.mock.calls[1]
    expect(String(first[0])).toContain('/models/gemini-3.8-flash:generateContent')
    expect(String(second[0])).toContain('/models/gemini-2.5-flash:generateContent')
    expect(String(first[0])).not.toContain('server-test-key')
    expect(first[1].headers['x-goog-api-key']).toBe('server-test-key')
    const sent = JSON.parse(first[1].body as string)
    expect(sent.tools).toEqual([{ google_search: {} }])
    expect(sent.systemInstruction.parts[0].text).toContain('robaqAI')
    expect(sent.systemInstruction.parts[0].text).toContain('KA')
    expect(JSON.stringify(result.body)).not.toContain('server-test-key')
  })

  it('rejects an overlong message before calling Gemini', async () => {
    process.env.GEMINI_API_KEY = 'server-test-key'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await call({ message: 'x'.repeat(4001) })
    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: 'too_long' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
