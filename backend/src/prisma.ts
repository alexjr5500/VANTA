import { loadEnv } from './config/env';
import { PrismaClient } from '@prisma/client';

// Deterministic .env loading (see config/env.ts). This matters because the
// backend can be launched from different working directories (repo root vs
// backend/, dist builds, etc.) and the coin-payment configuration is read
// straight from process.env at startup.
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});