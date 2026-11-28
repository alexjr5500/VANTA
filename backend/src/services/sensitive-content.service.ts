import { prisma } from '../prisma';
export function sensitiveFilter(hide:boolean): {sensitiveContent?:false} {return hide?{sensitiveContent:false}:{};}
export function mayShowLabeledContent(birth:Date|null|undefined,preference:boolean|undefined,now=new Date()):boolean{
  if(preference!==false||!birth||Number.isNaN(birth.getTime()))return false;
  const cutoff=new Date(now);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-18);
  return birth<=cutoff;
}
export async function hideSensitiveForViewer(userId?:string):Promise<boolean>{
  if(!userId)return true;
  try{
    const viewer=await prisma.user.findUnique({where:{id:userId},select:{dateOfBirth:true,userSettings:{select:{hideSensitiveContent:true}}}});
    return !mayShowLabeledContent(viewer?.dateOfBirth,viewer?.userSettings?.hideSensitiveContent);
  }catch{return true;}
}
