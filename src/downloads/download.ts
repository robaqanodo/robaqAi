import { partialChunk } from './checkpoints'
export class DownloadError extends Error {
  status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted()
  const abort = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  signal.addEventListener('abort', abort, {once:true})
})
function freshUrl(url: string, attempt: number) {
  if (!attempt) return url
  const fresh = new URL(url, typeof location === 'undefined' ? 'https://localhost' : location.href)
  // Refresh expired cached download redirects without changing the pinned model revision.
  fresh.searchParams.set('download_attempt', `${Date.now()}-${attempt}`)
  return fresh.href
}
async function request(url: string, signal: AbortSignal, range?: string) {
  let failure: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    signal.throwIfAborted()
    try {
      const response = await fetch(freshUrl(url, attempt), { headers: range ? {Range:range} : undefined, cache:'no-store', signal:AbortSignal.any([signal,AbortSignal.timeout(600000)]) })
      if (response.ok) return response
      const status = response.status
      await response.body?.cancel()
      failure = new DownloadError(`Download failed (HTTP ${status}). Please try again.`, status)
      if (![401,403,408,429,500,502,503,504].includes(status)) throw failure
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof DownloadError) throw error
      failure = error
    }
    if (attempt < 3) await sleep(Math.min(800 * 2 ** attempt, 6400), signal)
  }
  throw failure instanceof DownloadError ? failure : new DownloadError('Download interrupted. Please check your connection and try again.')
}
async function complete(response: Response, size: number, signal: AbortSignal, progress: (n:number)=>void) {
  const reader = response.body?.getReader()
  if (!reader) throw new DownloadError('Download stream unavailable.')
  const chunks: Blob[] = []; let received = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const {value, done} = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > size) throw new DownloadError('Incorrect download size. Please try again.')
      chunks.push(new Blob([new Uint8Array(value)])); progress(received / size)
    }
  } finally { await reader.cancel().catch(() => {}) }
  if (received !== size) throw new DownloadError('Incomplete download. Please try again.')
  return new Blob(chunks, {type:'application/octet-stream'})
}
/** Accept both HTTP range and full-file servers; callers verify the final SHA-256. */
export async function downloadFile(url: string, size: number, signal: AbortSignal, progress: (n:number)=>void, checkpoint?: string): Promise<Blob> {
  const chunks: Blob[] = [], chunkSize = 2 * 1024 * 1024
  for (let offset = 0; offset < size; offset += chunkSize) {
    const end = Math.min(size - 1, offset + chunkSize - 1)
    const saved=checkpoint?await partialChunk(checkpoint,offset):undefined
    if(saved?.size===end-offset+1){chunks.push(saved);progress((end+1)/size);continue}
    let failure: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted()
      try {
        const response = await request(freshUrl(url, attempt), signal, `bytes=${offset}-${end}`)
        if (response.headers.get('content-type')?.includes('text/html')) {
          await response.body?.cancel(); throw new DownloadError('The download link returned a webpage instead of a model.', 404)
        }
        // A server may ignore Range. Consume the whole response once, not once per chunk.
        if (response.status === 200) { return await complete(response, size, signal, progress) }
        const range = response.headers.get('content-range')
        if (response.status !== 206 || (range && range !== `bytes ${offset}-${end}/${size}`)) {
          await response.body?.cancel(); throw new DownloadError('Incorrect download range. Please try again.')
        }
        const chunk = await response.blob()
        signal.throwIfAborted()
        if (chunk.size !== end - offset + 1) throw new DownloadError('Incomplete download. Please try again.')
        if(checkpoint)await partialChunk(checkpoint,offset,chunk)
        chunks.push(chunk); progress((end + 1) / size); failure = undefined; break
      } catch (error) {
        signal.throwIfAborted(); failure = error
        if (error instanceof DownloadError && [400,401,403,404,410,429].includes(error.status)) throw error
        if (attempt < 2) await sleep(800 * (attempt + 1), signal)
      }
    }
    if (failure) throw failure
  }
  return new Blob(chunks, {type:'application/octet-stream'})
}
