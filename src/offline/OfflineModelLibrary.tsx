import {useId,useState} from 'react'
import {useLocale} from '../i18n/Locale'
import {SkillHelp} from '../components/SkillHelp'
import {ModelStore} from './ModelStore'
export function OfflineModelLibrary({disabled=false}:{disabled?:boolean}){
 const {t}=useLocale(),[open,setOpen]=useState(false),id=useId()
 return <section className="offline-library"><div className="offline-library-header"><button type="button" className="offline-library-toggle" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}><span><strong>{t('Offline AI')}</strong><small>{t('Phone · PC')}</small></span><span className="offline-library-chevron" aria-hidden="true">⌄</span></button><SkillHelp name={t('Offline AI')} steps={['Open Offline AI and browse the Phone and PC groups.','Download a model and wait for verification and activation. Only one model is active at a time.','In Settings, select a downloaded model under Active offline AI. Switching keeps your other downloaded files.','After the model and app are saved on your device, open chat to use the active model offline. Guest downloads are temporary.']}/></div><div id={id} hidden={!open} className="offline-library-content">{open&&<ModelStore catalog disabled={disabled}/>}</div></section>
}
