'use client';
import {useRef,useState} from 'react';
import PageHeader from '@/components/ui/PageHeader';
import {SettingsGroup} from '@/components/settings/SettingsUI';
import {nativeSettingAction,useNativeSettings} from '@/lib/nativeSettings';
export default function ChatWidgetPage(){
 const {settings,android}=useNativeSettings();
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false);
 const add=async()=>{if(lock.current||!settings?.pinSupported)return;lock.current=true;setBusy(true);setStatus('');try{setStatus(await nativeSettingAction('widget')?'Launcher request sent. Confirm the widget on your home screen.':'Could not send the request. Add the widget from your launcher instead.');}catch{setStatus('Widget request unavailable.');}finally{lock.current=false;setBusy(false);}};
 return <div className="space-y-5 pb-24">
  <PageHeader sticky bleed title="Home screen widget" back="/settings/chat"/>
  <SettingsGroup title="VANTA Chats">
    <div className="p-4 space-y-3">
      <div className="rounded-2xl border border-white/20 bg-[#1f2630] p-4"><p className="font-semibold text-[#e5c46a]">VANTA Chats</p><p className="text-sm text-white/75">Open messages</p></div>
      <p className="text-sm opacity-75">Open Chats directly from your Android home screen. The widget does not display message previews or unread counts, and your chat passcode still applies.</p>
      {settings?.pinSupported&&<button type="button" disabled={busy} onClick={()=>void add()} className="btn-accent w-full disabled:opacity-50">{busy?'Requesting…':'Add to home screen'}</button>}
      <p className="text-xs opacity-75">{android?(settings?'You can also long-press your home screen, choose Widgets, and select VANTA Chats.':'Update your Android app to a build that includes the widget.'):'This widget is available in the VANTA Android app, not the web browser.'}</p>
      {status&&<p role="status" className="text-sm opacity-75">{status}</p>}
    </div>
  </SettingsGroup>
 </div>;
}
