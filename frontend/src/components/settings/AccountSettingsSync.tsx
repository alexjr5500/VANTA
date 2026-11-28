'use client';
import {useEffect} from 'react';
import {useAuth} from '@/context/AuthContext';
import {useTheme} from '@/context/ThemeContext';
import {useI18n} from '@/lib/i18n/context';
import {locales} from '@/lib/i18n/config';
import {apiGet} from '@/lib/apiClient';

// Non-blocking account preference hydration on sign-in, not only when a
// settings page is opened. Cancel stale responses when the session changes.
export default function AccountSettingsSync(){
 const {token}=useAuth();
 const {setAccent,setDensity}=useTheme();
 const {setLocale}=useI18n();
 useEffect(()=>{
   if(!token)return;
   let active=true;
   apiGet<{accent?:string;density?:string;language?:string}>('/api/settings/privacy',token,{skipCache:true}).then(data=>{
     if(!active||!data)return;
     if(data.accent==='gold'||data.accent==='monochrome')setAccent(data.accent);
     if(data.density==='compact'||data.density==='comfortable')setDensity(data.density);
     const locale=locales.find(value=>value.toLowerCase()===data.language?.toLowerCase());
     if(locale)void setLocale(locale);
   }).catch(()=>undefined);
   return()=>{active=false;};
 },[token,setAccent,setDensity,setLocale]);
 return null;
}
