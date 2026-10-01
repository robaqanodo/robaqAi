import { useLocale } from '../i18n/Locale'
import type { Conversation } from './vault'
export function History({chats,activeId,onOpen,onNew,onChange,onClose}:{chats:Conversation[];activeId:string|null;onOpen:(chat:Conversation)=>void;onNew:()=>void;onChange:(chat:Conversation)=>void;onClose:()=>void}) {
 const {t,locale}=useLocale()
 const visible=chats.filter(chat=>!chat.deleted).sort((a,b)=>b.updated-a.updated)
 return <aside className="history-drawer" aria-label={t('Chat history')}>
  <div className="history-heading"><strong>{t('Your chats')}</strong><button aria-label={t('Collapse history')} onClick={onClose}>←</button></div>
  <button className="modal-btn primary" onClick={onNew}>{t('＋ New chat')}</button>
  <div className="history-list">{visible.length===0 && <p className="modal-help">{t('No chats here yet.')}</p>}{visible.map(chat=><article className={`history-item${chat.id===activeId?' is-selected':''}`} key={chat.id}>
   <button className="history-title" onClick={()=>onOpen(chat)}>{chat.title==='New chat'?t('New chat'):chat.title}</button>
   <small>{new Date(chat.updated).toLocaleDateString(locale)}</small>
   <details><summary aria-label={`${t('Options for')} ${chat.title}`}>•••</summary><div className="history-options"><button className="history-trash" onClick={()=>onChange({...chat,deleted:true})}>DELETE</button></div></details>
  </article>)}</div>
  <small className="history-local">{t('Encrypted · Stored on this device')}</small>
 </aside>
}
