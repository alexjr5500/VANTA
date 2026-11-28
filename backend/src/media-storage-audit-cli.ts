import { PrismaClient } from '@prisma/client';
import { auditMediaStorage } from './services/media-storage-audit';

async function main(): Promise<void> {
  // Separate credentials; never implicitly fall back to the application's DATABASE_URL.
  const url = process.env.VANTA_STORAGE_AUDIT_DATABASE_URL;
  const root = process.env.VANTA_STORAGE_AUDIT_ROOT;
  if (process.env.VANTA_STAGING_STORAGE_AUDIT !== 'yes' || !url || !root ||
      (process.env.DATABASE_URL && url === process.env.DATABASE_URL)) {
    throw new Error('Explicit isolated audit database and storage configuration required');
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const result = await auditMediaStorage(root, (after, take) => db.uploadedFile.findMany({
      where: { deletedAt: null, ...(after === null ? {} : { id: { gt: after } }) },
      orderBy: { id: 'asc' },
      select: { id: true, filename: true, path: true, size: true },
      take,
    }));
    console.info('[StorageAudit]', JSON.stringify(result));
    if (result.status !== 'ok') process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

void main().catch(() => {
  console.error('[StorageAudit] Unavailable: isolated configuration, database or storage check failed');
  process.exitCode = 2;
});
