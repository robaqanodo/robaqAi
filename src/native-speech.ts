import type { SpeechRecognitionPlugin } from '@capgo/capacitor-speech-recognition'
import type { PluginListenerHandle } from '@capacitor/core'

export type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: {
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
  }) => void) | null
  onerror: ((ev?: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

/** Adapt iOS dictation to the same events used by the web chat. */
export function nativeRecognitionClass(plugin: SpeechRecognitionPlugin) {
  return class NativeRecognition implements SpeechRecognitionLike {
    lang = ''
    continuous = false
    interimResults = true
    onresult: SpeechRecognitionLike['onresult'] = null
    onerror: SpeechRecognitionLike['onerror'] = null
    onend: SpeechRecognitionLike['onend'] = null
    private listeners: PluginListenerHandle[] = []
    private ended = false
    private cancelled = false
    private stopping = false
    private started = false
    private transcript = ''

    start() { void this.begin() }

    private emit(final: boolean) {
      if (!this.transcript || this.cancelled) return
      this.onresult?.({ results: [Object.assign([{ transcript: this.transcript }], { isFinal: final })] })
    }

    private async listen(handle: Promise<PluginListenerHandle>) {
      const listener = await handle
      if (this.ended) await listener.remove()
      else this.listeners.push(listener)
    }

    private async begin() {
      try {
        const permission = await plugin.requestPermissions()
        if (this.stopping) return this.finish()
        if (permission.speechRecognition !== 'granted') throw new Error('Microphone or speech permission denied')
        const availability = await plugin.available()
        if (this.stopping) return this.finish()
        if (!availability.available) throw new Error('Speech recognition is unavailable')
        await this.listen(plugin.addListener('partialResults', (event) => {
          if (this.ended) return
          this.transcript = event.accumulatedText ?? event.matches?.[0] ?? ''
          this.emit(false)
        }))
        await this.listen(plugin.addListener('listeningState', (event) => {
          if (event.status === 'stopped') void this.finish()
        }))
        await this.listen(plugin.addListener('error', (event) => {
          if (!this.ended) this.onerror?.({ error: event.message })
          this.cancelled = true
          this.stop()
        }))
        if (this.stopping) return this.finish()
        this.started = true
        await plugin.start({ language: this.lang || undefined, partialResults: true, maxResults: 1 })
        if (this.stopping) await plugin.stop()
      } catch (error) {
        if (!this.cancelled && !this.ended) this.onerror?.({ error: String(error) })
        this.cancelled = true
        if (this.started) await plugin.stop().catch(() => {})
        await this.finish()
      }
    }

    stop() {
      this.stopping = true
      if (this.started && !this.ended) {
        void plugin.stop().catch(() => {}).finally(() => this.finish())
      }
    }

    abort() { this.cancelled = true; this.stop() }

    private async finish() {
      if (this.ended) return
      this.ended = true
      this.emit(true)
      await Promise.allSettled(this.listeners.map((listener) => listener.remove()))
      this.listeners = []
      this.onend?.()
    }
  }
}
