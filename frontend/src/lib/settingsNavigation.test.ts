import {describe,expect,it} from 'vitest';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(process.cwd(),'src/app');
function pages(dir:string):string[]{
 return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?pages(join(dir,entry.name)):entry.name==='page.tsx'?[join(dir,entry.name)]:[]);
}
describe('settings static navigation',()=>{
 it('every literal settings link and back target has an existing app route',()=>{
  const all=[...pages(join(root,'settings')),join(root,'profile/settings/page.tsx')];
  expect(all.length).toBeGreaterThan(30);
  const broken:string[]=[];
  for(const page of all){
   for(const match of readFileSync(page,'utf8').matchAll(/(?:href|back)\s*(?:=|:)\s*["'](\/[^"']+)["']/g)){
    const route=match[1].split(/[?#]/)[0];
    if(!existsSync(join(root,route,'page.tsx')))broken.push(page+' -> '+route);
   }
  }
  expect(broken).toEqual([]);
 });
});
