import catalog from './desktop-catalog.json'
export const DESKTOP_MODELS = catalog
export type DesktopStatus = {available:boolean;memoryGB:number;installed:string[];error?:string}
let inference: AbortController | undefined
export function cancelDesktopReply() {inference?.abort()}
export async function desktopStatus():Promise<DesktopStatus> {
 try {
  const response=await fetch('/api/desktop-ai/status',{signal:AbortSignal.timeout(20000)})
  if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('Desktop models require robaq AI running locally on this computer.')
  const data=await response.json()
  if(!response.ok) throw new Error(data.error??'Local engine unavailable.')
  return data
 } catch(error) {return {available:false,memoryGB:0,installed:[],error:error instanceof Error?error.message:'Local engine unavailable.'}}
}
export async function desktopRequest(action:string, body:object, signal?:AbortSignal) {
 const response=await fetch(`/api/desktop-ai/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-Ostra-Local':'1'},body:JSON.stringify(body),signal})
 if(!response.ok) {const data=await response.json();throw new Error(data.error??'Local AI request failed.')}
 return response
}
export async function pullDesktopModel(model:string, signal:AbortSignal, progress:(text:string)=>void) {
 const response=await desktopRequest('pull',{model},signal)
 const reader=response.body?.getReader();if(!reader) throw new Error('Download stream unavailable.')
 const decoder=new TextDecoder();let buffer='',success=false
 const consume=(line:string)=>{if(!line.trim())return;const data=JSON.parse(line);if(data.error)throw new Error(data.error);if(data.status==='success')success=true;progress(data.total?`${data.status} · ${Math.round(100*(data.completed??0)/data.total)}%`:data.status??'Installing…')}
 try {while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1)}}buffer+=decoder.decode();consume(buffer)} finally {await reader.cancel().catch(()=>{})}
 if(!success)throw new Error('Download did not finish. Retry to resume.')
}
export async function desktopInference(action:'chat'|'translate', body:object):Promise<string> {
 if(inference)throw new Error('The local model is busy. Please wait or stop generation.')
 const controller=new AbortController();inference=controller
 try {const response=await desktopRequest(action,body,AbortSignal.any([controller.signal,AbortSignal.timeout(600000)]));return (await response.json()).text}
 finally {if(inference===controller)inference=undefined}
}
