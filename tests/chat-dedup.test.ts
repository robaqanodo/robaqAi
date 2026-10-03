import { afterEach, expect, it, vi } from 'vitest'
const redis = vi.hoisted(() => vi.fn())
vi.mock('../server/redis.ts', () => ({ redis }))
import { claimChatRequest, finishChatRequest } from '../server/chat-dedup'
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })
it('claims once and blocks duplicate requests without storing the IP or text', async () => {
  vi.stubEnv('KV_REST_API_TOKEN', 'test-secret')
  redis.mockResolvedValueOnce('OK').mockResolvedValueOnce(null)
  const req = { headers: { 'x-forwarded-for': '192.0.2.20' } } as never
  const first = await claimChatRequest(req, 'private question', 'en')
  expect(first).toEqual({ key: expect.any(String), token: expect.any(String) })
  expect(await claimChatRequest(req, 'private question', 'en')).toBe('duplicate')
  expect(redis.mock.calls[0][1]).toBe(redis.mock.calls[1][1])
  expect(JSON.stringify(redis.mock.calls)).not.toMatch(/192\.0\.2|private question/)
})
it('different IP or question gets a distinct fingerprint', async () => {
  vi.stubEnv('KV_REST_API_TOKEN', 'test-secret'); redis.mockResolvedValue('OK')
  for (const [ip, text] of [['192.0.2.1','hello'],['192.0.2.2','hello'],['192.0.2.1','hi']]) await claimChatRequest({headers:{'x-forwarded-for':ip}} as never,text,'en')
  expect(new Set(redis.mock.calls.map(call=>call[1])).size).toBe(3)
})
it('releases failures but retains only a 24-hour marker for successful answers', async () => {
  const lease = { key:'key', token:'token' }
  await finishChatRequest(lease, false)
  await finishChatRequest(lease, true)
  expect(redis.mock.calls[0].at(-1)).toBe('0')
  expect(redis.mock.calls[1].at(-1)).toBe('1')
  expect(redis.mock.calls[0][1]).toContain('~=ARGV[1]')
  expect(redis.mock.calls[1][1]).toContain('86400')
})
