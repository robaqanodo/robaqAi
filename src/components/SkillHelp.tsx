import {useId,useRef} from 'react'
import {useLocale} from '../i18n/Locale'
import './skill-help.css'
export function SkillHelp({name,steps}:{name:string;steps:string[]}){
 const {t}=useLocale(),dialog=useRef<HTMLDialogElement>(null),id=useId()
 return <><button type="button" className="skill-help-trigger" aria-label={`${name} — ${t('How to use')}`} aria-haspopup="dialog" onClick={()=>dialog.current?.showModal()}>?</button><dialog ref={dialog} className="skill-help-dialog" aria-labelledby={id} onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.current?.close()}}}><h3 id={id}>{name}</h3><p className="skill-help-caption">{t('How to use')}</p><ol>{steps.map(step=><li key={step}>{t(step)}</li>)}</ol><button type="button" className="modal-btn" onClick={()=>dialog.current?.close()}>{t('Close')}</button></dialog></>
}
