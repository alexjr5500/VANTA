import { createHash } from 'node:crypto';

/** Preserve invalidation prefixes while hashing untrusted cursor/seed and page size. */
export function feedPageKey(prefix: string, cursor: string | undefined, limit: number, seed?: string): string {
  return prefix + ':page:' + createHash('sha256').update(JSON.stringify([cursor ?? null, limit, seed ?? null])).digest('hex');
}

/** Return the last delivered row as cursor, not the discarded lookahead. */
export function finishCursorPage<T extends { id: string }>(rows: T[], limit: number): string | undefined {
  if (rows.length <= limit) return undefined;
  rows.length = limit;
  return rows[limit - 1]?.id;
}

type Queries = readonly (() => Promise<unknown>)[];
type Results<T extends Queries> = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };

/** Bounded parallelism: no later batch starts until every earlier read settles. */
export async function runFeedQueries<T extends Queries>(queries: T): Promise<Results<T>> {
  const results: unknown[] = [];
  for (let offset = 0; offset < queries.length; offset += 3) {
    const batch = await Promise.allSettled(queries.slice(offset, offset + 3).map(fn => Promise.resolve().then(fn)));
    for (const result of batch) {
      if (result.status === 'rejected') throw result.reason;
      results.push(result.value);
    }
  }
  return results as Results<T>;
}
