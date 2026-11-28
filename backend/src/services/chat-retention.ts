import type { Prisma } from '@prisma/client';

/** Existing group expiry is a read/access policy, not a physical deletion job. */
export function retentionCutoff(permissions: string|null|undefined, now=Date.now()):Date|undefined {
  try {
    const seconds=Number(JSON.parse(permissions||'{}')?.autoDeleteSeconds);
    return Number.isSafeInteger(seconds)&&seconds>0&&seconds<=31536000?new Date(now-seconds*1000):undefined;
  }catch{return undefined;}
}
export function visibleMessageWhere(userId:string,cutoff?:Date):Prisma.MessageWhereInput {
  return {deletedAt:null,moderationRemovedAt:null,OR:[{deletedFor:null},{deletedFor:{not:userId}}],...(cutoff?{createdAt:{gte:cutoff}}:{})};
}
export function messageIsVisible(message:{deletedAt?:unknown;moderationRemovedAt?:unknown;deletedFor?:string|null;createdAt?:Date|string}|null|undefined,userId:string,cutoff?:Date):boolean {
  if(!message||message.deletedAt||message.moderationRemovedAt||message.deletedFor===userId)return false;
  if(!cutoff)return true;
  const date=message.createdAt instanceof Date?message.createdAt.getTime():typeof message.createdAt==='string'?Date.parse(message.createdAt):NaN;
  return Number.isFinite(date)&&date>=cutoff.getTime();
}
export function removeHiddenReply<T extends {replyTo?:any}>(message:T,userId:string,cutoff?:Date):T {
  return message.replyTo&&!messageIsVisible(message.replyTo,userId,cutoff)?{...message,replyTo:null}:message;
}
