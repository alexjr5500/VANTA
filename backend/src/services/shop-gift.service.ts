import { prisma } from '../prisma';
import { shopSandboxEnabled } from '../config/shop-sandbox.config';

export async function resolveShopGiftRecipient(payer: string, recipient: unknown): Promise<string | null> {
  if (recipient === undefined || recipient === null) return null;
  if (!shopSandboxEnabled() || typeof recipient !== 'string' || !recipient || recipient === payer || recipient.length > 128) {
    throw new Error('Invalid or unavailable gift recipient.');
  }
  const user = await prisma.user.findFirst({ where: { id: recipient, status: 'ACTIVE' }, select: { id: true } });
  if (!user) throw new Error('Gift recipient unavailable.');
  return user.id;
}
