import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
const chunks=vi.hoisted(()=>new Map<string,Blob>())
vi.mock('../src/downloads/checkpoints',()=>({partialChunk:vi.fn(async(k:string,n:number,v?:Blob)=>{const key=k+':'+n;if(v)chunks.set(key,v);return chunks.get(key)}),clearPartial:vi.fn(async(k:string)=>{for(const key of chunks.keys())if(key.startsWith(k+':'))chunks.delete(key)})}))
vi.mock('../src/offline/storage',()=>({readFile:vi.fn(),writeFile:vi.fn(),deleteFile:vi.fn()}))
import {downloadFile} from '../src/downloads/download'
import {installModel,MODELS} from '../src/offline/models'
import {writeFile} from '../src/offline/storage'
const bytes=new Uint8Array(2*1024*1024+16);bytes.set([71,71,85,70])
beforeEach(()=>{chunks.clear();vi.clearAllMocks();vi.stubGlobal('navigator',{})})
afterEach(()=>vi.unstubAllGlobals())
describe('verified resumable model download',()=>{
 it('resumes verified-size stored ranges without fetching them again',async()=>{const c=new AbortController();let calls=0;vi.stubGlobal('fetch',vi.fn(async(_url,opts)=>{calls++;const [a,b]=opts.headers.Range.slice(6).split('-').map(Number);return new Response(bytes.slice(a,b+1),{status:206,headers:{'content-range':`bytes ${a}-${b}/${bytes.length}`}})}));await expect(downloadFile('https://model.test/file',bytes.length,c.signal,n=>{if(n<1)c.abort()},'sha')).rejects.toThrow();expect(calls).toBe(1);const file=await downloadFile('https://model.test/file',bytes.length,new AbortController().signal,()=>{},'sha');expect(calls).toBe(2);expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)})
 it('deletes corrupt checkpoints and never installs a checksum failure',async()=>{chunks.set('bad:0',new Blob([bytes]));await expect(installModel({...MODELS[0],size:bytes.length,sha256:'bad'},new Blob([bytes]),new AbortController().signal,()=>{})).rejects.toThrow('verification');expect(chunks.size).toBe(0);expect(writeFile).not.toHaveBeenCalled()})
 it('stores only hash-verified files and clears their checkpoints',async()=>{const sha=createHash('sha256').update(bytes).digest('hex');chunks.set(sha+':0',new Blob([bytes]));await installModel({...MODELS[0],size:bytes.length,sha256:sha},new Blob([bytes]),new AbortController().signal,()=>{});expect(writeFile).toHaveBeenCalledOnce();expect(chunks.size).toBe(0)})
 it('rejects HTML instead of silently installing a webpage',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>denied</html>',{headers:{'content-type':'text/html'}})));await expect(downloadFile('https://model.test/file',10,new AbortController().signal,()=>{})).rejects.toThrow('webpage')})
})
