import { useEffect, useState } from 'react'
import { useLocale } from '../i18n/Locale'
import { finishInstallation, InstallProgress } from '../components/InstallProgress'
export function KasStore({active,onChange,onOpen}:{active:boolean;onChange:(active:boolean)=>void;onOpen:()=>void}){
 const {t}=useLocale();const [controller,setController]=useState<AbortController|null>(null)
 useEffect(()=>()=>controller?.abort(),[controller])
 return <div className="side-panel-item"><div className="side-panel-item-body"><span className="side-panel-item-name">KAS 1.0 — Keeping a secret</span><span className="side-panel-item-meta">{t('One code. Up to six questions. Your secret.')}</span></div><div className="model-actions">{controller?<><InstallProgress label={t('Installing…')} finishing/><button type="button" className="modal-btn" onClick={()=>controller.abort()}>{t('Cancel')}</button></>:active?<><span className="translator-active-badge">{t('Active')}</span><button className="modal-btn danger" onClick={()=>onChange(false)}>{t('Delete')}</button></>:<button className="modal-btn primary" onClick={()=>{const c=new AbortController();setController(c);void finishInstallation(c.signal).then(()=>{if(!c.signal.aborted){onChange(true);onOpen()}}).catch(()=>{}).finally(()=>setController(null))}}>{t('Download')}</button>}</div></div>
}
