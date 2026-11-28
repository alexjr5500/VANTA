import {retentionCutoff,visibleMessageWhere,messageIsVisible,removeHiddenReply} from '../services/chat-retention';
describe('chat retention policy',()=>{
 const now=Date.parse('2026-11-28T08:00:00Z');
 const cutoff=retentionCutoff('{"autoDeleteSeconds":3600}',now)!;
 test('expiry boundary and disabled or invalid settings',()=>{
   expect(cutoff.toISOString()).toBe('2026-11-28T07:00:00.000Z');
   expect(retentionCutoff('{"autoDeleteSeconds":0}',now)).toBeUndefined();
   expect(retentionCutoff('invalid',now)).toBeUndefined();
   expect(messageIsVisible({createdAt:cutoff},'a',cutoff)).toBe(true);
   expect(messageIsVisible({createdAt:new Date(cutoff.getTime()-1)},'a',cutoff)).toBe(false);
 });
 test('private and moderated deletions apply independently of expiry',()=>{
   expect(messageIsVisible({deletedFor:'a'},'a')).toBe(false);
   expect(messageIsVisible({deletedFor:'b'},'a')).toBe(true);
   expect(messageIsVisible({moderationRemovedAt:new Date()},'a')).toBe(false);
   expect(visibleMessageWhere('a',cutoff)).toMatchObject({createdAt:{gte:cutoff},deletedAt:null,moderationRemovedAt:null});
 });
 test('expired quoted content cannot leak through a newer message',()=>{
   expect(removeHiddenReply({replyTo:{createdAt:new Date(now-7200000),content:'old'}},'a',cutoff).replyTo).toBeNull();
 });
});
