import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeRecognitionClass } from '../src/native-speech.ts'

const settle = () => new Promise((resolve) => setImmediate(resolve))
function mockPlugin() {
  const listeners = new Map()
  const plugin = {
    starts: 0, stops: 0,
    requestPermissions: async () => ({ speechRecognition: 'granted' }),
    available: async () => ({ available: true }),
    addListener: async (name, callback) => {
      listeners.set(name, callback)
      return { remove: async () => { listeners.delete(name) } }
    },
    start: async () => { plugin.starts++; return {} },
    stop: async () => { plugin.stops++ },
    emit: (name, event) => listeners.get(name)?.(event),
    listeners,
  }
  return plugin
}

test('native transcript becomes a final chat result exactly once and listeners are removed', async () => {
  const plugin = mockPlugin()
  const Recognition = nativeRecognitionClass(plugin)
  const recognition = new Recognition()
  const results = []; let ends = 0
  recognition.onresult = (event) => results.push(event.results[0])
  recognition.onend = () => ends++
  recognition.start(); await settle()
  plugin.emit('partialResults', { matches: ['გამარჯობა'] })
  plugin.emit('listeningState', { status: 'stopped' })
  recognition.stop(); await settle()
  assert.equal(results[0][0].transcript, 'გამარჯობა')
  assert.equal(results[0].isFinal, false)
  assert.equal(results[1].isFinal, true)
  assert.equal(ends, 1)
  assert.equal(plugin.listeners.size, 0)
})

test('denied permissions never start the microphone', async () => {
  const plugin = mockPlugin()
  plugin.requestPermissions = async () => ({ speechRecognition: 'denied' })
  const Recognition = nativeRecognitionClass(plugin)
  const recognition = new Recognition()
  let errors = 0; let ends = 0
  recognition.onerror = () => errors++
  recognition.onend = () => ends++
  recognition.start(); await settle()
  assert.equal(plugin.starts, 0)
  assert.equal(errors, 1)
  assert.equal(ends, 1)
})

test('closing while permission is pending prevents a late microphone start', async () => {
  const plugin = mockPlugin()
  let grant
  plugin.requestPermissions = () => new Promise((resolve) => { grant = resolve })
  const Recognition = nativeRecognitionClass(plugin)
  const recognition = new Recognition()
  recognition.start(); recognition.abort()
  grant({ speechRecognition: 'granted' }); await settle()
  assert.equal(plugin.starts, 0)
  assert.equal(plugin.listeners.size, 0)
})

test('abort does not submit the partial transcript', async () => {
  const plugin = mockPlugin()
  const Recognition = nativeRecognitionClass(plugin)
  const recognition = new Recognition()
  let finals = 0
  recognition.onresult = (event) => { if (event.results[0].isFinal) finals++ }
  recognition.start(); await settle()
  plugin.emit('partialResults', { matches: ['cancel this'] })
  recognition.abort(); await settle()
  assert.equal(finals, 0)
  assert.equal(plugin.stops, 1)
  assert.equal(plugin.listeners.size, 0)
})
