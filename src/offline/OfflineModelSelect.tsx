import {useEffect} from 'react'
import {useLocale} from '../i18n/Locale'
import {MODELS} from './models'
import {chooseModel,refreshModelFlow,useModelFlow} from './modelFlow'
export function OfflineModelSelect({disabled=false}:{disabled?:boolean}){
 const {t}=useLocale(),flow=useModelFlow()
 useEffect(()=>{void refreshModelFlow()},[])
 const downloaded=MODELS.filter(model=>flow.installed.includes(model.id))
 const selected=downloaded.some(model=>model.id===flow.active)?flow.active:''
 return <div id="offline-ai-settings"><label className="settings-language">{t('Active offline AI')}<select value={selected} disabled={disabled||!!flow.busy||!downloaded.length} onChange={event=>{const id=event.target.value;if(id!==flow.active&&downloaded.some(model=>model.id===id))void chooseModel(id)}}>{!selected&&<option value="" disabled>{t(downloaded.length?'Select a downloaded model':'No downloaded models')}</option>}{downloaded.map(model=><option key={model.id} value={model.id} disabled={model.id===flow.active}>{model.name}{model.id===flow.active?` · ${t('Active')}`:''}</option>)}</select></label>{!downloaded.length&&<p className="modal-help">{t('Download offline models in AI Lab first.')}</p>}{flow.busy&&<p className="modal-help" role="status">{t(flow.phase)}</p>}{flow.error&&<p className="modal-error" role="alert">{t(flow.error)}</p>}</div>
}
