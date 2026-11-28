import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { retentionCutoff } from './chat-retention';
import { uploadService } from './upload.service';

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 10;
let running = false;

type Candidate={id:string;filename:string;path:string|null;url:string;messageId:string;permissions:string|null;createdAt:Date;size:number};

/**
 * Scope deliberately limited to attached media in groups with explicit expiry.
 * The SQL prefilter is safe for malformed legacy permission strings; the exact
 * parsed retention rule is checked again under lock before any destruction.
 * Lock the owning message and upload row across the provider call so multiple
 * replicas cannot clean the same attachment or race normal message moderation.
 */
async function nextCandidate(tx:Prisma.TransactionClient,now:Date,skipped:string[]):Promise<Candidate|undefined>{
  const graceCutoff=new Date(now.getTime()-GRACE_MS);
  const localEnabled=process.env.CHAT_MEDIA_CLEANUP_LOCAL_SHARED_STORAGE==='true';
  const rows=await tx.$queryRaw<Candidate[]>`
    SELECT f.id,f.filename,f.path,f.url,f.size,m.id AS "messageId",m."createdAt",c.permissions
    FROM "UploadedFile" f
    JOIN "Message" m ON m.id=f."recordId" AND m."senderId"=f."userId"
    JOIN "Conversation" c ON c.id=m."conversationId"
    CROSS JOIN LATERAL (
      SELECT substring(c.permissions from '"autoDeleteSeconds"[[:space:]]*:[[:space:]]*([0-9]{1,8})[[:space:]]*[,}]')::integer AS seconds
    ) retention
    WHERE f.category='message' AND f."recordType"='Message' AND f."deletedAt" IS NULL
      AND f.path IS NOT NULL AND (f.path LIKE 'cloudinary:%:vanta/message/%' OR ${localEnabled})
      AND f."moderationOriginalPath" IS NULL AND f."moderationOriginalUrl" IS NULL
      AND c.type='GROUP' AND c."isGroup"=true AND m."moderationRemovedAt" IS NULL
      AND retention.seconds BETWEEN 1 AND 31536000
      AND m."createdAt" < ${graceCutoff} - retention.seconds * interval '1 second'
      AND f."createdAt" < ${graceCutoff}
      AND EXISTS (SELECT 1 FROM "Attachment" a WHERE a."messageId"=m.id AND a.url=f.url)
      AND NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a."messageId"<>m.id AND a.url=f.url)
      AND NOT EXISTS (SELECT 1 FROM "UploadedFile" o WHERE o.id<>f.id AND (o.path=f.path OR o.url=f.url OR o."moderationOriginalPath"=f.path OR o."moderationOriginalUrl"=f.url OR o.filename=f.filename))
      AND NOT EXISTS (SELECT 1 FROM "PropertyMedia" p WHERE p."uploadedFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "Story" s WHERE s."mediaUrl"=f.url)
      AND NOT EXISTS (SELECT 1 FROM "Post" p WHERE p."mediaUrl"=f.url)
      AND NOT EXISTS (SELECT 1 FROM "Video" v WHERE v."videoUrl"=f.url OR v."thumbnailUrl"=f.url)
      AND NOT EXISTS (SELECT 1 FROM "Message" r WHERE r."storyReplyMediaUrl"=f.url)
      AND NOT EXISTS (SELECT 1 FROM "ModerationQueue" q WHERE q."targetId" IN (m.id,c.id,f.id) OR (q."targetUserId"=m."senderId" AND q.status IN ('PENDING','FLAGGED','UNDER_REVIEW')) OR position(f.url in coalesce(q."evidenceUrls",''))>0)
      AND NOT EXISTS (SELECT 1 FROM "CopyrightClaim" k WHERE k."infringingContentId" IN (m.id,c.id,f.id) OR k."infringingUrl"=f.url)
      AND NOT EXISTS (SELECT 1 FROM "ChildSafetyFlag" s WHERE s."userId"=m."senderId" AND s.status NOT IN ('APPROVED','DISMISSED'))
      AND NOT EXISTS (SELECT 1 FROM "Report" r WHERE r."targetId"=m."senderId" AND r.status NOT IN ('RESOLVED','DISMISSED'))
      AND f.id NOT IN (${Prisma.join(skipped.length?skipped:[''])})
    ORDER BY f."updatedAt", f.id LIMIT 1
    FOR UPDATE OF f,m SKIP LOCKED
  `;
  return rows[0];
}

export async function sweepExpiredChatMedia(now=new Date()){
  if(running||process.env.CHAT_MEDIA_CLEANUP_DISABLED==='true')return {files:0,bytes:0,failed:0};
  running=true;
  let files=0,bytes=0,failed=0;
  const skipped:string[]=[];
  try{
    for(let i=0;i<BATCH_SIZE;i++){
      let selected:Candidate|undefined;
      try{
        const result=await prisma.$transaction(async tx=>{
          selected=await nextCandidate(tx,now,skipped);
          if(!selected)return null;
          const file=selected;
          const cutoff=retentionCutoff(file.permissions,now.getTime()-GRACE_MS);
          if(!cutoff||file.createdAt>=cutoff)throw new Error('Retention rule changed or invalid');
          // Only mark metadata deleted after storage success; keep the row as
          // an idempotent retry marker if either provider or transaction fails.
          await uploadService.purgeExpiredChatAsset(file);
          const updated=await tx.uploadedFile.updateMany({where:{id:file.id,category:'message',recordType:'Message',recordId:file.messageId,deletedAt:null},data:{deletedAt:now}});
          if(updated.count!==1)throw new Error('Cleanup metadata changed');
          await tx.attachment.deleteMany({where:{messageId:file.messageId,url:file.url}});
          return {bytes:file.size};
        },{timeout:40000,maxWait:5000});
        if(!result)break;
        files++;bytes+=result.bytes;
      }catch(error){
        if(!selected)throw error;
        failed++;skipped.push(selected.id);
        const fileId=selected.id;
        console.warn('[ChatMediaExpiry] Attachment cleanup deferred',{fileId,error:error instanceof Error?error.message:'unknown'});
        await prisma.uploadedFile.updateMany({where:{id:fileId,deletedAt:null},data:{updatedAt:now}}).catch(()=>undefined);
      }
    }
    return {files,bytes,failed};
  }finally{running=false;}
}
