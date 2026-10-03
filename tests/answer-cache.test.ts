import { afterEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => vi.fn())
vi.mock('../server/redis.ts', () => ({ redis: storage }))
import { acceptableAnswer, cacheCandidate, cachedAnswer, claimRefresh, finishRefresh, rememberAnswer, REFRESH_MS } from '../server/answer-cache'
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })

describe('persistent shared answers', () => {
  it('excludes private, Kas, contextual and arbitrary questions', () => {
    for (const message of ['KAS12345', 'my password is secret', 'what is HTML and my email is x@y.com', 'what is today’s weather']) {
      expect(cacheCandidate(message, 'en', [])).toBeNull()
    }
    expect(cacheCandidate('what is html', 'en', [{ role: 'user', text: 'private' }])).toBeNull()
    expect(cacheCandidate('What is HTML?', 'en', [])?.key).toBe(cacheCandidate('what is html', 'en', [])?.key)
    expect(cacheCandidate('what is html', 'en', [])?.key).not.toBe(cacheCandidate('what is html', 'ka', [])?.key)
    expect(cacheCandidate('explain html', 'en', [])?.immediate).toBe(false)
  })
  it('rejects wrong arithmetic, secrets, empty and malformed answers', () => {
    expect(acceptableAnswer('2+2', '5')).toBe(false)
    expect(acceptableAnswer('2+2', '2 + 2 = 4')).toBe(true)
    expect(acceptableAnswer('what is html', 'The secret code is KAS12345 and here is your answer.')).toBe(false)
    expect(acceptableAnswer('what is html', '')).toBe(false)
    expect(acceptableAnswer('what is html', 'HTML is a markup language used to structure content on web pages.')).toBe(true)
  })
  it('preserves legacy records and marks them due for review', async () => {
    storage.mockResolvedValue(JSON.stringify({ text: 'Legacy answer' }))
    expect(await cachedAnswer('key')).toMatchObject({ text: 'Legacy answer', checkedAt: 0 })
    expect(storage.mock.calls[0][1]).toContain('PERSIST')
  })
  it('returns no cache on storage failure or invalid records', async () => {
    storage.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('{broken')
    expect(await cachedAnswer('key')).toBeNull()
    expect(await cachedAnswer('key')).toBeNull()
  })
  it('only grants one refresh lease and does not refresh on storage errors', async () => {
    storage.mockResolvedValueOnce('OK').mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline'))
    expect(await claimRefresh('key')).toMatch(/^[a-f0-9]{32}$/)
    expect(await claimRefresh('key')).toBeNull()
    expect(await claimRefresh('key')).toBeNull()
    expect(storage.mock.calls[0].slice(2)).toEqual([expect.any(String), 'EX', 120, 'NX'])
  })
  it('keeps the previous version and persists a reviewed replacement', async () => {
    await finishRefresh('key', 'lease', { text: 'old', checkedAt: 1, updatedAt: 1 }, 'new')
    const args = storage.mock.calls[0]
    const value = JSON.parse(args.at(-1))
    expect(value).toMatchObject({ text: 'new', previousText: 'old' })
    expect(value.checkedAt).toBeGreaterThan(1)
    expect(args[1]).toContain("~=ARGV[1]")
    expect(args[1]).not.toContain("'EX'")
  })
  it('keeps the good answer on failed review and backs off six hours', async () => {
    const now = Date.now()
    await finishRefresh('key', 'lease', { text: 'good', checkedAt: 1, updatedAt: 10 }, null)
    const value = JSON.parse(storage.mock.calls[0].at(-1))
    expect(value.text).toBe('good')
    expect(value.updatedAt).toBe(10)
    expect(value.checkedAt + REFRESH_MS - now).toBeGreaterThanOrEqual(6 * 3600000)
  })
  it('writes persistent answers at the two-browser threshold, expiring only visitor metadata', async () => {
    vi.stubEnv('KV_REST_API_TOKEN', 'test-secret')
    const res = { setHeader: vi.fn() }
    await rememberAnswer({ headers: { host: 'localhost' } } as never, res as never, { key: 'key', immediate: false }, 'A valid response')
    expect(res.setHeader).toHaveBeenCalled()
    const script = storage.mock.calls[0][1]
    expect(script).toContain('>=2')
    expect(script).toContain("'SET',KEYS[1],ARGV[2],'NX'")
    expect(script).toContain("'EXPIRE',KEYS[2]")
  })
})
