import { env, pipeline } from '@huggingface/transformers'
import { readFile } from './storage'

env.allowRemoteModels = false
// All model reads go through IndexedDB; no CDN, API, or inference server.
env.allowLocalModels = true
env.localModelPath = '/offline-models/'
env.useBrowserCache = false
env.useFSCache = false
env.useCustomCache = true
env.customCache = {
  match: async (request: string) => {
    const marker = '/rai-translator/'
    const name = request.includes(marker) ? request.split(marker)[1].replace(/^resolve\/main\//, '') : ''
    const data = name ? await readFile(name) : undefined
    return data ? new Response(data, { headers: { 'Content-Length': String(data.size) } }) : undefined
  },
  put: async () => {},
}
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = new URL('/translation-runtime/', self.location.href).href
  env.backends.onnx.wasm.numThreads = 1
  env.backends.onnx.wasm.proxy = false
}
type Translator = (text: string, options: { src_lang: string; tgt_lang: string; max_new_tokens: number }) => Promise<{ translation_text: string }[]>
const createTranslator = pipeline as unknown as (task: 'translation', model: string, options: object) => Promise<Translator>
let translator: Translator | null = null
self.onmessage = async ({ data }) => {
  const { id, text, source, target } = data
  try {
    if (!translator) {
      translator = await createTranslator('translation', 'rai-translator', { device: 'wasm', dtype: 'q8', local_files_only: true })
    }
    const result = await translator(text ?? 'Hello', { src_lang: source ?? 'en', tgt_lang: target ?? 'ru', max_new_tokens: 128 })
    const first = Array.isArray(result) ? result[0] : result
    if (!first || !('translation_text' in first)) throw new Error('The translation engine returned no text.')
    self.postMessage({ id, text: first.translation_text })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
