import { expect, test, vi } from 'vitest'
import { automaticTranslation, splitTranslation } from '../src/translation/automatic'
const base = () => ({offline: vi.fn().mockResolvedValue('local'), connected: () => true, cancelled: () => false, status: vi.fn()})
test('splits long text without losing characters', () => {
 const text = 'Hello world. '.repeat(200).trim()
 const chunks = splitTranslation(text)
 expect(chunks.join('')).toBe(text)
 expect(chunks.every(c => c.length <= 400)).toBe(true)
})
test('uses online provider for both target languages', async () => {
 const o = {...base(), online:vi.fn().mockResolvedValue('translated')}
 const result = await automaticTranslation('გამარჯობა',o)
 expect(result).toContain('English:'); expect(result).toContain('Russian:')
 expect(o.online).toHaveBeenCalledTimes(2); expect(o.offline).not.toHaveBeenCalled()
})
test('falls back locally when provider fails', async () => {
 const o = {...base(), online:vi.fn().mockRejectedValue(new Error('503'))}
 await automaticTranslation('Hello',o)
 expect(o.online).toHaveBeenCalledTimes(1)
 expect(o.offline).toHaveBeenCalledWith('Hello','en','ka')
 expect(o.offline).toHaveBeenCalledWith('Hello','en','ru')
})
test('offline connection never contacts provider', async () => {
 const o = {...base(), connected:() => false, online:vi.fn()}
 await automaticTranslation('Привет',o)
 expect(o.online).not.toHaveBeenCalled(); expect(o.offline).toHaveBeenCalledTimes(2)
})
test('cancellation prevents requests', async () => {
 const o = {...base(), cancelled:() => true}
 await expect(automaticTranslation('Hello',o)).rejects.toThrow('stopped')
 expect(o.offline).not.toHaveBeenCalled()
})

test('recognizes Georgian uppercase with embedded Latin product names', async () => {
 const o = base()
 await automaticTranslation('გამარჯობა Smartass'.toUpperCase(), o)
 expect(o.offline).toHaveBeenCalledWith('გამარჯობა Smartass'.toUpperCase(), 'ka', 'en')
 expect(o.offline).toHaveBeenCalledWith('გამარჯობა Smartass'.toUpperCase(), 'ka', 'ru')
})
