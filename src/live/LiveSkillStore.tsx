import {useEffect,useRef,useState} from 'react'
import {useLocale} from '../i18n/Locale'
import {finishInstallation,InstallProgress} from '../components/InstallProgress'
import type {LiveKind} from './client'
export function LiveSkillStore({kind,active,onChange}:{kind:LiveKind;active:boolean;onChange:(value:boolean)=>void}){
 const {t}=useLocale(),[busy,setBusy]=useState(false),controller=useRef<AbortController|null>(null)
 useEffect(()=>()=>controller.current?.abort(),[])
 async function install(){if(controller.current)return;const c=new AbortController();controller.current=c;setBusy(true);try{await finishInstallation(c.signal);if(!c.signal.aborted)onChange(true)}catch{/* Cancellation keeps the skill inactive. */}finally{controller.current=null;setBusy(false)}}
 return <div className="side-panel-item"><div className="side-panel-item-body"><span className="side-panel-item-name">{kind==='syberlive'?'SyberLive 1.0':'Crossfire 1.0'}</span><span className="side-panel-item-meta">{t(kind==='syberlive'?'Private room. Gone when it ends.':'One minute each side. Gone when it ends.')}</span></div><div className="model-actions">{busy?<><InstallProgress label={t('Installing…')} finishing/><button className="modal-btn" onClick={()=>controller.current?.abort()}>{t('Cancel')}</button></>:active?<><span className="translator-active-badge">{t('Active')}</span><button className="modal-btn danger" onClick={()=>onChange(false)}>{t('Delete')}</button></>:<button className="modal-btn primary" onClick={()=>void install()}>{t('Download')}</button>}</div></div>
}
