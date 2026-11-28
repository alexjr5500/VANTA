import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
jest.mock('../prisma',()=>({prisma:{}}));
jest.mock('../services/upload.service',()=>({uploadService:{}}));
import { nextChatMediaCleanupCandidate } from '../services/chat-media-expiry.service';

const databaseUrl=process.env.DATABASE_URL;
const suite=databaseUrl?describe:describe.skip;
suite('Expired chat media PostgreSQL candidate query',()=>{
  let admin:Pool,pool:Pool,db:PrismaClient,schema:string;
  const now=new Date('2026-11-28T12:00:00Z');
  beforeAll(async()=>{
    schema='chat_cleanup_'+randomUUID().replace(/-/g,'');
    admin=new Pool({connectionString:databaseUrl,max:1});
    await admin.query('CREATE SCHEMA "'+schema+'"');
    pool=new Pool({connectionString:databaseUrl,max:2,options:'-c search_path='+schema});
    const url=new URL(databaseUrl!);url.searchParams.set('schema',schema);
    db=new PrismaClient({datasources:{db:{url:url.toString()}}});
    await pool.query(`
      CREATE TABLE "Conversation"(id text primary key,type text,"isGroup" boolean,permissions text);
      CREATE TABLE "Message"(id text primary key,"conversationId" text,"senderId" text,"createdAt" timestamp,"moderationRemovedAt" timestamp,"storyReplyMediaUrl" text);
      CREATE TABLE "UploadedFile"(id text primary key,filename text,path text,url text,size int,"userId" text,category text,"recordType" text,"recordId" text,"deletedAt" timestamp,"moderationOriginalPath" text,"moderationOriginalUrl" text,"createdAt" timestamp,"updatedAt" timestamp);
      CREATE TABLE "Attachment"("messageId" text,url text);
      CREATE TABLE "PropertyMedia"("uploadedFileId" text);
      CREATE TABLE "Story"("mediaUrl" text);
      CREATE TABLE "Post"("mediaUrl" text);
      CREATE TABLE "Video"("videoUrl" text,"thumbnailUrl" text);
      CREATE TABLE "ModerationQueue"("targetId" text,"targetUserId" text,status text,"evidenceUrls" text);
      CREATE TABLE "CopyrightClaim"("infringingContentId" text,"infringingUrl" text);
      CREATE TABLE "ChildSafetyFlag"("userId" text,status text);
      CREATE TABLE "Report"("targetId" text,status text);
    `);
  });
  afterAll(async()=>{if(db)await db.$disconnect();if(pool)await pool.end();if(admin&&schema){await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.end();}});
  beforeEach(async()=>{await pool.query('TRUNCATE "Conversation","Message","UploadedFile","Attachment","PropertyMedia","Story","Post","Video","ModerationQueue","CopyrightClaim","ChildSafetyFlag","Report"');});
  async function add(id:string,type='GROUP',permissions='{"autoDeleteSeconds":86400}',created='2026-11-10T12:00:00Z'){
    await pool.query('INSERT INTO "Conversation" VALUES ($1,$2,$3,$4)',['c'+id,type,type==='GROUP',permissions]);
    await pool.query('INSERT INTO "Message" VALUES ($1,$2,$3,$4,NULL,NULL)',['m'+id,'c'+id,'u'+id,created]);
    await pool.query('INSERT INTO "UploadedFile" VALUES ($1,$2,$3,$4,123,$5,\'message\',\'Message\',$6,NULL,NULL,NULL,$7,$7)',[id,id+'.jpg','cloudinary:image:vanta/message/'+id,'https://example.test/'+id,'u'+id,'m'+id,created]);
    await pool.query('INSERT INTO "Attachment" VALUES ($1,$2)',['m'+id,'https://example.test/'+id]);
  }
  test('only expired, old, unshared and unheld group media is selected',async()=>{
    await add('eligible');
    await add('direct','DIRECT');
    await add('off','GROUP','{"autoDeleteSeconds":0}');
    await add('malformed','GROUP','not json');
    await add('grace','GROUP','{"autoDeleteSeconds":86400}','2026-11-25T12:00:00Z');
    await add('shared');
    await pool.query('INSERT INTO "Attachment" VALUES ($1,$2)',['mother','https://example.test/shared']);
    await add('moderated');
    await pool.query('INSERT INTO "ModerationQueue" VALUES ($1,NULL,\'APPROVED\',NULL)',['mmoderated']);
    await add('copyright');
    await pool.query('INSERT INTO "CopyrightClaim" VALUES (NULL,$1)',['https://example.test/copyright']);
    await add('reported');
    await pool.query('INSERT INTO "Report" VALUES ($1,\'PENDING\')',['ureported']);
    await add('child');
    await pool.query('INSERT INTO "ChildSafetyFlag" VALUES ($1,\'ESCALATED\')',['uchild']);
    await add('duplicate');
    await pool.query('INSERT INTO "UploadedFile" SELECT \'alias\',filename,path,url,size,"userId",category,"recordType","recordId",NULL,NULL,NULL,"createdAt","updatedAt" FROM "UploadedFile" WHERE id=\'duplicate\'');
    await expect(db.$transaction(tx=>nextChatMediaCleanupCandidate(tx,now,[]))).resolves.toMatchObject({id:'eligible'});
    await expect(db.$transaction(tx=>nextChatMediaCleanupCandidate(tx,now,['eligible']))).resolves.toBeUndefined();
  });
  test('row locking prevents simultaneous selection by a second worker',async()=>{
    await add('locked');
    const first=await pool.connect();
    try{
      await first.query('BEGIN');
      await first.query('SELECT id FROM "UploadedFile" WHERE id=\'locked\' FOR UPDATE');
      await expect(db.$transaction(tx=>nextChatMediaCleanupCandidate(tx,now,[]))).resolves.toBeUndefined();
      await first.query('COMMIT');
      await expect(db.$transaction(tx=>nextChatMediaCleanupCandidate(tx,now,[]))).resolves.toMatchObject({id:'locked'});
    }finally{await first.query('ROLLBACK').catch(()=>undefined);first.release();}
  });
});
