import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,randomUUID,sign} from 'node:crypto';
import {verifyDailyPermit,checkDailySlot,utcDay} from './backup-daily-window.mjs';
const nowMs=100*86400000+1800000, runId=randomUUID(),revision='a'.repeat(40);
const k=generateKeyPairSync('ed25519'),publicKey=k.publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(k.publicKey.export({type:'spki',format:'der'})).digest('hex');
const data={version:1,scope:'production',runId,revision,utcDay:utcDay(nowMs),notBeforeMs:nowMs-1000,expiresAtMs:nowMs+1000};
const signed=p=>({data:p,signature:sign(null,Buffer.from(JSON.stringify(p)),k.privateKey).toString('base64')});
const inputs={publicKey,fingerprint,writerFingerprint:'b'.repeat(64),runId,revision,nowMs};
test('daily permit binds exact revision and run; expired or altered permit rejected',()=>{
  const permit=verifyDailyPermit({...inputs,envelope:signed(data)});
  assert.equal(checkDailySlot({permit,previous:null,nowMs}),true);
  assert.throws(()=>verifyDailyPermit({...inputs,envelope:signed(data),runId:randomUUID()}));
  assert.throws(()=>verifyDailyPermit({...inputs,envelope:signed(data),nowMs:nowMs+1000}));
  assert.throws(()=>verifyDailyPermit({...inputs,envelope:signed({...data,expiresAtMs:nowMs+7200000})}));
  assert.throws(()=>verifyDailyPermit({...inputs,envelope:signed(data),writerFingerprint:fingerprint}));
  assert.throws(()=>verifyDailyPermit({...inputs,envelope:{...signed(data),data:{...data,revision:'c'.repeat(40)}}}));
});
test('durable journal blocks same-day repeat or unresolved previous attempt',()=>{
  assert.throws(()=>checkDailySlot({permit:data,previous:{state:'transfer_verified',startedAtMs:nowMs-10000},nowMs}));
  assert.throws(()=>checkDailySlot({permit:data,previous:{state:'failed',startedAtMs:nowMs-86400000},nowMs}));
  assert.equal(checkDailySlot({permit:data,previous:{state:'transfer_verified',startedAtMs:nowMs-86400000},nowMs}),true);
});
