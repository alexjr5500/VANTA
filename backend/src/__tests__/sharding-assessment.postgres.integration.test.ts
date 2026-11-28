import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { assessSharding } from '../services/sharding-assessment';

const url = process.env.VANTA_CI_SHARDING_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('sharding catalog assessment on disposable PostgreSQL', () => {
  const schema = 'sharding_ci_' + randomUUID().replace(/-/g, '');
  let db: Client;
  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query('CREATE SCHEMA "' + schema + '"');
    await db.query('SET search_path TO "' + schema + '"');
    await db.query('CREATE TABLE "User" (id text PRIMARY KEY)');
    await db.query('CREATE TABLE "Wallet" (id text PRIMARY KEY, "userId" text UNIQUE REFERENCES "User"(id))');
    await db.query('CREATE TABLE "AnalyticsEvent" (id text PRIMARY KEY, "createdAt" timestamp NOT NULL)');
    await db.query('CREATE UNIQUE INDEX event_cover ON "AnalyticsEvent"(id) INCLUDE ("createdAt")');
    await db.query('CREATE TABLE "Message" (id text, "conversationId" text, PRIMARY KEY (id, "conversationId"))');
    await db.query('ANALYZE');
  });
  afterAll(async () => {
    if (!db) return;
    try { await db.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); }
    finally { await db.end(); }
  });
  it('reports missing keys and tables, actual FK constraints and uniqueness blockers without reading user rows', async () => {
    await db.query('BEGIN READ ONLY');
    try {
      const rows = await assessSharding(db, schema);
      const by = (table: string) => rows.find(x => x.table === table)!;
      expect(by('User')).toMatchObject({ inboundFks: 1, keyExists: true, migrationApproved: false });
      expect(by('Wallet')).toMatchObject({ outboundFks: 1, uniqueIndexesWithoutKey: 1 });
      expect(by('Wallet').blockers).toContain('consistency_critical_keep_primary');
      expect(by('AnalyticsEvent')).toMatchObject({ keyExists: true, uniqueIndexesWithoutKey: 2 });
      expect(by('Message')).toMatchObject({ keyExists: true, uniqueIndexesWithoutKey: 0 });
      expect(by('Post')).toMatchObject({ exists: false, totalBytes: null });
      expect(rows.every(r => !r.migrationApproved)).toBe(true);
    } finally { await db.query('ROLLBACK'); }
  });
  it('rejects invalid schema identifiers before querying', async () => {
    await expect(assessSharding(db, 'public;DROP')).rejects.toThrow('Invalid assessment schema');
  });
});
