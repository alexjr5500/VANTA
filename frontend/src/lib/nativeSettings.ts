'use client';
import {useEffect,useState} from 'react';
export type NativeSettings={nonce:string;linkMode:'browser'|'custom_tab';pinSupported:boolean;version:string;versionCode:number};
type NativeBridge={setExternalLinkMode:(nonce:string,mode:'browser'|'custom_tab',id:string)=>void;requestChatWidget:(nonce:string,id:string)=>void};
type NativeWindow=Window & {__VANTA_NATIVE_SETTINGS__?:NativeSettings;VantaNativeSettings?:NativeBridge};
const nativeWindow=()=>window as NativeWindow;
export function useNativeSettings(){
  const [settings,setSettings]=useState<NativeSettings|null>(null);
  const [android,setAndroid]=useState(false);
  useEffect(()=>{
    const refresh=()=>{setSettings(nativeWindow().__VANTA_NATIVE_SETTINGS__||null);setAndroid(/VANTAAndroid/.test(navigator.userAgent));};
    refresh();window.addEventListener('vanta-native-settings-ready',refresh);
    return()=>window.removeEventListener('vanta-native-settings-ready',refresh);
  },[]);
  return {settings,android};
}
export function nativeSettingAction(action:'widget'|'browser'|'custom_tab'):Promise<boolean>{
  return new Promise(resolve=>{
    const w=nativeWindow(),settings=w.__VANTA_NATIVE_SETTINGS__,bridge=w.VantaNativeSettings;
    if(!settings?.nonce||!bridge){resolve(false);return;}
    const id=crypto.randomUUID();
    const finish=(ok:boolean)=>{window.clearTimeout(timeout);window.removeEventListener('vanta-native-settings-result',listener);resolve(ok);};
    const listener=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.requestId===id)finish(detail.ok===true);};
    const timeout=window.setTimeout(()=>finish(false),5000);
    window.addEventListener('vanta-native-settings-result',listener);
    try{if(action==='widget')bridge.requestChatWidget(settings.nonce,id);else bridge.setExternalLinkMode(settings.nonce,action,id);}catch{finish(false);}
  });
}
