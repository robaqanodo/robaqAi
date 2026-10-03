import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { deriveSyncKey, openJson, sealJson } from '../src/accounts/keyCrypto'
import { pairUrl } from '../src/tesla/pairUrl'
import { keyHandoffHandler, memoryHandoffStore, type HandoffStore } from '../server/key-handoff'
import type { ApiRequest } from '../server/redis'

function fakeReq(payload: object) {
  const stream = Readable.from([JSON.stringify(payload)]) as ApiRequest
  stream.method = 'POST'
  stream.headers = { origin: 'http://127.0.0.1:8787', host: '127.0.0.1:8787' }
  stream.socket = { remoteAddress: '127.0.0.1' } as ApiRequest['socket']
  return stream
}
function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(code: number) { this.status = code },
    end(data?: string) { this.body = data ?? '' },
    setHeader() {},
  }
}
async function call(store: HandoffStore, payload: object) {
  const res = fakeRes()
  await keyHandoffHandler(store)(fakeReq(payload), res as never)
  return { status: res.status, body: res.body ? JSON.parse(res.body) as Record<string, unknown> : {} }
}

describe('API key handoff', () => {
  it('puts a one-time code in the URL and never the key or claim', () => {
    const url = pairUrl('abcdefghijklmnopqrstuv', 'http://127.0.0.1:8787')
    expect(url).toBe('http://127.0.0.1:8787/?pair=abcdefghijklmnopqrstuv')
    expect(url).not.toContain('sk-')
    expect(url).not.toContain('claim')
  })

  it('keeps the key out of the QR session until a claimed poll, then burns it', async () => {
    const store = memoryHandoffStore()
    const created = await call(store, { action: 'create' })
    expect(created.status).toBe(200)
    expect(created.body).not.toHaveProperty('apiKey')
    expect(String(created.body.code)).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const code = String(created.body.code)
    const claim = String(created.body.claim)
    const waiting = await call(store, { action: 'poll', code, claim })
    expect(waiting.body).toEqual({ status: 'waiting', expiresAt: created.body.expiresAt })
    expect(waiting.body).not.toHaveProperty('apiKey')
    const wrong = await call(store, { action: 'poll', code, claim: 'b'.repeat(64) })
    expect(wrong.status).toBe(410)
    expect(wrong.body).not.toHaveProperty('apiKey')
    const sent = await call(store, { action: 'submit', code, apiKey: 'sk-test-key-1234567890', provider: 'openai' })
    expect(sent.body).toEqual({ ok: true })
    expect(sent.body).not.toHaveProperty('apiKey')
    const again = await call(store, { action: 'submit', code, apiKey: 'sk-test-key-1234567890', provider: 'openai' })
    expect(again.status).toBe(409)
    const ready = await call(store, { action: 'poll', code, claim })
    expect(ready.body).toEqual({ status: 'ready', apiKey: 'sk-test-key-1234567890', provider: 'openai' })
    const burned = await call(store, { action: 'poll', code, claim })
    expect(burned.status).toBe(410)
    expect(burned.body.apiKey).toBeUndefined()
  })

  it('rejects an expired code before accepting a key', async () => {
    const store = memoryHandoffStore()
    const code = 'expiredcodeexpiredcode'
    await store.put(code, { claim: 'a'.repeat(64), expiresAt: Date.now() - 5 }, 1)
    const sent = await call(store, { action: 'submit', code, apiKey: 'AIzaSyTestKeyValue123456', provider: 'gemini' })
    expect(sent.status).toBe(410)
    expect(await store.take(code, 'a'.repeat(64))).toBeNull()
  })

  it('seals an account key so the ciphertext does not contain it', async () => {
    const email = 'driver@example.com'
    const first = await deriveSyncKey('correct horse battery', email)
    const second = await deriveSyncKey('correct horse battery', email)
    const sealed = await sealJson(first, { apiKey: 'sk-ant-secret-value-123456', provider: 'claude', updated: 9 })
    expect(JSON.stringify(sealed)).not.toContain('sk-ant-secret')
    expect(await openJson(second, sealed.iv, sealed.data)).toEqual({ apiKey: 'sk-ant-secret-value-123456', provider: 'claude', updated: 9 })
  })
})
