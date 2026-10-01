import { persistentSkills } from '../skillSession'
import { skillPreferences } from '../skillSession'
import { downloadFile, DownloadError } from '../downloads/download'
import manifest from './manifest.json'
import { clearPack, readFile, writeFile } from './storage'
import { stopTranslationWorker, translateOffline } from './client'

export const PACK_URL = '/translator/rai-translator-en-ka-ru.raipack'
export const PACK_MIB = Math.ceil(manifest.files.reduce((size, file) => size + file.size, 0) / 1048576)
const ACTIVE_KEY = 'ostra-translator-active'
export function translationPackActive() { try { return skillPreferences.getItem(ACTIVE_KEY) === manifest.revision } catch { return false } }
export function setTranslationPackActive(active: boolean) { try { skillPreferences.setItem(ACTIVE_KEY, active ? manifest.revision : 'false') } catch { /* Session still works. */ } }
export async function packInstalled() {
  try {
    const marker = await readFile('installed')
    if (!marker || await marker.text() !== manifest.revision) return false
    for (const file of manifest.files) {
      if ((await readFile(file.name))?.size !== file.size) return false
    }
    return true
  } catch { return false }
}
export async function validatePack(file: Blob, progress: (status: string) => void) {
  if (file.size < 4) throw new Error('This is not an robaqAI translation pack.')
  const headerLength = new DataView(await file.slice(0, 4).arrayBuffer()).getUint32(0, true)
  if (headerLength > 65536 || headerLength < 2) throw new Error('Invalid translation pack header.')
  const header = JSON.parse(await file.slice(4, 4 + headerLength).text())
  if (JSON.stringify(header) !== JSON.stringify(manifest)) throw new Error('This pack is not compatible. Download the EN / KA / RU pack from this AI Lab.')
  let offset = 4 + headerLength
  if (file.size !== offset + manifest.files.reduce((sum, item) => sum + item.size, 0)) throw new Error('The download is incomplete. Please download the pack again.')
  const parts: { name: string; data: Blob }[] = []
  for (const entry of manifest.files) {
    progress(`Verifying ${parts.length + 1} / ${manifest.files.length}…`)
    const data = file.slice(offset, offset + entry.size)
    const hash = await crypto.subtle.digest('SHA-256', await data.arrayBuffer())
    const digest = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
    if (digest !== entry.sha256) throw new Error('The pack is damaged. Please download it again.')
    parts.push({ name: entry.name, data })
    offset += entry.size
  }
  return parts
}
export async function installPack(file: Blob, progress: (status: string) => void) {
  const parts = await validatePack(file, progress)
  const estimate = await navigator.storage?.estimate?.()
  if (estimate?.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < file.size) {
    throw new Error(`Not enough device storage. Free at least ${PACK_MIB} MB and try again.`)
  }
  stopTranslationWorker()
  await clearPack()
  try {
    for (let index = 0; index < parts.length; index++) {
      progress(`Installing ${index + 1} / ${parts.length}…`)
      await writeFile(parts[index].name, parts[index].data)
    }
    progress('Testing the offline translation engine…')
    const result = await translateOffline('Hello', 'en', 'ru')
    if (!result.trim()) throw new Error('The translation engine could not start on this device.')
    await writeFile('installed', new Blob([manifest.revision]))
    persistentSkills() && await navigator.storage?.persist?.().catch(() => false)
  } catch (error) {
    stopTranslationWorker()
    await clearPack()
    throw error
  }
}

/** Receive large packs in bounded chunks so mobile webviews do not buffer 611 MB at once. */
export async function downloadPack(progress: (status: string) => void): Promise<Blob> {
  const total = 4 + new TextEncoder().encode(JSON.stringify(manifest)).length + manifest.files.reduce((sum, file) => sum + file.size, 0)
  try {
    return await downloadFile(PACK_URL, total, new AbortController().signal, fraction => progress(`Downloading language pack… ${Math.floor(fraction * 100)}%`))
  } catch (error) {
    if (error instanceof DownloadError && [404,410].includes(error.status)) return downloadSourcePack(progress)
    throw error
  }
}

export async function removePack() {
  stopTranslationWorker()
  await clearPack()
  setTranslationPackActive(false)
}

/** Recover missing bundled packs from the exact, checksum-verified model revision. */
async function downloadSourcePack(progress: (status: string) => void): Promise<Blob> {
  const header = new TextEncoder().encode(JSON.stringify(manifest))
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, header.length, true)
  const parts: BlobPart[] = [length, header]
  for (const [index, entry] of manifest.files.entries()) {
    progress(`Downloading translation file ${index + 1} / ${manifest.files.length}…`)
    const url = entry.name === 'LICENSE' ? '/translator/LICENSE' : `https://huggingface.co/${manifest.model}/resolve/${manifest.revision}/${entry.name}`
    const blob = await downloadFile(url, entry.size, new AbortController().signal, fraction => progress(`Downloading translation file ${index + 1} / ${manifest.files.length}… ${Math.floor(fraction * 100)}%`))
    parts.push(blob)
  }
  return new Blob(parts, { type: 'application/octet-stream' })
}
