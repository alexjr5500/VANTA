/** Parse only known, type-correct local preferences, ignoring corrupted or extra fields. */
export function localSettingsValue<T extends Record<string, boolean | string>>(raw: string|null,defaults:T):T {
  const next={...defaults};
  try {
    const value=JSON.parse(raw||'{}');
    if(!value||typeof value!=='object'||Array.isArray(value))return next;
    for(const key of Object.keys(defaults) as (keyof T)[]){
      if(typeof value[key]!==typeof defaults[key])continue;
      if(key==='speed'&&!['1','1.5','2'].includes(value[key]))continue;
      if(key==='quality'&&!['auto','hd','sd'].includes(value[key]))continue;
      next[key]=value[key];
    }
  }catch{/* corrupt storage */}
  return next;
}
/** Alias the two settings hubs but isolate each subpage's scroll offset. */
export function settingsScrollKey(pathname:string):string{
  return 'vanta_settings_scroll:'+ (pathname==='/profile/settings'?'/settings':pathname);
}
