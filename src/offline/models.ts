import catalog from './catalog.json'
import { readFile, writeFile, deleteFile } from './storage'
import { validateModel } from './validation'
export const MODELS = catalog
export type LocalModel = typeof catalog[number]
export async function installedModels(): Promise<string[]> {
  const installed: string[] = []
  for (const model of MODELS) {
    const file = await readFile(model.id)
    if (file?.size === model.size) installed.push(model.id)
  }
  return installed
}
export const removeModel = deleteFile
export async function installModel(model: LocalModel, file: Blob, signal: AbortSignal, progress: (value: number) => void) {
  await validateModel(file, model, signal, progress)
  signal.throwIfAborted()
  await writeFile(model.id, file)
  await navigator.storage?.persist?.().catch(() => false)
}
export async function downloadModel(model: LocalModel, signal: AbortSignal, progress: (value: number) => void): Promise<Blob> {
  const estimate = await navigator.storage?.estimate?.()
  if (estimate?.quota && model.size * 1.15 > estimate.quota - (estimate.usage ?? 0)) throw new Error('Not enough storage for this model. Free some space and try again.')
  const chunks: Blob[] = []
  const chunkSize = 2 * 1024 * 1024
  let next = 0
  let received = 0
  const batch = new AbortController()
  const combined = AbortSignal.any([signal, batch.signal])
  async function worker() {
    while (next < model.size) {
      combined.throwIfAborted()
      const offset = next; next += chunkSize
      const end = Math.min(model.size - 1, offset + chunkSize - 1)
      const response = await fetch(model.url, { headers: { Range: `bytes=${offset}-${end}` }, signal: AbortSignal.any([combined, AbortSignal.timeout(120000)]) })
      if (response.status !== 206) throw new Error('Download unavailable. Please check your connection and try again.')
      if (response.headers.get('Content-Range') !== `bytes ${offset}-${end}/${model.size}`) throw new Error('Incorrect download range. Please try again.')
      const chunk = await response.blob()
      if (chunk.size !== end - offset + 1) throw new Error('Incomplete download. Please try again.')
      chunks[offset / chunkSize] = chunk
      received += chunk.size; progress(received / model.size)
    }
  }
  try { await Promise.all(Array.from({length: 4}, worker)) }
  catch (error) { batch.abort(); throw error }
  return new Blob(chunks, {type: 'application/octet-stream'})
}
