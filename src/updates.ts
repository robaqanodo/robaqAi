import { version } from '../package.json'

export const currentVersion = version
export type UpdateResult = { status: 'current' | 'available'; version: string; downloadUrl?: string }

export async function checkForUpdate(): Promise<UpdateResult> {
  const endpoint = import.meta.env.VITE_UPDATE_MANIFEST_URL
  if (!endpoint) throw new Error('Update checking is not configured yet. Please try again once an update server is connected.')
  const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('Unable to check for updates. Please try again later.')
  const manifest = await response.json()
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('The update server returned invalid version information.')
  const remote = manifest.version.split('.').map(Number)
  const local = currentVersion.split('.').map(Number)
  const difference = remote.findIndex((part: number, index: number) => part !== local[index])
  if (difference < 0 || remote[difference] < local[difference]) return { status: 'current', version: currentVersion }
  const url = new URL(manifest.downloadUrl)
  if (url.protocol !== 'https:') throw new Error('The update download link is invalid.')
  return { status: 'available', version: manifest.version, downloadUrl: url.href }
}
