/**
 * Migration safety + consistency tests.
 *
 * INCIDENT THESE PIN DOWN (2026-10-18, production P2022 outage)
 * --------------------------------------------------------------
 * `20261008000000_add_push_notifications` created the `CallSession` table
 * WITHOUT its `expiresAt` column and then created an index over that column:
 *
 *     CREATE INDEX "CallSession_status_expiresAt_idx" ON "CallSession"("status","expiresAt");
 *
 * which fails with 42703 `column "expiresAt" does not exist`. Because Prisma
 * runs each migration in a transaction, that migration was recorded as FAILED
 * and every migration after it - including
 * `20261014000000_account_moderation_appeals`, the one that adds
 * `User.suspendedAt/suspendedReason/suspendedUntil/bannedAt/bannedReason` -
 * never ran. The deployed API then crashed with:
 *
 *     P2022 - The column User.suspendedAt does not exist in the current database.
 *
 * The same migration also omitted `PushDelivery.type`, so the committed chain
 * diverged from `schema.prisma` even when it did apply.
 *
 * These tests are static (no database required) and assert, for every file
 * under prisma/migrations:
 *
 *   1. no UTF-8 BOM (Postgres fails with a syntax error at position 1),
 *   2. no destructive SQL (DROP/TRUNCATE/DELETE/UPDATE),
 *   3. every index created in a file only references columns that the same
 *      file actually creates - the exact defect that took production down,
 *   4. the reconciliation migration is guarded/idempotent and still contains
 *      the moderation columns the API depends on.
 */

import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');

/** Migration directories, oldest first (Prisma applies them in this order). */
function listMigrationDirs(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function readMigration(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
}

/** Remove `-- ...` line comments and block comments. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

interface ParsedTable {
  name: string;
  columns: Set<string>;
}

/** Tables created in this file, with the columns each CREATE TABLE declares. */
function parseCreatedTables(sql: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const re = /CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"\s*\(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const columns = new Set<string>();
    for (const line of m[2].split('\n')) {
      // Column definitions start with a quoted name; constraints start with
      // CONSTRAINT / PRIMARY / FOREIGN / UNIQUE / CHECK.
      const col = line.match(/^\s*"([^"]+)"\s+\S+/);
      if (col) columns.add(col[1]);
    }
    tables.push({ name: m[1], columns });
  }
  return tables;
}

/** `ALTER TABLE "X" ADD COLUMN "Y"` performed in this file. */
function parseAddedColumns(sql: string): Array<{ table: string; column: string }> {
  const out: Array<{ table: string; column: string }> = [];
  const re = /ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.push({ table: m[1], column: m[2] });
  return out;
}

interface ParsedIndex {
  name: string;
  table: string;
  columns: string[];
}

function parseIndexes(sql: string): ParsedIndex[] {
  const out: ParsedIndex[] = [];
  const re = /CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)" ON "([^"]+)"\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push({
      name: m[1],
      table: m[2],
      columns: m[3]
        .split(',')
        .map((c) => c.trim().replace(/^"|"$/g, ''))
        .filter(Boolean),
    });
  }
  return out;
}

const migrationDirs = listMigrationDirs();

