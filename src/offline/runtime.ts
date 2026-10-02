import { cancelDesktopReply } from './desktop'
import compatWorker from '@wllama/wllama-compat/wasm/wllama.js?raw'
import type { Wllama } from '@wllama/wllama/esm/index.js'
import { readFile } from './storage'
import { MODELS } from './models'
import { boundedMessages } from './validation'
import { stopTranslationWorker } from '../translation/client'
let engine: Wllama | undefined, loaded = ''
let controller: AbortController | undefined, running: Promise<string> | undefined
let queue: Promise<void> = Promise.resolve()
export function cancelOfflineReply() { controller?.abort(); cancelDesktopReply() }
async function clearEngine() { if(engine)await engine.exit().catch(()=>{});engine=undefined;loaded='' }
export function unloadOfflineModel() {
 cancelOfflineReply()
 const work=queue.catch(()=>{}).then(async()=>{cancelOfflineReply();await running?.catch(()=>{});await clearEngine()})
 queue=work;return work
}
export function prepareOfflineModel(id:string) {
 const work=queue.catch(()=>{}).then(async()=>{
  if(loaded===id&&engine)return
  cancelOfflineReply();await running?.catch(()=>{});stopTranslationWorker();await clearEngine()
  const model=MODELS.find(m=>m.id===id),blob=await readFile(id)
  if(!model||blob?.size!==model.size)throw Error('This model is not installed. Download it in AI Lab.')
  const {Wllama}=await import('@wllama/wllama/esm/index.js')
  engine=new Wllama({default:new URL('/offline-runtime/wllama.wasm',location.href).href})
  engine.setCompat({wasm:new URL('/offline-runtime/compat.wasm',location.href).href,worker:{code:compatWorker}})
  try{await engine.loadModel([blob],{n_ctx:2048,n_batch:128,n_ubatch:128,n_threads:1,n_gpu_layers:0,reasoning:false,default_template_kwargs:{enable_thinking:false}});loaded=id}
  catch{await clearEngine();throw Error('This device could not load the model. Close other apps to free memory and try again.')}
 });queue=work;return work
}
export async function offlineReply(id:string,history:{role:'user'|'assistant';text:string}[],text:string):Promise<string>{
 if(running)throw Error('The offline model is still finishing. Please try again shortly.')
 await prepareOfflineModel(id)
 if(running)throw Error('The offline model is still finishing. Please try again shortly.')
 const messages=boundedMessages(history,text);controller=new AbortController();const signal=controller.signal
 const timer=setTimeout(()=>controller?.abort(),600000)
 running=(async()=>{signal.throwIfAborted();const response=await engine!.createChatCompletion({messages,max_tokens:256,temperature:.7,chat_template_kwargs:{enable_thinking:false},abortSignal:signal});signal.throwIfAborted();const answer=response.choices[0]?.message.content?.trim();if(!answer)throw Error('The model returned no text. Please try a shorter message.');return answer})()
 try{return await running}finally{clearTimeout(timer);running=undefined;controller=undefined}
}
