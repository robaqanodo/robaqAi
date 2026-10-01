import { test, expect, vi } from 'vitest'
import manifest from '../src/translation/manifest.json'
import { validatePack, downloadPack } from '../src/translation/package'

test('manual submit rejects foreign or truncated files before touching storage', async () => {
  await expect(validatePack(new Blob(['hi']), () => {})).rejects.toThrow('not an Smartass')
  const invalidLength = new Uint8Array([255, 255, 255, 255])
  await expect(validatePack(new Blob([invalidLength]), () => {})).rejects.toThrow('header')
  const header = new TextEncoder().encode(JSON.stringify({ format: 'unknown-pack' }))
  const size = new Uint8Array(4)
  new DataView(size.buffer).setUint32(0, header.byteLength, true)
  await expect(validatePack(new Blob([size, header]), () => {})).rejects.toThrow('not compatible')
})


test('a correct header without the model bytes is rejected as incomplete', async () => {
  const header = new TextEncoder().encode(JSON.stringify(manifest))
  const size = new Uint8Array(4)
  new DataView(size.buffer).setUint32(0, header.byteLength, true)
  await expect(validatePack(new Blob([size, header]), () => {})).rejects.toThrow('incomplete')
})

test('missing bundled pack falls back to the pinned model source instead of parsing HTML', async () => {
 const fetcher = vi.fn().mockResolvedValueOnce(new Response('<html>app</html>', {headers:{'content-type':'text/html'}})).mockResolvedValueOnce(new Response('unavailable', {status:503}))
 vi.stubGlobal('fetch', fetcher)
 try {
  await expect(downloadPack(() => {})).rejects.toThrow('could not be downloaded')
  expect(fetcher.mock.calls[1][0]).toBe('/translator/LICENSE')
 } finally { vi.unstubAllGlobals() }
})
