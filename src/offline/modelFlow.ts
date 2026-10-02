import {useSyncExternalStore} from 'react'
import {MODELS,downloadModel,installModel,installedModels,removeModel} from './models'
import {skillPreferences} from '../skillSession'
import {prepareOfflineModel,unloadOfflineModel} from './runtime'
import {clearPartial} from '../downloads/checkpoints'
import {finishInstallation} from '../components/InstallProgress'
type Flow={active:string;installed:string[];busy:string;phase:string;progress:number;error:string;paused:string}
let state:Flow={active:'qwen35-2',installed:[],busy:'',phase:'',progress:0,error:'',paused:''}
const listeners=new Set<()=>void>();let abort:AbortController|undefined;let cancelMode='pause';let revision=0
function update(p:Partial<Flow>){state={...state,...p};listeners.forEach(f=>f())}
export function useModelFlow(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb)}},()=>state)}
export async function refreshModelFlow(){const current=revision;const installed=await installedModels();if(current!==revision)return;const saved=skillPreferences.getItem('rai-local-model');const pending=skillPreferences.getItem('robaq-model-download');update({installed,active:MODELS.some(m=>m.id===saved)?saved!:'qwen35-2',paused:!state.busy&&MODELS.some(m=>m.id===pending)&&!installed.includes(pending!)?pending!:state.paused})}
export async function resetModelFlow(){revision++;abort?.abort();update({active:'qwen35-2',installed:[],busy:'',paused:'',error:''});await unloadOfflineModel();await refreshModelFlow()}
export async function chooseModel(id:string){
 if(state.busy)return;const model=MODELS.find(m=>m.id===id);if(!model)return
 const generation=revision;abort=new AbortController();const signal=abort.signal;cancelMode='pause';const already=state.installed.includes(id)
 update({busy:id,phase:already?'Loading model…':'Downloading',progress:0,error:'',paused:''})
 try{
  if(!already){skillPreferences.setItem('robaq-model-download',id);const blob=await downloadModel(model,signal,n=>update({progress:n}));update({phase:'Verifying',progress:0});await installModel(model,blob,signal,n=>update({progress:n}));update({phase:'Installing…'});await finishInstallation(signal)}
  signal.throwIfAborted();update({phase:'Loading model…'});await prepareOfflineModel(id);signal.throwIfAborted()
  if(generation!==revision)return
  skillPreferences.removeItem('robaq-model-download');skillPreferences.setItem('rai-local-model',id);update({active:id,installed:await installedModels()})
 }catch(error){
  if(generation!==revision)return
  if(signal.aborted){if(cancelMode==='cancel'){skillPreferences.removeItem('robaq-model-download');await clearPartial(model.sha256);if(!already)await removeModel(id)}update({paused:cancelMode==='pause'?id:''});await unloadOfflineModel()}
  else update({error:error instanceof Error?error.message:'Model installation failed. Please try again.'})
 }finally{if(generation===revision){abort=undefined;update({busy:'',installed:await installedModels()})}}
}
export function pauseModel(){cancelMode='pause';abort?.abort()}
export function cancelModel(){cancelMode='cancel';abort?.abort()}
