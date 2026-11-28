'use client';
import {useEffect,useRef,useState} from 'react';
import {SettingsGroup,SelectRow} from '@/components/settings/SettingsUI';
import PageHeader from '@/components/ui/PageHeader';
import {readWebLinkMode,writeWebLinkMode,WebLinkMode} from '@/lib/externalLinkPreferences';
import {nativeSettingAction,useNativeSettings} from '@/lib/nativeSettings';
export default function ExternalLinksPage(){
 const {settings,android}=useNativeSettings();
 const [webMode,setWebMode]=useState<WebLinkMode>('new_tab');
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 const lock=useRef(false);
 useEffect(()=>{setWebMode(readWebLinkMode());setReady(true);},[]);
 const change=async(value:string)=>{
   if(lock.current)return;lock.current=true;setBusy(true);setStatus('');
   try{
     if(android){
       if(value!=='browser'&&value!=='custom_tab')return;
       if(!await nativeSettingAction(value))throw new Error('Native preference could not be saved');
     }else{if(value!=='new_tab'&&value!=='same_tab')return;writeWebLinkMode(value);setWebMode(value);}
     setStatus('Preference saved.');
   }catch{setStatus('Could not save preference. Try again.');}
   finally{lock.current=false;setBusy(false);}
 };
 return <div className="space-y-5 pb-24">
   <PageHeader sticky bleed title="External links" back="/settings/content"/>
   <p className="text-sm opacity-75">Choose how supported external links open on this device. VANTA pages remain inside the app.</p>
   <SettingsGroup title="Opening links">
     {android?<SelectRow title="External browser preference" value={settings?.linkMode||'browser'} disabled={!settings||busy} options={[{value:'browser',label:'Default browser'},{value:'custom_tab',label:'Browser tab inside app',description:'Uses an isolated Android Custom Tab when available.'}]} onSelect={value=>void change(value)}/>:<SelectRow title="External link preference" value={webMode} disabled={!ready||busy} options={[{value:'new_tab',label:'Open in a new tab'},{value:'same_tab',label:'Open in the current tab'}]} onSelect={value=>void change(value)}/>}
     <p className="px-4 py-3 text-xs opacity-70">{android?(settings?'HTTPS websites never enter the authenticated VANTA WebView. OAuth sign-in uses the default browser.':'This Android build does not expose the native setting. Update to a compatible production app.'):'Applies to supported text links in posts, comments and chats. Modified clicks retain normal browser behavior.'}</p>
     {status&&<p role="status" className="px-4 py-2 text-sm opacity-75">{status}</p>}
   </SettingsGroup>
 </div>;
}
