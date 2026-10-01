import { persistentSkills, guestFiles } from '../skillSession'
let worker: Worker | undefined
let serial = 0
const pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
export function stopTranslationWorker() {
  worker?.terminate()
  worker = undefined
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Translation stopped.')) }
  pending.clear()
}
export function translateOffline(text: string, source: string, target: string): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const item = pending.get(data.id)
      if (!item) return
      clearTimeout(item.timer)
      pending.delete(data.id)
      if (data.error) item.reject(new Error(data.error))
      else item.resolve(data.text)
    }
    worker.onerror = () => stopTranslationWorker()
    worker.postMessage({ configure: true, persistent: persistentSkills(), files: [...guestFiles('translation')] })
  }
  const id = ++serial
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stopTranslationWorker(), 180000)
    pending.set(id, { resolve, reject, timer })
    worker!.postMessage({ id, text, source, target })
  })
}
