import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inventoryMedia,captureStableMedia,mediaDayId,mediaConfig,runMediaDay} from './backup-media-daily.mjs';
import {backupPrefix,verifiedBackupSet} from './backup-r2-multipart.mjs';
import {reviewRetention} from './backup-retention-review.mjs';
import {runAlertDrill} from './backup-alert-drill.mjs';
import {sendBackupAlert} from './backup-operations.mjs';
const now=1800000000000,id=mediaDayId(now),prefix=backupPrefix('production-media',id),sha='a'.repeat(64);
test('media namespace separate and opt-in',()=>{assert.equal(mediaDayId(now+1000),id);assert.notEqual(mediaDayId(now+86400000),id);assert.throws(()=>mediaConfig({}));assert.throws(()=>verifiedBackupSet({}, {},id,'production-media'));});
test('media source inventory excludes transient work, rejects symlinks and concurrent change',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-ci-'));try{
    const src=join(root,'uploads'),scratch=join(root,'scratch');await mkdir(src);await mkdir(scratch);await mkdir(join(src,'.chunks'));await writeFile(join(src,'.chunks','part'),'pending');await writeFile(join(src,'photo'),'image');
    assert.deepEqual((await inventoryMedia(src,{limit:100})).names,['photo']);
    await assert.rejects(captureStableMedia({directory:src,scratch,limit:100,recipient:'fixture',producerEnv:{},capture:async()=>{await writeFile(join(src,'photo'),'changed');return {bytes:30};}}),/Source changed/);
    await symlink('/etc/passwd',join(src,'bad'));await assert.rejects(inventoryMedia(src,{limit:100}));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('remote marker follows verified media upload, no full restore claim',async()=>{
  const calls=[];const r=await runMediaDay({now,limit:1000,budget:1000000000,adapters:{
    acquire:async()=>({healthy:async()=>true,release:async()=>calls.push('release')}),inventory:async()=>({inventoryComplete:true,incompleteUploadBytes:0,objects:new Map(),unresolvedAttempt:false,storedBytes:0,scratchFreeBytes:1000000000}),previous:async()=>null,capture:async()=>{calls.push('capture');return {path:'media',bytes:200,inventoryDigest:sha}},begin:async()=>calls.push('begin'),upload:async(kind)=>{calls.push(kind);return {key:prefix+kind,bytes:200,sha256:sha,verified:true}},marker:async()=>{calls.push('sign');return 'marker'},record:async()=>calls.push('record'),fail:async()=>calls.push('fail')
  }});assert.deepEqual(calls,['capture','begin','media.tar.age','sign','manifest.json.age','record','release']);assert.equal(r.independentRestoreVerified,false);assert.equal(r.synchronizedDatabase,false);
});
test('retention protects all sets without independent evidence, even if old',()=>{
  const r=reviewRetention({nowMs:now,sets:[{scope:'production',id:'a',completedAtMs:now-9*86400000},{scope:'production-db',id:'b',completedAtMs:now-8*86400000}]});
  assert.equal(r.scopes.production.olderThanPolicy,1);assert.equal(r.scopes['production-db'].protected,1);assert.deepEqual(r.deleteCandidates,[]);assert.equal(r.deletionAuthorized,false);
});
test('alert drill is explicitly a test, uses actual mail transport contract, and rejects source access',async()=>{
  const env={VANTA_BACKUP_ALERT_DRILL_APPROVED:'yes',VANTA_BACKUP_ALERTS_ENABLED:'yes',VANTA_BACKUP_ALERT_SENDGRID_KEY:'SG.fixture',VANTA_BACKUP_ALERT_FROM:'from@example.com',VANTA_BACKUP_ALERT_TO:'to@example.com'};
  await assert.rejects(runAlertDrill({env:{...env,DATABASE_URL:'x'}}));
  const r=await runAlertDrill({env,notify:args=>sendBackupAlert({...args,fetchImpl:async(url,req)=>{assert.equal(url,'https://api.sendgrid.com/v3/mail/send');const b=JSON.parse(req.body);assert.match(b.subject,/TEST/);assert.match(b.content[0].value,/No production failure/);return {status:202}}})});
  assert.equal(r.providerAccepted,true);assert.equal(r.inboxConfirmed,false);
});

test('actual GNU tar and age capture roundtrip of local media',async()=>{
  if(process.env.VANTA_CI_MEDIA_CAPTURE!=='yes')return;
  const {execFileSync}=await import('node:child_process');
  const {readFile}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'media-age-ci-'));
  try{
    const src=join(root,'uploads'),scratch=join(root,'scratch'),target=join(root,'target'),identity=join(root,'identity'),archive=join(root,'archive.tar');
    await mkdir(src);await mkdir(scratch,{mode:0o700});await mkdir(target);
    await mkdir(join(src,'.chunks'));await writeFile(join(src,'.chunks','pending'),'ignore');
    await mkdir(join(src,'optimized'));await writeFile(join(src,'optimized','photo.webp'),'synthetic media');
    await writeFile(join(src,'-odd name'),'fixture');
    execFileSync('age-keygen',['-o',identity],{stdio:'ignore'});
    const recipient=execFileSync('age-keygen',['-y',identity]).toString().trim();
    const captured=await captureStableMedia({directory:src,scratch,limit:1024**2,recipient,producerEnv:{PATH:process.env.PATH,HOME:scratch}});
    assert.equal(captured.sourceEntries,3);
    execFileSync('age',['-d','-i',identity,'-o',archive,captured.path],{stdio:'ignore'});
    const listing=execFileSync('tar',['-tf',archive]).toString();
    assert.ok(!listing.includes('.chunks'));
    execFileSync('tar',['-xf',archive,'-C',target],{stdio:'ignore'});
    assert.equal(await readFile(join(target,'optimized','photo.webp'),'utf8'),'synthetic media');
    assert.equal(await readFile(join(target,'-odd name'),'utf8'),'fixture');
  }finally{await rm(root,{recursive:true,force:true});}
});
