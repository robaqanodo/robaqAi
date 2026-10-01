import { useEffect, useState } from 'react'
import { updateProfile, type Session } from './vault'
import { deleteProfileData } from './deleteProfile'
import { useLocale } from '../i18n/Locale'
export function Profile({session, onUpdate, onSignOut, onDeleted, onBusyChange}: {session:Session; onUpdate:(session:Session)=>void; onSignOut:()=>void; onDeleted:()=>void; onBusyChange:(busy:boolean)=>void}) {
 const {t}=useLocale()
 const [firstName,setFirstName]=useState(session.firstName ?? '')
 const [lastName,setLastName]=useState(session.lastName ?? '')
 const [ip,setIp]=useState('Checking…')
 const [confirm,setConfirm]=useState(false)
 const [busy,setBusy]=useState(false)
 const [status,setStatus]=useState('')
 const [editing,setEditing]=useState(!(session.firstName?.trim() || session.lastName?.trim()))
 useEffect(()=>{
   const controller=new AbortController()
   const timer=setTimeout(()=>controller.abort(),5000)
   let active=true
   void fetch('https://api64.ipify.org?format=json',{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'}).then(response=>{if(!response.ok)throw new Error();return response.json()}).then(data=>{if(active)setIp(typeof data.ip==='string' && /^[a-fA-F0-9:.]{3,45}$/.test(data.ip) ? data.ip : 'Unavailable offline')}).catch(()=>{if(active)setIp('Unavailable offline')})
   return()=>{active=false;clearTimeout(timer);controller.abort()}
 },[])
 async function action(work:()=>Promise<void>) {
   setBusy(true);onBusyChange(true);setStatus('')
   try {await work()} catch {setStatus('The operation could not be completed. Please try again.')}
   finally {setBusy(false);onBusyChange(false)}
 }
 const info = <dl className="profile-info"><div><dt>{t('Name')}</dt><dd>{[firstName, lastName].filter(Boolean).join(' ') || t('Name not set')}</dd></div><div><dt>{t('Email')}</dt><dd>{session.email}</dd></div><div><dt>{t('IP address')}</dt><dd>{t(ip)}</dd></div></dl>
 return confirm ? <div className="profile-delete-confirm">
  <h3>{t('Delete your profile permanently?')}</h3>
  <p className="modal-help">{t('Your profile and chat history will be permanently deleted. All robaq AI settings, saved API keys and downloaded files on this device will also be cleared, including shared AI and translation packs. This cannot be undone. Other local accounts will remain. Files you saved outside the app are not affected.')}</p>
  {status && <p role="alert" className="modal-error">{t(status)}</p>}
  <div className="modal-actions"><button className="modal-btn ghost" disabled={busy} onClick={()=>setConfirm(false)}>{t('Cancel')}</button><button className="modal-btn danger" disabled={busy} onClick={()=>void action(async()=>{await deleteProfileData(session);onDeleted()})}>{busy?t('Please wait…'):t('Agree')}</button></div>
 </div> : <div className="profile-details">
  {editing ? <form className="account-form" onSubmit={event=>{event.preventDefault();void action(async()=>{onUpdate(await updateProfile(session,firstName,lastName));setStatus('Profile saved.');setEditing(false)})}}>
   <div className="profile-name-grid"><label>{t('First name')}<input value={firstName} maxLength={80} autoComplete="given-name" disabled={busy} onChange={event=>setFirstName(event.target.value)}/></label><label>{t('Last name')}<input value={lastName} maxLength={80} autoComplete="family-name" disabled={busy} onChange={event=>setLastName(event.target.value)}/></label></div>
   {info}
   <p className="modal-help">{t('IP shows your current internet connection, when available. It is not saved to your profile.')}</p>
   <div className="profile-edit-actions"><button className="modal-btn" disabled={busy}>{t('Save profile')}</button>{(firstName || lastName) && <button type="button" className="modal-btn ghost" disabled={busy} onClick={()=>setEditing(false)}>{t('Cancel')}</button>}</div>
  </form> : <div className="profile-readonly">{info}<button className="modal-btn" disabled={busy} onClick={()=>setEditing(true)}>{t('Edit Profile')}</button></div>}
  {status && <p role="status" className="modal-help">{t(status)}</p>}
  <div className="profile-footer"><button className="modal-btn ghost" disabled={busy} onClick={onSignOut}>{t('Sign out')}</button><button className="modal-btn danger" disabled={busy} onClick={()=>{setStatus('');setConfirm(true)}}>{t('Delete Profile')}</button></div>
 </div>
}
