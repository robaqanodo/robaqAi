import { test, expect, vi, afterEach } from 'vitest'
const mocked = vi.hoisted(() => ({read:vi.fn(), load:vi.fn().mockResolvedValue(undefined), completion:vi.fn().mockResolvedValue({choices:[{message:{content:'Hello'}}]}), exit:vi.fn().mockResolvedValue(undefined),compat:vi.fn(),stopTranslation:vi.fn()}))
vi.mock('../src/offline/storage', () => ({readFile:mocked.read,writeFile:vi.fn(),deleteFile:vi.fn()}))
vi.mock('../src/translation/client', () => ({stopTranslationWorker:mocked.stopTranslation}))
vi.mock('@wllama/wllama/esm/index.js', () => ({Wllama:class {loadModel=mocked.load;createChatCompletion=mocked.completion;exit=mocked.exit;setCompat=mocked.compat}}))
import { offlineReply, unloadOfflineModel, cancelOfflineReply } from '../src/offline/runtime'
import { MODELS } from '../src/offline/models'
afterEach(async () => {await unloadOfflineModel(); vi.clearAllMocks(); vi.unstubAllGlobals()})
test('loads only installed weights and local Safari runtime, then returns generated text',async () => {
 vi.stubGlobal('location',{href:'http://localhost/'})
 mocked.read.mockResolvedValue({size:MODELS[0].size})
 expect(await offlineReply(MODELS[0].id,[],'Hello')).toBe('Hello')
 expect(mocked.compat).toHaveBeenCalledWith(expect.objectContaining({wasm:'http://localhost/offline-runtime/compat.wasm'}))
 expect(mocked.stopTranslation).toHaveBeenCalled()
 expect(mocked.completion).toHaveBeenCalledWith(expect.objectContaining({max_tokens:256,chat_template_kwargs:{enable_thinking:false}}))
})
test('missing weights never reach inference',async () => {
 mocked.read.mockResolvedValue(undefined)
 await expect(offlineReply(MODELS[0].id,[],'Hello')).rejects.toThrow('not installed')
 expect(mocked.completion).not.toHaveBeenCalled()
})
test('cancelled loading never starts generation',async () => {
 vi.stubGlobal('location',{href:'http://localhost/'})
 mocked.read.mockResolvedValue({size:MODELS[0].size})
 let release!:()=>void
 mocked.load.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}))
 const reply=offlineReply(MODELS[0].id,[],'Hello')
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 cancelOfflineReply();release()
 await expect(reply).rejects.toThrow()
 expect(mocked.completion).not.toHaveBeenCalled()
})
