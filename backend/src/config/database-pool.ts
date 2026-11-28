/** Explicit per-process Prisma connection budget. Unset options preserve the existing URL. */
export function configureDatabasePool(url: string, env: Record<string, string | undefined>): string {
  const settings = [
    ['VANTA_DB_CONNECTION_LIMIT', 'connection_limit', 100],
    ['VANTA_DB_POOL_TIMEOUT_SECONDS', 'pool_timeout', 60],
  ] as const;
  if (settings.every(([name]) => env[name] === undefined)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid database URL for pool configuration');
  }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) throw new Error('PostgreSQL URL required for pool configuration');
  for (const [name, parameter, max] of settings) {
    const value = env[name];
    if (value === undefined) continue;
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
      throw new Error('Invalid database pool setting: ' + name);
    }
    parsed.searchParams.set(parameter, value);
  }
  return parsed.toString();
}

export interface ConnectionBudget {
  applicationReplicas: number;
  applicationPool: number;
  workerReplicas: number;
  workerPool: number;
  reservedConnections: number;
  databaseMaxConnections: number;
}

/** Admission estimate for a single primary; include all other clients in the reserve. */
export function calculateConnectionBudget(input: ConnectionBudget) {
  const values = [input.applicationReplicas, input.applicationPool, input.workerReplicas,
    input.workerPool, input.reservedConnections, input.databaseMaxConnections];
  if (values.some(v => !Number.isSafeInteger(v) || v < 0) ||
      input.applicationReplicas < 1 || input.applicationPool < 1 ||
      (input.workerReplicas > 0 && input.workerPool < 1) || input.databaseMaxConnections < 1) {
    throw new Error('Invalid connection budget');
  }
  const estimatedConnections = input.applicationReplicas * input.applicationPool +
    input.workerReplicas * input.workerPool + input.reservedConnections;
  if (!Number.isSafeInteger(estimatedConnections)) throw new Error('Connection budget overflow');
  return {
    estimatedConnections,
    remainingConnections: input.databaseMaxConnections - estimatedConnections,
    withinBudget: estimatedConnections <= input.databaseMaxConnections,
  };
}
