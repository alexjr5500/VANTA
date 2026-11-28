import { createHash, createPublicKey, verify } from 'node:crypto';
import { backupPrefix } from './backup-r2-multipart.mjs';
const check=(v,m='Daily capture authorization rejected')=>{if(!v)throw Error(m)};
const dayMs=86400000;
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export const utcDay=now=>Math.floor(now/dayMs);
// A scheduled maintenance run needs a short-lived independently signed permit
// for this exact run, revision and UTC day. It is not proof of source fencing.
export function verifyDailyPermit({envelope,publicKey,fingerprint,writerFingerprint,runId,revision,nowMs}){
  check(safe(nowMs)&&hex(fingerprint)&&hex(writerFingerprint)&&fingerprint!==writerFingerprint);
  backupPrefix('production',runId);check(/^[a-f0-9]{40}$/.test(revision));
  const key=createPublicKey(publicKey);
  check(key.asymmetricKeyType==='ed25519'&&createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')===fingerprint);
  check(envelope&&Object.keys(envelope).length===2&&typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature));
  const p=envelope.data;
  check(p&&Object.keys(p).length===7&&p.version===1&&p.scope==='production'&&p.runId===runId&&p.revision===revision&&
    p.utcDay===utcDay(nowMs)&&safe(p.notBeforeMs)&&safe(p.expiresAtMs)&&p.notBeforeMs<=nowMs&&nowMs<p.expiresAtMs&&
    p.expiresAtMs-p.notBeforeMs<=3600000&&utcDay(p.notBeforeMs)===p.utcDay&&utcDay(p.expiresAtMs-1)===p.utcDay);
  check(verify(null,Buffer.from(JSON.stringify(p)),key,Buffer.from(envelope.signature,'base64')));
  return p;
}
// Must execute while the existing durable writer lease is held, before
// journaling or source access. Never override unfinished attempts.
export function checkDailySlot({permit,previous,nowMs}){
  check(permit&&safe(nowMs)&&permit.utcDay===utcDay(nowMs)&&nowMs>=permit.notBeforeMs&&nowMs<permit.expiresAtMs);
  if(previous){
    check(previous.state==='transfer_verified'&&safe(previous.startedAtMs)&&previous.startedAtMs<=nowMs);
    check(utcDay(previous.startedAtMs)<permit.utcDay,'Daily capture already attempted');
  }
  return true;
}
