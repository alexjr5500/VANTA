'use client';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/context/AuthContext';
import {apiGet,apiPost,apiDelete} from '@/lib/apiClient';
import PageHeader from '@/components/ui/PageHeader';
import {SettingsGroup} from '@/components/settings/SettingsUI';

type Peer={id:string;username:string};
type Grant={id:string;owner:Peer;delegate:Peer;status:string;scope:string;invitationExpiresAt:string;expiresAt?:string|null};
type Inbox={incoming:Grant[];outgoing:Grant[]};
type Stats={followers:number;posts:number;reels:number;postViews:number;reelViews:number;likes:number;comments:number;postShares:number};
const labels:Record<keyof Stats,string>={followers:'Followers',posts:'Posts',reels:'Published reels',postViews:'Post views',reelViews:'Reel views',likes:'Likes',comments:'Comments',postShares:'Post shares'};

export default function DelegationPage(){
  const {token}=useAuth();
  const [inbox,setInbox]=useState<Inbox|null>(null);
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [code,setCode]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [analytics,setAnalytics]=useState<{grant:Grant;stats:Stats}|null>(null);
  const pending=useRef(false);
  const base='/api/settings/delegations';
  useEffect(()=>{
    let active=true;setInbox(null);setAnalytics(null);setError('');
    if(token)apiGet<Inbox>(base,token,{skipCache:true}).then(data=>{if(active)setInbox(data);}).catch(()=>{if(active)setError('Could not load delegated access.');});
    return()=>{active=false;};
  },[token,revision]);
  const run=async(action:(auth:string)=>Promise<void>)=>{
    if(!token||pending.current)return;
    pending.current=true;setBusy(true);setError('');setNotice('');
    try{await action(token);}catch(caught){setError(caught instanceof Error?caught.message:'Action failed.');}
    finally{pending.current=false;setBusy(false);}
  };
  const refresh=()=>{setAnalytics(null);setRevision(v=>v+1);};
  const invite=()=>run(async auth=>{
    if(!window.confirm('Invite @'+username.replace(/^@/,'')+' to view your aggregate content analytics for 30 days after acceptance?'))return;
    let grant:Grant;
    try{grant=await apiPost<Grant>(base,{username,password,code},auth,undefined,{noRetry:true});}finally{setPassword('');setCode('');}
    setUsername('');refresh();setNotice(grant.status==='ACTIVE'?'This delegate already has access.':'Invitation pending acceptance.');
  });
  const respond=(grant:Grant,accept:boolean)=>run(async auth=>{
    await apiPost(base+'/'+encodeURIComponent(grant.id)+'/respond',{accept},auth);refresh();setNotice(accept?'Invitation accepted.':'Invitation declined.');
  });
  const end=(grant:Grant)=>run(async auth=>{
    if(!window.confirm('End this delegated access or invitation?'))return;
    await apiDelete(base+'/'+encodeURIComponent(grant.id),auth);refresh();setNotice('Access ended.');
  });
  const view=(grant:Grant)=>run(async auth=>{
    setAnalytics(null);
    const result=await apiGet<{stats:Stats}>(base+'/'+encodeURIComponent(grant.id)+'/analytics',auth,{skipCache:true});
    setAnalytics({grant,stats:result.stats});
  });
  const list=(items:Grant[],incoming:boolean)=>items.length?items.map(grant=><div key={grant.id} className="px-4 py-3 space-y-2">
    <p className="font-medium text-sm">@{incoming?grant.owner.username:grant.delegate.username}</p>
    <p className="text-xs opacity-70">Read-only content analytics · {grant.status.toLowerCase()}</p>
    {['PENDING','ACTIVE'].includes(grant.status)&&<p className="text-xs opacity-65">{grant.status==='PENDING'?'Accept by ':'Access expires '}{new Date(grant.status==='PENDING'?grant.invitationExpiresAt:grant.expiresAt||'').toLocaleDateString()}</p>}
    <div className="flex flex-wrap gap-3">
      {incoming&&grant.status==='PENDING'&&<><button type="button" disabled={busy} onClick={()=>void respond(grant,true)} className="min-h-10 text-sm text-[var(--vanta-gold)]">Accept</button><button type="button" disabled={busy} onClick={()=>void respond(grant,false)} className="min-h-10 text-sm opacity-75">Decline</button></>}
      {incoming&&grant.status==='ACTIVE'&&<button type="button" disabled={busy} onClick={()=>void view(grant)} className="min-h-10 text-sm text-[var(--vanta-gold)]">View analytics</button>}
      {((!incoming&&grant.status==='PENDING')||grant.status==='ACTIVE')&&<button type="button" disabled={busy} onClick={()=>void end(grant)} className="min-h-10 text-sm text-red-400">{incoming?'Leave access':grant.status==='PENDING'?'Cancel invitation':'Revoke access'}</button>}
    </div>
  </div>):<p className="p-4 text-sm opacity-70">No {incoming?'received':'sent'} invitations.</p>;
  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title="Delegated access" back="/settings/security"/>
    <p className="text-sm opacity-75">Invite another VANTA user to view aggregate content analytics without sharing your sign-in. Invitations expire after 7 days. Accepted access expires after 30 days and can be revoked at any time.</p>
    <SettingsGroup title="Permission">
      <div className="p-4 space-y-2"><p className="text-sm font-medium">Read-only content analytics</p><p className="text-xs opacity-75">Followers, posts, reels, views, likes, comments and post shares. No publishing, editing, messaging, wallet, earnings or security access.</p></div>
    </SettingsGroup>
    <SettingsGroup title="Invite a delegate">
      <form className="p-4 space-y-3" onSubmit={event=>{event.preventDefault();void invite();}}>
        <label htmlFor="delegate-user" className="text-sm">VANTA username</label>
        <input id="delegate-user" value={username} onChange={event=>setUsername(event.target.value)} maxLength={31} placeholder="@username" className="settings-input w-full"/>
        <label className="block text-sm">Current password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} className="settings-input w-full" required /></label>
        <label className="block text-sm">Authenticator code (if enabled)<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))} className="settings-input w-full" /></label>
        <button type="submit" disabled={busy||!username.trim()||!password} className="btn-accent w-full disabled:opacity-50">Send invitation</button>
      </form>
    </SettingsGroup>
    {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
    {notice&&<p role="status" className="text-sm text-[var(--vanta-gold)]">{notice}</p>}
    <button type="button" disabled={busy} onClick={refresh} className="min-h-10 text-sm text-[var(--vanta-gold)]">Refresh access</button>
    <SettingsGroup title="Access you granted">{inbox?list(inbox.outgoing,false):<p className="p-4 text-sm opacity-70">{error?'Unavailable':'Loading…'}</p>}</SettingsGroup>
    <SettingsGroup title="Access shared with you">{inbox?list(inbox.incoming,true):<p className="p-4 text-sm opacity-70">{error?'Unavailable':'Loading…'}</p>}</SettingsGroup>
    {analytics&&<SettingsGroup title={'Analytics for @'+analytics.grant.owner.username}>
      <div className="grid grid-cols-2 gap-4 p-4">{(Object.keys(labels) as (keyof Stats)[]).map(key=><div key={key}><p className="text-xs opacity-65">{labels[key]}</p><p className="text-xl font-semibold">{analytics.stats[key].toLocaleString()}</p></div>)}</div>
      <p className="px-4 text-xs opacity-65">Cumulative totals at the time of your request.</p>
      <button type="button" onClick={()=>setAnalytics(null)} className="min-h-11 px-4 text-sm text-[var(--vanta-gold)]">Close analytics</button>
    </SettingsGroup>}
  </div>;
}
