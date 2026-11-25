import { Client } from 'pg';

const CANDIDATES = [
  { table: 'AnalyticsEvent', key: 'createdAt', strategy: 'time_partition_first' },
  { table: 'InteractionEvent', key: 'createdAt', strategy: 'time_partition_first' },
  { table: 'ContentView', key: 'createdAt', strategy: 'time_partition_first' },
  { table: 'Notification', key: 'userId', strategy: 'user_domain_later' },
  { table: 'Message', key: 'conversationId', strategy: 'conversation_domain_later' },
  { table: 'Post', key: 'authorId', strategy: 'content_domain_later' },
  { table: 'Video', key: 'userId', strategy: 'content_domain_later' },
  { table: 'Follow', key: 'followerId', strategy: 'social_graph_later' },
  { table: 'User', key: 'id', strategy: 'keep_primary' },
  { table: 'Wallet', key: 'userId', strategy: 'keep_primary' },
  { table: 'WalletTransaction', key: 'walletId', strategy: 'keep_primary' },
] as const;

export interface CatalogRow {
  table: string;
  exists: boolean;
  estimatedRows: number | null;
  totalBytes: number | null;
  outboundFks: number;
  inboundFks: number;
  keyExists: boolean;
  uniqueIndexesWithoutKey: number;
  relationKind: string | null;
}

export interface CatalogClient {
  query: (sql: string, values: unknown[]) => Promise<{ rows: CatalogRow[] }>;
}

/** Fixed catalog allowlist; no business table scan, row data or dynamic SQL. */
export async function assessSharding(client: CatalogClient, schema = 'public') {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) throw Error('Invalid assessment schema');
  const result = await client.query(`
    WITH candidates AS (
      SELECT * FROM unnest($1::text[], $2::text[]) AS c(table_name, key_name)
    )
    SELECT c.table_name AS "table", (r.oid IS NOT NULL) AS "exists",
      CASE WHEN r.reltuples >= 0 THEN r.reltuples::float8 ELSE NULL END AS "estimatedRows",
      CASE WHEN r.oid IS NOT NULL THEN pg_total_relation_size(r.oid)::float8 ELSE NULL END AS "totalBytes",
      (SELECT count(*)::int FROM pg_constraint f WHERE f.contype='f' AND f.conrelid=r.oid) AS "outboundFks",
      (SELECT count(*)::int FROM pg_constraint f WHERE f.contype='f' AND f.confrelid=r.oid) AS "inboundFks",
      (a.attnum IS NOT NULL) AS "keyExists",
      (SELECT count(*)::int FROM pg_index i WHERE i.indrelid=r.oid AND i.indisunique
        AND (a.attnum IS NULL OR NOT EXISTS (
          SELECT 1 FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, position)
          WHERE k.attnum=a.attnum AND k.position <= i.indnkeyatts
        ))) AS "uniqueIndexesWithoutKey",
      r.relkind::text AS "relationKind"
    FROM candidates c
    LEFT JOIN pg_namespace n ON n.nspname=$3
    LEFT JOIN pg_class r ON r.relnamespace=n.oid AND r.relname=c.table_name AND r.relkind IN ('r','p')
    LEFT JOIN pg_attribute a ON a.attrelid=r.oid AND a.attname=c.key_name AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.table_name
  `, [CANDIDATES.map(x => x.table), CANDIDATES.map(x => x.key), schema]);
  if (result.rows.length !== CANDIDATES.length || new Set(result.rows.map(x => x.table)).size !== CANDIDATES.length) {
    throw Error('Incomplete catalog assessment');
  }
  return CANDIDATES.map(candidate => {
    const row = result.rows.find(x => x.table === candidate.table);
    if (!row) throw Error('Missing catalog result');
    const blockers: string[] = [];
    if (!row.exists) blockers.push('table_missing');
    else {
      if (!row.keyExists) blockers.push('candidate_key_missing');
      if (row.relationKind === 'p') blockers.push('already_partitioned_review_children');
      if (row.estimatedRows === null) blockers.push('row_estimate_unknown');
      if (row.inboundFks || row.outboundFks) blockers.push('foreign_key_dependencies');
      if (row.uniqueIndexesWithoutKey) blockers.push('unique_index_missing_candidate_key');
    }
    if (candidate.strategy === 'keep_primary') blockers.push('consistency_critical_keep_primary');
    return { ...candidate, ...row, blockers, migrationApproved: false };
  });
}

export async function runShardingAssessment(url: string, schema = 'public') {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const rows = await assessSharding(client, schema);
    await client.query('COMMIT');
    return rows;
  } finally { await client.end().catch(() => {}); }
}
