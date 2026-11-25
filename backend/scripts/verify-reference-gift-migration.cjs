// Runs only against the disposable loopback CI PostgreSQL service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { initialGiftCatalog } = require('../prisma/gift-catalog.data.js');
const url = new URL(process.env.DATABASE_URL || '');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/vanta_queue_test');
const migrations = path.join(__dirname, '../prisma/migrations');
const baseline = fs.readFileSync(path.join(migrations, '20261005000000_baseline_production_schema/migration.sql'), 'utf8');
const migration = fs.readFileSync(path.join(migrations, '20261125180000_approved_reference_gifts/migration.sql'), 'utf8');
function statement(prefix) {
  const start = baseline.indexOf(prefix);
  assert.ok(start >= 0, 'Baseline statement missing: ' + prefix);
  return baseline.slice(start, baseline.indexOf(';', start) + 1);
}
async function main() {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const schema = 'gift_acceptance_' + randomUUID().replaceAll('-', '');
  try {
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET search_path TO "' + schema + '"');
    for (const prefix of [
      'CREATE TABLE IF NOT EXISTS "Gift" (',
      'CREATE TABLE IF NOT EXISTS "GiftTransaction" (',
      'CREATE UNIQUE INDEX IF NOT EXISTS "Gift_slug_key"',
      'ALTER TABLE "GiftTransaction" ADD CONSTRAINT "GiftTransaction_giftId_fkey"',
    ]) await client.query(statement(prefix));
    await client.query(`INSERT INTO "Gift" ("id","slug","name","price","updatedAt") VALUES
      ('existing-rose','rose','Rose',25,NOW()),
      ('legacy-fire','fire','This Is Fire',10,NOW())`);
    await client.query(`INSERT INTO "GiftTransaction" ("id","senderId","receiverId","giftId","amount") VALUES
      ('history-rose','synthetic-sender','synthetic-receiver','existing-rose',25),
      ('history-fire','synthetic-sender','synthetic-receiver','legacy-fire',10)`);
    const before = (await client.query('SELECT * FROM "GiftTransaction" ORDER BY id')).rows;
    for (let run = 0; run < 2; run++) {
      await client.query(migration);
      const active = (await client.query('SELECT * FROM "Gift" WHERE "isActive" ORDER BY "sortOrder"')).rows;
      assert.equal(active.length, 70);
      assert.equal(initialGiftCatalog.length, 70);
      assert.equal(new Set(active.map(g => g.slug)).size, 70);
      for (const [i, expected] of initialGiftCatalog.entries()) {
        const actual = active[i];
        for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, expected.slug + '.' + key);
      }
      assert.equal(active.find(g => g.slug === 'rose').id, 'existing-rose');
      const retired = (await client.query('SELECT id, "isActive" FROM "Gift" WHERE slug = $1', ['fire'])).rows[0];
      assert.deepEqual(retired, { id: 'legacy-fire', isActive: false });
      assert.deepEqual((await client.query('SELECT * FROM "GiftTransaction" ORDER BY id')).rows, before);
    }
    console.log('PASS: 70 catalog rows match the canonical runtime, existing gift IDs and historical amounts preserved; migration replay is idempotent.');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
