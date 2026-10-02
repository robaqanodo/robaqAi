import {beforeEach,it,expect,vi} from 'vitest'
const mock=vi.hoisted(()=>({events:[] as string[],models:new Map<string,{size:number}>(),live:0,max:0,network:vi.fn()}))
vi.mock('@wllama/wllama-compat/wasm/wllama.js?raw',()=>({default:''}))
vi.mock('../src/offline/storage',()=>({readFile:async(id:string)=>mock.models.get(id),deleteFile:vi.fn(),writeFile:vi.fn()}))
vi.mock('../src/offline/desktop',()=>({cancelDesktopReply:()=>{}}))
vi.mock('../src/translation/client',()=>({stopTranslationWorker:()=>{}}))
vi.mock('@wllama/wllama/esm/index.js',()=>({Wllama:class{constructor(){mock.live++;mock.max=Math.max(mock.max,mock.live)}setCompat(){}async loadModel(blobs:any[]){mock.events.push('load:'+blobs[0].size)}async exit(){mock.live--;mock.events.push('exit')}async createChatCompletion(){return {choices:[{message:{content:'Local answer'}}]}}}}))
import {prepareOfflineModel,unloadOfflineModel,offlineReply} from '../src/offline/runtime'
import catalog from '../src/offline/catalog.json'
beforeEach(async()=>{await unloadOfflineModel();mock.models=new Map(catalog.map(m=>[m.id,{size:m.size}]));mock.events=[];mock.max=0;vi.stubGlobal('location',{href:'https://robaq.app/'});vi.stubGlobal('fetch',mock.network.mockRejectedValue(new Error('network disabled')))})
it('unloads the old engine before loading the next, including concurrent switch requests',async()=>{await Promise.all([prepareOfflineModel('qwen35-2'),prepareOfflineModel('qwen35-4')]);expect(mock.max).toBe(1);expect(mock.events).toEqual(['load:1280835840','exit','load:2740937888']);await unloadOfflineModel();expect(mock.live).toBe(0)})
it('reuses the active engine and reads only local storage with network disabled',async()=>{await prepareOfflineModel('qwen35-2');expect(await offlineReply('qwen35-2',[],'hello')).toBe('Local answer');expect(mock.events).toEqual(['load:1280835840']);expect(mock.network).not.toHaveBeenCalled();await unloadOfflineModel()})
it('rejects missing files rather than fetching or loading another model',async()=>{mock.models.delete('qwen35-4');await expect(prepareOfflineModel('qwen35-4')).rejects.toThrow('not installed');expect(mock.network).not.toHaveBeenCalled();expect(mock.live).toBe(0)})
