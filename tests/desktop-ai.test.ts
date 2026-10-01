import { afterEach, expect, test, vi } from 'vitest'
import { allowedRequest, validateTranslation } from '../server/desktop-ai'
import { desktopStatus, pullDesktopModel, desktopInference, cancelDesktopReply } from '../src/offline/desktop'
afterEach(()=>vi.unstubAllGlobals())
test('local bridge rejects remote origins and DNS rebinding hosts',()=>{
 expect(allowedRequest({headers:{host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787'}})).toBe(true)
 expect(allowedRequest({headers:{host:'127.0.0.1:8787',origin:'https://evil.example'}})).toBe(false)
 expect(allowedRequest({headers:{host:'evil.example:8787'}})).toBe(false)
})
test('translation requests validate languages and empty input',()=>{
 expect(()=>validateTranslation({text:'dog',source:'en',target:'ka'})).not.toThrow()
 expect(()=>validateTranslation({text:'dog',source:'en',target:'xx'})).toThrow('Invalid')
 expect(()=>validateTranslation({text:'',source:'en',target:'ka'})).toThrow('Invalid')
})
test('a static site never reports a desktop model as installed',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<html>app</html>',{headers:{'Content-Type':'text/html'}})))
 expect(await desktopStatus()).toMatchObject({available:false,installed:[]})
})
test('download handles fragmented progress and only succeeds after success event',async()=>{
 const encoder=new TextEncoder()
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({start(c){for(const text of ['{"status":"pulling","total":100,"completed":','50}\n{"status":"success"}','\n'])c.enqueue(encoder.encode(text));c.close()}}))))
 const progress=vi.fn();await pullDesktopModel('nllb-200-3.3b',new AbortController().signal,progress)
 expect(progress).toHaveBeenCalledWith('pulling · 50%')
 expect(progress).toHaveBeenLastCalledWith('success')
})
test('a truncated download cannot activate a model',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"status":"pulling"}\n')))
 await expect(pullDesktopModel('nllb-200-3.3b',new AbortController().signal,vi.fn())).rejects.toThrow('did not finish')
})
test('download surfaces engine errors without activating',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"error":"disk full"}\n')))
 await expect(pullDesktopModel('nllb-200-3.3b',new AbortController().signal,vi.fn())).rejects.toThrow('disk full')
})
test('Stop aborts an in-flight local generation',async()=>{
 vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('stopped'))))))
 const request=desktopInference('translate',{model:'test'})
 cancelDesktopReply()
 await expect(request).rejects.toThrow('stopped')
})
