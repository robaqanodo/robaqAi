import { describe, it, expect } from 'vitest'
import { validateModel, boundedMessages } from '../src/offline/validation'
import { createHash } from 'node:crypto'

describe('offline model integrity', () => {
  const blob = new Blob(['GGUFtest model'])
  const model = { size: blob.size, sha256: createHash('sha256').update('GGUFtest model').digest('hex') }
  it('accepts only the expected complete file', async () => {
    await expect(validateModel(blob, model)).resolves.toBeUndefined()
    await expect(validateModel(new Blob(['GGUF']), model)).rejects.toThrow('size')
    await expect(validateModel(new Blob(['GGUFwrong data']), model)).rejects.toThrow()
  })
  it('rejects cancellation before verification', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(validateModel(blob, model, controller.signal)).rejects.toThrow()
  })
  it('keeps current input and bounds older context', () => {
    const result = boundedMessages(Array.from({length: 20}, () => ({role: 'user' as const, text: 'old'.repeat(500)})), 'current')
    expect(result.at(-1)?.content).toBe('current')
    expect(result.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(2000)
    expect(() => boundedMessages([], 'a'.repeat(1601))).toThrow()
  })
})

import { vi, afterEach } from 'vitest'
import { downloadModel, installModel, MODELS } from '../src/offline/models'
import { writeFile } from '../src/offline/storage'
vi.mock('../src/offline/storage', () => ({readFile: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn()}))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('never marks a corrupt model installed', async () => {
  vi.stubGlobal('navigator', {storage: {persist: vi.fn()}})
  await expect(installModel(MODELS[0], new Blob(['broken']), new AbortController().signal, () => {})).rejects.toThrow()
  expect(writeFile).not.toHaveBeenCalled()
})
it('rejects a mismatched range instead of silently duplicating chunks', async () => {
  vi.stubGlobal('navigator', {storage: {estimate: async () => ({})}})
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abcd', {status:206, headers:{'Content-Range':'bytes 4-7/8'}})))
  await expect(downloadModel({...MODELS[0],size:4}, new AbortController().signal, () => {})).rejects.toThrow('range')
})
it('refuses downloads when storage quota is insufficient', async () => {
  vi.stubGlobal('navigator', {storage:{estimate:async () => ({quota:100,usage:90})}})
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(downloadModel(MODELS[0], new AbortController().signal, () => {})).rejects.toThrow('storage')
  expect(fetcher).not.toHaveBeenCalled()
})
