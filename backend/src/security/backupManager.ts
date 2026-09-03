import { prisma } from '../prisma';
import { auditLog } from './auditLog';
import { CryptoUtils } from './crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export class BackupManager {
  private backupDir: string;

  constructor() {
    this.backupDir = process.env.BACKUP_DIR || path.resolve(__dirname, '../../backups');
    if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });
  }

  async createDatabaseBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `db_backup_${timestamp}.sqlite`;
    const filepath = path.join(this.backupDir, filename);

    return new Promise((resolve, reject) => {
      try {
        const dbPath = process.env.DATABASE_URL?.replace('file:', '') || 'prisma/dev.db';
        if (fs.existsSync(dbPath)) {
          fs.copyFileSync(dbPath, filepath);
          const stats = fs.statSync(filepath);
          const checksum = CryptoUtils.sha256(fs.readFileSync(filepath, 'utf-8'));

          prisma.backupRecord.create({
            data: {
              type: 'DATABASE',
              status: 'COMPLETED',
              filePath: filepath,
              fileSize: stats.size,
              checksum,
              startedAt: new Date(timestamp),
              completedAt: new Date(),
            },
          }).catch(() => {});

          resolve(filepath);
        } else {
          reject(new Error('Database file not found'));
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async verifyBackup(backupId: string): Promise<boolean> {
    const record = await prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!record || !record.filePath) return false;
    if (!fs.existsSync(record.filePath)) return false;
    const currentChecksum = CryptoUtils.sha256(fs.readFileSync(record.filePath, 'utf-8'));
    return currentChecksum === record.checksum;
  }

  async cleanupOldBackups(retentionDays?: number): Promise<number> {
    const days = retentionDays || 30;
    const cutoff = new Date(Date.now() - days * 86400000);
    const old = await prisma.backupRecord.findMany({
      where: { createdAt: { lt: cutoff } },
    });
    for (const record of old) {
      if (record.filePath && fs.existsSync(record.filePath)) {
        fs.unlinkSync(record.filePath);
      }
    }
    const result = await prisma.backupRecord.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }

  async getBackupStatus(): Promise<{ lastBackup: Date | null; totalBackups: number; totalSize: number }> {
    const lastBackup = await prisma.backupRecord.findFirst({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
    const allBackups = await prisma.backupRecord.findMany({
      where: { status: 'COMPLETED' },
    });
    const totalSize = allBackups.reduce((sum, b) => sum + (b.fileSize || 0), 0);
    return {
      lastBackup: lastBackup?.completedAt || null,
      totalBackups: allBackups.length,
      totalSize,
    };
  }
}

export const backupManager = new BackupManager();