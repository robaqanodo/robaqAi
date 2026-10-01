import { persistentSkills } from '../skillSession'
import { downloadFile } from '../downloads/download'
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
  persistentSkills() && await navigator.storage?.persist?.().catch(() => false)
}
export async function downloadModel(model: LocalModel, signal: AbortSignal, progress: (value: number) => void): Promise<Blob> {
  const estimate = await navigator.storage?.estimate?.()
  if (estimate?.quota && model.size * 1.15 > estimate.quota - (estimate.usage ?? 0)) throw new Error('Not enough storage for this model. Free some space and try again.')
  return downloadFile(model.url, model.size, signal, progress)
}
