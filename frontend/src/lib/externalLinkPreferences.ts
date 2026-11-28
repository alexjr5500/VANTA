export type WebLinkMode='new_tab'|'same_tab';
export const WEB_LINK_MODE_KEY='vanta_web_link_mode';
export function parseWebLinkMode(raw:unknown):WebLinkMode{return raw==='same_tab'?'same_tab':'new_tab';}
export function readWebLinkMode():WebLinkMode{
  try{return parseWebLinkMode(localStorage.getItem(WEB_LINK_MODE_KEY));}catch{return 'new_tab';}
}
export function writeWebLinkMode(mode:WebLinkMode){
  if(mode!=='new_tab'&&mode!=='same_tab')throw new Error('Invalid link preference');
  localStorage.setItem(WEB_LINK_MODE_KEY,mode);
}
export function shouldUseSameTab(mode:WebLinkMode,href:string,origin:string,android:boolean):boolean{
  try{const url=new URL(href);return !android&&mode==='same_tab'&&['https:','http:'].includes(url.protocol)&&url.origin!==origin&&!url.username&&!url.password;}catch{return false;}
}
