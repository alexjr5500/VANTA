// Disposable loopback CI service only. Actual migration files; minimal table fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const url = new URL(process.env.DATABASE_URL || '');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/vanta_queue_test');
const load = name => fs.readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8');
const first = load('20261127130000_blockchain_payment_claim');
const second = load('20261127150000_withdrawal_blockchain_claim');
const hash = ch => '0x' + ch.repeat(64);
async function main() {
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  const schema = 'withdrawal_claim_' + randomUUID().replaceAll('-', '');
  const peers = [];
  try {
    await c.query('CREATE SCHEMA "' + schema + '"');
    await c.query('SET search_path TO "' + schema + '"');
    for (const name of ['PurchaseOrder', 'VerificationPurchase']) await c.query('CREATE TABLE "' + name + '" (id text PRIMARY KEY, "providerOrderId" text, "providerReference" text, "paymentMode" text)');
    await c.query('CREATE TABLE "Withdrawal" (id text PRIMARY KEY, "transactionHash" text UNIQUE, status text NOT NULL, method text NOT NULL DEFAULT \'USDT_BEP20\')');
    await c.query(first);
    const insert = (db, id, h, status='COMPLETED') => db.query('INSERT INTO "Withdrawal" (id,"transactionHash",status) VALUES ($1,$2,$3)', [id,h,status]);
    await c.query('INSERT INTO "PurchaseOrder" VALUES ($1,$2,NULL,$3)', ['coin', 'live:'+hash('a'),'live']);
    await insert(c,'conflict',hash('A'));
    await assert.rejects(c.query(second), e => e.code === '23505');
    await c.query('ROLLBACK');
    assert.equal((await c.query('SELECT count(*)::int AS n FROM "BlockchainPaymentClaim"')).rows[0].n,1);
    await c.query('DELETE FROM "Withdrawal" WHERE id=$1',['conflict']);
    await insert(c,'historical',hash('B'));
    await c.query(second);
    assert.equal((await c.query('SELECT "transactionHash" FROM "Withdrawal" WHERE id=$1',['historical'])).rows[0].transactionHash,hash('B'));
    await assert.rejects(insert(c,'replay',hash('b')), e => e.code==='23505');
    await assert.rejects(c.query('UPDATE "Withdrawal" SET "transactionHash"=NULL WHERE id=$1',['historical']), e=>e.code==='23514');
    await c.query('DELETE FROM "Withdrawal" WHERE id=$1',['historical']);
    await assert.rejects(c.query('INSERT INTO "VerificationPurchase" VALUES ($1,$2,NULL,$3)',['badge','live:'+hash('b'),'live']),e=>e.code==='23505');
    await c.query('BEGIN');
    await insert(c,'rolled-back',hash('c'));
    await c.query('ROLLBACK');
    await insert(c,'after-rollback',hash('C'));
    assert.equal((await c.query('SELECT "transactionHash" FROM "Withdrawal" WHERE id=$1',['after-rollback'])).rows[0].transactionHash,hash('c'));
    await assert.rejects(insert(c,'invalid','legacy-ref'),e=>e.code==='23514');
    for(let i=0;i<2;i++){const p=new Client({connectionString:url.toString()});await p.connect();peers.push(p);await p.query('SET search_path TO "'+schema+'"');}
    const race=await Promise.allSettled([insert(peers[0],'race-withdrawal',hash('d')),peers[1].query('INSERT INTO "PurchaseOrder" VALUES ($1,$2,NULL,$3)',['race-coin','live:'+hash('D'),'live'])]);
    assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(race.filter(x=>x.status==='rejected'&&x.reason.code==='23505').length,1);
    console.log('Withdrawal registry migration: historical collision rollback, canonical replay, immutable evidence, retained claims, transaction rollback, invalid hash, cross-product race PASS');
  } finally {
    for(const p of peers) await p.end();
    await c.query('ROLLBACK').catch(()=>{});
    await c.query('DROP SCHEMA "'+schema+'" CASCADE');
    await c.end();
  }
}
main().catch(err=>{console.error(err.message);process.exitCode=1});