describe('prisma migration files', () => {
  it('finds migrations and a PostgreSQL migration lock', () => {
    expect(migrationDirs.length).toBeGreaterThanOrEqual(8);
    expect(fs.existsSync(path.join(MIGRATIONS_DIR, 'migration_lock.toml'))).toBe(true);
    expect(fs.readFileSync(path.join(MIGRATIONS_DIR, 'migration_lock.toml'), 'utf8')).toContain(
      'provider = "postgresql"',
    );
  });

  it.each(migrationDirs)('%s has no UTF-8 BOM and is non-empty', (name) => {
    const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'));
    // UTF-8 BOM = EF BB BF. Postgres rejects it: syntax error at or near BOM.
    expect(Array.from(raw.subarray(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
    const sql = raw.toString('utf8');
    expect(sql.trim().length).toBeGreaterThan(0);
    expect(sql).toMatch(/\b(CREATE|ALTER)\b/);
  });

  it.each(migrationDirs)('%s is additive only (no destructive SQL)', (name) => {
    const sql = stripComments(readMigration(name));
    const forbidden: Array<[RegExp, string]> = [
      [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
      [/\bDROP\s+(?:UNIQUE\s+)?INDEX\b/i, 'DROP INDEX'],
      [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
      [/\bTRUNCATE\b/i, 'TRUNCATE'],
      [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
      [/^\s*UPDATE\s+"?\w+"?\s+SET\b/im, 'UPDATE ... SET'],
      [/\bALTER\s+TABLE\b[^;]*\bDROP\b/i, 'ALTER TABLE ... DROP'],
    ];
    for (const [re, label] of forbidden) {
      expect(`${name}: ${re.test(sql) ? `found ${label}` : 'clean'}`).toBe(`${name}: clean`);
    }
  });

  it.each(migrationDirs)('%s only indexes columns that the same file creates', (name) => {
    const sql = stripComments(readMigration(name));
    const created = parseCreatedTables(sql);
    const added = parseAddedColumns(sql);
    const tablesByName = new Map(created.map((t) => [t.name, t] as const));

    for (const idx of parseIndexes(sql)) {
      const table = tablesByName.get(idx.table);
      if (!table) continue; // table comes from an earlier migration - not checkable here
      for (const col of idx.columns) {
        const addedInThisFile = added.some((a) => a.table === idx.table && a.column === col);
        const ok = table.columns.has(col) || addedInThisFile;
        expect(
          `${name}: index ${idx.name} on ${idx.table}(${idx.columns.join(', ')}) -> ${col}` +
            (ok ? ' OK' : ' MISSING COLUMN'),
        ).toBe(`${name}: index ${idx.name} on ${idx.table}(${idx.columns.join(', ')}) -> ${col} OK`);
      }
    }
  });
});

describe('20261018000000_reconcile_post_baseline_drift', () => {
  const NAME = '20261018000000_reconcile_post_baseline_drift';
  const body = () => stripComments(readMigration(NAME));

  it('is present (guards the P2022 regression)', () => {
    expect(migrationDirs).toContain(NAME);
  });

  it('adds every account-moderation column the API reads', () => {
    const sql = body();
    for (const col of ['suspendedAt', 'suspendedReason', 'suspendedUntil', 'bannedAt', 'bannedReason']) {
      expect(sql).toContain(`"User" ADD COLUMN "${col}"`);
    }
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "AccountAppeal"');
  });

  it('creates tables and indexes with IF NOT EXISTS (idempotent)', () => {
    const sql = body();
    const createTables = sql.match(/CREATE TABLE [^(]*\(/g) ?? [];
    expect(createTables.length).toBeGreaterThan(0);
    for (const stmt of createTables) expect(stmt).toContain('IF NOT EXISTS');

    const createIndexes = sql.match(/CREATE (?:UNIQUE )?INDEX [^(]*\(/g) ?? [];
    expect(createIndexes.length).toBeGreaterThan(0);
    for (const stmt of createIndexes) expect(stmt).toContain('IF NOT EXISTS');
  });

  it('only adds columns from inside a guarded DO block', () => {
    // A bare `ALTER TABLE ... ADD COLUMN` fails when the column already
    // exists, which would re-break the deploy on any already-healthy DB.
    const sql = body();
    const doBlocks = (sql.match(/DO \$\$[\s\S]*?\$\$;/g) ?? []).join('\n');
    const outsideDo = sql.replace(/DO \$\$[\s\S]*?\$\$;/g, '');
    expect(outsideDo).not.toMatch(/ALTER TABLE "[^"]+" ADD COLUMN/);
    expect(doBlocks).toMatch(/ALTER TABLE "[^"]+" ADD COLUMN/);
  });

  it('creates CallSession with expiresAt and PushDelivery with type', () => {
    const sql = body();
    const callSession = (sql.match(/CREATE TABLE IF NOT EXISTS "CallSession"\s*\(([\s\S]*?)\n\);/) ?? [])[1] ?? '';
    const pushDelivery = (sql.match(/CREATE TABLE IF NOT EXISTS "PushDelivery"\s*\(([\s\S]*?)\n\);/) ?? [])[1] ?? '';
    expect(callSession).toContain('"expiresAt"');
    expect(pushDelivery).toContain('"type"');
  });
});

describe('20261008000000_add_push_notifications (the migration that broke production)', () => {
  const NAME = '20261008000000_add_push_notifications';

  it('defines CallSession.expiresAt (root cause of the P2022 outage)', () => {
    const sql = stripComments(readMigration(NAME));
    const table = (sql.match(/CREATE TABLE IF NOT EXISTS "CallSession"\s*\(([\s\S]*?)\n\);/) ?? [])[1] ?? '';
    expect(table).toContain('"expiresAt"');
  });

  it('defines PushDelivery.type (schema parity)', () => {
    const sql = stripComments(readMigration(NAME));
    const table = (sql.match(/CREATE TABLE IF NOT EXISTS "PushDelivery"\s*\(([\s\S]*?)\n\);/) ?? [])[1] ?? '';
    expect(table).toContain('"type"');
  });
});
