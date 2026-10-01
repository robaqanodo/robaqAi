import { createSHA256 } from 'hash-wasm'
export async function validateModel(blob: Blob, model: { size: number; sha256: string }, signal?: AbortSignal, progress?: (fraction: number) => void) {
  signal?.throwIfAborted()
  if (blob.size !== model.size) throw new Error('Incorrect model file size. Download the complete file.')
  const hash = await createSHA256()
  hash.init()
  for (let offset = 0; offset < blob.size; offset += 4 * 1024 * 1024) {
    signal?.throwIfAborted()
    hash.update(new Uint8Array(await blob.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer()))
    progress?.(Math.min(1, (offset + 4 * 1024 * 1024) / blob.size))
  }
  signal?.throwIfAborted()
  if (hash.digest('hex') !== model.sha256) throw new Error('Model verification failed. Please download the file again.')
}
export function boundedMessages(history: { role: 'user' | 'assistant'; text: string }[], text: string) {
  if (text.length > 1600) throw new Error('Please use up to 1,600 characters per offline message.')
  const result: {role: 'user' | 'assistant' | 'system'; content: string}[] = [{role: 'user', content: text}]
  let remaining = 1800 - text.length
  for (const item of [...history].reverse()) {
    if (item.text.length > remaining) break
    result.unshift({role: item.role, content: item.text}); remaining -= item.text.length
  }
  while (result[0].role === 'assistant') result.shift()
  result.unshift({role: 'system', content: 'You are robaqAI, a helpful offline assistant. Answer concisely in the user’s language.'})
  return result
}
