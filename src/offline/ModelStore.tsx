import {useEffect,useState} from 'react'
import {useLocale} from '../i18n/Locale'
import {MODELS} from './models'
import {useModelFlow,chooseModel,pauseModel,cancelModel,refreshModelFlow} from './modelFlow'
import {InstallProgress} from '../components/InstallProgress'
import './models.css'
export function ModelStore({catalog=false,onSettings,disabled=false}:{catalog?:boolean;onSettings?:()=>void;disabled?:boolean}){
 const {t}=useLocale(),flow=useModelFlow();const [memory,setMemory]=useState<number|undefined>()
 useEffect(()=>{void refreshModelFlow();setMemory((navigator as Navigator&{deviceMemory?:number}).deviceMemory)},[])
 const recommended=memory?(memory>=48?'gemma4-31':memory>=24?'qwen36-27':memory>=16?'gemma4-12':memory>=8?'qwen35-4':'qwen35-2'):'qwen35-2'
 const groups=catalog?['phone','desktop']:['active']
 return <>{groups.map(group=><section className="offline-model-group" key={group}>{catalog&&<h4>{t(group==='phone'?'Offline AI for Phone':'Offline AI for Desktop')}</h4>}<ul className="side-panel-list offline-models">{MODELS.filter(m=>catalog?m.group===group:m.id===flow.active).map(model=>{
 const stored=flow.installed.includes(model.id),active=stored&&flow.active===model.id,busy=flow.busy===model.id
 return <li className="side-panel-item" key={model.id}><div className="side-panel-item-body"><span className="side-panel-item-name">{model.name} {catalog&&recommended===model.id&&<small className="model-recommended">{t('Recommended')}</small>}</span>{catalog&&<span className="side-panel-item-meta">{t(model.description)}</span>}<span className="side-panel-item-meta">{Math.round(model.size/1e6)} MB · {model.quant} · {model.license}</span><span className="side-panel-item-meta">{model.ram} GB {t('RAM recommended')}</span>{model.group==='phone'&&<span className="side-panel-item-meta">{t(model.device)}</span>}{memory&&model.size>memory*1e9/2&&<span className="model-memory-warning">{t('This file exceeds half of estimated device memory. Loading may fail; you can still download it.')}</span>}</div><div className="model-actions">{busy?<><InstallProgress label={t(flow.phase)+(flow.phase==='Downloading'||flow.phase==='Verifying'?` ${Math.round(flow.progress*100)}%`:'')} progress={flow.progress} finishing={flow.phase==='Installing…'}/><button className="modal-btn" onClick={pauseModel}>{t('Pause')}</button><button className="modal-btn" onClick={cancelModel}>{t('Cancel')}</button></>:active?<span className="translator-active-badge">{t('Active')}</span>:<button className="modal-btn primary" disabled={disabled||!!flow.busy} onClick={()=>void chooseModel(model.id)}>{t(stored?'Use':flow.paused===model.id?'Resume':'Download')}</button>}</div></li>
 })}</ul></section>)}{!catalog&&<p className="modal-help">{t('Choose your offline model in Settings.')} <button className="modal-btn" onClick={onSettings}>{t('Settings')}</button></p>}{flow.error&&<p className="modal-error" role="alert">{t(flow.error)}</p>}</>
}
