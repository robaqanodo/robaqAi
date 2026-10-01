import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rm, stat, statfs } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import catalog from '../src/offline/desktop-catalog.json' with { type: 'json' }
import manifest from '../src/offline/nllb-manifest.json' with { type: 'json' }
const memoryGB = Math.round(totalmem() / 2 ** 30)
let busy = false
const modelId = 'nllb-200-3.3b'
const pythonPath=(root:string)=>resolve(root,'offline-assets/translation-env',process.platform==='win32'?'Scripts/python.exe':'bin/python')
export function allowedRequest(req: Pick<IncomingMessage, 'headers'>) {
 const host=req.headers.host??''
 return /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) && (!req.headers.origin || req.headers.origin===`http://${host}`)
}
export function validateTranslation(body:{text?:string;source?:string;target?:string}) {
 if(!body.text?.trim() || body.text.length>8000 || !['en','ka','ru'].includes(body.source??'') || !['en','ka','ru'].includes(body.target??''))throw new Error('Invalid translation request.')
}
async function installed(root:string) {
 try {
  const dir=resolve(root,'offline-assets/nllb-200-3.3b')
  const marker=JSON.parse(await readFile(resolve(dir,'installed.json'),'utf8'))
  if(marker.revision!==manifest.revision)return false
  for(const file of manifest.files)if((await stat(resolve(dir,file.name))).size!==file.size)return false
  await access(pythonPath(root));return true
 }catch{return false}
}
function run(root:string, command:string, args:string[], signal:AbortSignal, onOutput?:(chunk:string)=>void, input?:object):Promise<string> {
 return new Promise((resolveResult,reject)=>{
  const child=spawn(command,args,{cwd:root,signal,env:{...process.env,HF_HOME:resolve(root,'offline-assets/hf-cache'),HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',HF_HUB_DISABLE_TELEMETRY:'1'},stdio:['pipe','pipe','pipe']})
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
  let output='',error='';child.stdout.on('data',chunk=>{if(onOutput)onOutput(String(chunk));else output+=String(chunk)})
  child.stderr.on('data',chunk=>{error=(error+String(chunk)).slice(-2000)})
  child.on('error',reject);child.on('close',code=>{if(code===0)resolveResult(output);else reject(new Error(output.trim()||error.trim()||'The local translation engine stopped.'))})
  child.stdin.on('error',()=>{});child.stdin.end(input?JSON.stringify(input):undefined)
 })
}
async function setup(root:string,signal:AbortSignal,progress:(chunk:string)=>void){
 try{await run(root,pythonPath(root),['-c','import ctranslate2, tokenizers, huggingface_hub'],signal);return}catch{signal.throwIfAborted()}
 progress(JSON.stringify({status:'Preparing the local translation engine…'})+'\n')
 await mkdir(resolve(root,'offline-assets'),{recursive:true})
 await run(root,'python3',['-m','venv',resolve(root,'offline-assets/translation-env')],signal)
 await run(root,pythonPath(root),['-m','pip','install','--no-cache-dir','ctranslate2==4.8.2','tokenizers==0.23.2','huggingface_hub==1.33.0'],signal)
}
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
export function desktopAI():Plugin {
 let root=''
 const middleware=async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
  if(!req.url?.startsWith('/api/desktop-ai/')){next();return}
  if(!allowedRequest(req)){json(res,403,{error:'Local, same-origin access only.'});return}
  const action=req.url.slice('/api/desktop-ai/'.length)
  const controller=new AbortController();const signal=controller.signal
  res.on('close',()=>{if(!res.writableEnded)controller.abort()})
  let ownsLock=false
  try {
   if(action==='status'&&req.method==='GET'){json(res,200,{available:true,memoryGB,installed:await installed(root)?[modelId]:[]});return}
   if(req.method!=='POST'||req.headers['x-ostra-local']!=='1'||!['pull','delete','translate'].includes(action)){json(res,400,{error:'Invalid local request.'});return}
   req.setEncoding('utf8')
   let raw='';for await(const chunk of req){raw+=String(chunk);if(raw.length>64000)throw new Error('Request is too large.')}
   const body=JSON.parse(raw) as {model:string;text?:string;source?:string;target?:string}
   if(body.model!==modelId)throw new Error('Unknown local model.')
   if(action!=='delete'&&memoryGB<catalog[0].minMemoryGB)throw new Error(`This model requires ${catalog[0].minMemoryGB} GB RAM.`)
   if(busy)throw new Error('The local model is busy. Wait or stop the current operation.')
   busy=true;ownsLock=true
   if(action==='pull'){
    const space=await statfs(root)
    if(!await installed(root)&&space.bavail*space.bsize<4e9)throw new Error('At least 4 GB of free disk space is needed.')
    res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'})
    const progress=(chunk:string)=>res.write(chunk)
    await setup(root,signal,progress)
    await run(root,pythonPath(root),['scripts/nllb-runtime.py','install'],signal,progress)
    res.end();return
   }
   if(action==='delete'){
    await rm(resolve(root,'offline-assets/nllb-200-3.3b'),{recursive:true,force:true})
    json(res,200,{deleted:true});return
   }
   validateTranslation(body)
   if(!await installed(root))throw new Error('Install NLLB-200 in AI Lab first.')
   const output=await run(root,pythonPath(root),['scripts/nllb-runtime.py','translate'],signal,undefined,body)
   const result=JSON.parse(output)
   if(result.error)throw new Error(result.error)
   json(res,200,result)
  }catch(error){const message=error instanceof Error?error.message:'Local translation failed.';if(!res.headersSent)json(res,503,{error:message});else res.end(JSON.stringify({error:message})+'\n')}
  finally{if(ownsLock)busy=false}
 }
 return {name:'ostra-desktop-ai',configResolved(config){root=config.root},configureServer(server){server.middlewares.use((req,res,next)=>{void middleware(req,res,next)})},configurePreviewServer(server){server.middlewares.use((req,res,next)=>{void middleware(req,res,next)})}}
}
