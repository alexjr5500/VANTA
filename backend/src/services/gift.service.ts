import { prisma } from '../prisma';
import { walletService } from './wallet.service';
import { notificationService } from './notification.service';
import { emitSocialEvent, emitSocialEventToRoom, emitSocialEventToUser } from './social-events.service';
import { initialGiftCatalog } from '../data/gift-catalog.data';
import type { GiftTransaction, Wallet } from '@prisma/client';
import { calculateGiftRecipientCoins } from '../config/wallet.config';

export type GiftCatalogInput = {
  slug?: string;
  name?: string;
  price?: number;
  icon?: string | null;
  image?: string | null;
  emoji?: string | null;
  category?: string;
  subcategory?: string | null;
  description?: string | null;
  animationUrl?: string | null;
  animationType?: string;
  thumbnailUrl?: string | null;
  glowColor?: string | null;
  particleColor?: string | null;
  soundEffect?: string | null;
  isActive?: boolean;
  isFeatured?: boolean;
  isTrending?: boolean;
  isPopular?: boolean;
  isLimited?: boolean;
  isLegendary?: boolean;
  expiresAt?: Date | null;
  sortOrder?: number;
  comboEnabled?: boolean;
  comboMultiplier?: number;
  animationDuration?: number;
  artworkType?: string;
  rarity?: string;
  tier?: string;
  impactLevel?: number;
  effectProfile?: string;
  previewAssetUrl?: string | null;
};

async function getUserDisplayInfo(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, fullName: true, avatar: true },
  });
  if (!user) return { id: userId, username: "unknown", displayName: "Unknown User", avatar: null };
  return {
    id: user.id,
    username: user.username,
    displayName: user.fullName || user.username,
    avatar: user.avatar,
  };
}

function formatUserLabel(user: { username: string; displayName: string }): string {
  if (user.displayName && user.displayName !== user.username) {
    return `${user.displayName} (@${user.username})`;
  }
  return `@${user.username}`;
}

export class GiftService {
  private catalogSync: Promise<void> | null = null;

  /**
   * Keep the database-backed catalog aligned with the canonical VANTA
   * catalog. This is deliberately an upsert (not a frontend fallback), so
   * transactions, admin tools, history and every picker continue to reference
   * the same Gift records. It also upgrades older deployments that only have
   * the original 13 rows without requiring a destructive reseed.
   */
  private async ensureCanonicalCatalog() {
    if (!this.catalogSync) {
      this.catalogSync = (async () => {
        const activeCount = await prisma.gift.count({ where: { isActive: true } });
        if (activeCount >= initialGiftCatalog.length) return;
        await prisma.$transaction(initialGiftCatalog.map((gift, index) => prisma.gift.upsert({
          where: { slug: gift.slug },
          create: { id: `gift_${gift.slug.replace(/-/g, '_')}`, ...gift, sortOrder: index + 1, isActive: true },
          update: { ...gift, sortOrder: index + 1, isActive: true },
        })));
      })().catch(error => {
        this.catalogSync = null;
        throw error;
      });
    }
    await this.catalogSync;
  }

  private announceCatalogChange(action: 'created' | 'updated' | 'deleted', giftId: string) {
    emitSocialEvent('gift:catalog-updated', { action, giftId, updatedAt: new Date().toISOString() });
  }

  async listGifts(search?: string, category?: string) {
    await this.ensureCanonicalCatalog();
    return prisma.gift.findMany({
      where: {
        isActive: true,
        ...(search ? { OR: [{ name: { contains: search } }, { slug: { contains: search } }, { description: { contains: search } }] } : {}),
        ...(category && category !== 'all' ? { category } : {}),
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async listAllGifts() {
    return prisma.gift.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async createGift(input: GiftCatalogInput & { slug: string; name: string; price: number }) {
    const gift = await prisma.gift.create({ data: input });
    this.announceCatalogChange('created', gift.id);
    return gift;
  }

  async updateGift(giftId: string, input: GiftCatalogInput) {
    const gift = await prisma.gift.update({ where: { id: giftId }, data: input });
    this.announceCatalogChange('updated', gift.id);
    return gift;
  }

  async toggleGift(giftId: string) {
    const current = await prisma.gift.findUnique({ where: { id: giftId }, select: { isActive: true } });
    if (!current) throw new Error('Gift not found');
    return this.updateGift(giftId, { isActive: !current.isActive });
  }

  async deleteGift(giftId: string) {
    const transactionCount = await prisma.giftTransaction.count({ where: { giftId } });
    if (transactionCount > 0) {
      const gift = await this.updateGift(giftId, { isActive: false });
      return { gift, deleted: false, archived: true };
    }
    const gift = await prisma.gift.delete({ where: { id: giftId } });
    this.announceCatalogChange('deleted', gift.id);
    return { gift, deleted: true, archived: false };
  }

  async validateWallet(userId: string, amount: number) {
    const wallet = await walletService.ensureWallet(userId);
    const availableBalance = Math.max(0, wallet.coinBalance - wallet.lockedCoins);
    return {
      valid: !wallet.isFrozen && availableBalance >= amount,
      balance: wallet.coinBalance,
      availableBalance,
      required: amount,
      shortfall: Math.max(0, amount - availableBalance),
      isFrozen: wallet.isFrozen,
    };
  }

  async sendGift(senderId: string, receiverId: string, giftId: string, streamId?: string, options: { quantity?: number; message?: string; isAnon?: boolean; requestId?: string } = {}) {
    const gift = await prisma.gift.findUnique({ where: { id: giftId } });
    if (!gift) throw new Error('Gift not found');
    if (!gift.isActive) throw new Error('This gift is no longer available');

    if (options.requestId) {
      const existing = await prisma.giftTransaction.findUnique({ where: { requestId: options.requestId } });
      if (existing) {
        if (existing.senderId !== senderId || existing.receiverId !== receiverId || existing.giftId !== giftId) {
          throw new Error('Gift request key is already in use');
        }
        const currentWallet = await walletService.ensureWallet(senderId);
        return {
          transaction: existing,
          remainingBalance: currentWallet.coinBalance,
          amount: existing.amount,
          coins: existing.amount,
          quantity: existing.quantity,
          gift,
          replayed: true,
        };
      }
    }

    if (senderId === receiverId) {
      throw new Error('Cannot send a gift to yourself');
    }

    if (streamId) {
      const stream = await prisma.liveStream.findUnique({
        where: { id: streamId },
        select: { hostId: true, active: true, status: true, allowGifts: true },
      });
      if (!stream?.active || stream.status !== 'LIVE') throw new Error('Stream is not live');
      if (!stream.allowGifts) throw new Error('Gifts are disabled for this stream');
      if (stream.hostId !== receiverId) throw new Error('Invalid gift recipient');
    }

    // Ensure both wallets exist
    const senderWallet = await walletService.ensureWallet(senderId);
    const receiverWallet = await walletService.ensureWallet(receiverId);

    if (senderWallet.isFrozen) {
      throw new Error('Your wallet is frozen. Contact support.');
    }
    if (receiverWallet.isFrozen) {
      throw new Error("Recipient's wallet is frozen.");
    }

    const quantity = Math.min(99, Math.max(1, Math.trunc(options.quantity || 1)));
    const totalCost = gift.price * quantity;
    const message = options.message?.trim().slice(0, 280) || null;

    // Check balance
    const availableBalance = Math.max(0, senderWallet.coinBalance - senderWallet.lockedCoins);
    if (availableBalance < totalCost) {
      throw new Error(
        `Insufficient coins. You have ${availableBalance.toLocaleString()} available but need ${totalCost.toLocaleString()}.`
      );
    }

    // Resolve user display info for descriptions
    const [senderInfo, receiverInfo] = await Promise.all([
      getUserDisplayInfo(senderId),
      getUserDisplayInfo(receiverId),
    ]);
    const senderLabel = formatUserLabel(senderInfo);
    const receiverLabel = formatUserLabel(receiverInfo);

    // Gifts auto-convert to spendable VANTA Coins. The server is the only
    // authority for this 70% share and always rounds down to whole coins.
    const recipientCoins = calculateGiftRecipientCoins(totalCost);
    const platformCoins = totalCost - recipientCoins;

    // Execute gift atomically
    let result: { transaction: GiftTransaction; updatedSender: Wallet; updatedReceiver: Wallet };
    try {
      result = await prisma.$transaction(async (tx) => {
        // Compare-and-swap against the balance read inside this transaction so
        // concurrent sends cannot spend the same coins or consume locked coins.
        const currentSender = await tx.wallet.findUniqueOrThrow({ where: { userId: senderId } });
        if (currentSender.isFrozen || currentSender.coinBalance - currentSender.lockedCoins < totalCost) {
          throw new Error('Insufficient available coins');
        }
        const deduction = await tx.wallet.updateMany({
          where: { id: currentSender.id, isFrozen: false, coinBalance: currentSender.coinBalance },
          data: {
            coinBalance: { decrement: totalCost },
            totalCoinsSent: { increment: totalCost },
            totalGiftsSent: { increment: quantity },
          },
        });
        if (deduction.count !== 1) {
          throw new Error('Insufficient coins');
        }
        const updatedSender = await tx.wallet.findUniqueOrThrow({ where: { userId: senderId } });

      // Auto-convert the gift into spendable coins for the receiver.
      const updatedReceiver = await tx.wallet.update({
        where: { userId: receiverId },
        data: {
          coinBalance: { increment: recipientCoins },
          totalCoinsReceived: { increment: recipientCoins },
          lifetimeEarnings: { increment: recipientCoins },
          totalGiftsReceived: { increment: quantity },
        },
      });

      // Record gift transaction
      const transaction = await tx.giftTransaction.create({
        data: {
          requestId: options.requestId,
          senderId,
          receiverId,
          giftId,
          streamId,
          amount: totalCost,
          quantity,
          message,
          isAnon: Boolean(options.isAnon),
        },
      });

      if (streamId) {
        await tx.liveGiftEvent.create({
          data: {
            streamId,
            senderId,
            receiverId,
            giftId,
            giftName: gift.name,
            giftEmoji: gift.emoji,
            amount: totalCost,
            comboCount: quantity,
            isAnon: Boolean(options.isAnon),
            senderName: options.isAnon ? null : senderInfo.username,
          },
        });
        await tx.liveStream.update({
          where: { id: streamId },
          data: { gifts: { increment: totalCost } },
        });
      }

      const analyticsDate = new Date();
      analyticsDate.setUTCHours(0, 0, 0, 0);
      await tx.creatorDailyAnalytics.upsert({
        where: { creatorId_date: { creatorId: receiverId, date: analyticsDate } },
        create: { creatorId: receiverId, date: analyticsDate, giftRevenue: recipientCoins, totalEarnings: recipientCoins },
        update: { giftRevenue: { increment: recipientCoins }, totalEarnings: { increment: recipientCoins } },
      });
      await tx.analyticsEvent.create({
        data: {
          eventType: 'GIFT_SENT',
          userId: senderId,
          targetType: streamId ? 'LIVE_STREAM' : 'CREATOR',
          targetId: streamId || receiverId,
          value: totalCost,
          metadata: JSON.stringify({ receiverId, giftId, quantity, recipientCoins, platformCoins, autoConverted: true, isAnon: Boolean(options.isAnon) }),
        },
      });

      // Record wallet transaction for sender (outgoing - GIFT_SENT)
      await tx.walletTransaction.create({
        data: {
          walletId: senderWallet.id,
          userId: senderId,
          type: 'GIFT_SENT',
          amount: totalCost,
          fee: 0,
          balance: updatedSender.coinBalance,
          status: 'COMPLETED',
          description: `Sent ${gift.name} gift to ${receiverLabel}`,
          reference: transaction.id,
          metadata: JSON.stringify({ giftId: gift.id, giftName: gift.name, receiverId, amount: totalCost, quantity, message, isAnon: Boolean(options.isAnon) }),
        },
      });

      // Record wallet transaction for receiver (incoming - GIFT_RECEIVED)
      await tx.walletTransaction.create({
        data: {
          walletId: updatedReceiver.id,
          userId: receiverId,
          type: 'GIFT_RECEIVED',
          amount: recipientCoins,
          fee: platformCoins,
          balance: updatedReceiver.coinBalance,
          status: 'COMPLETED',
          description: `Received ${gift.name}; automatically converted to ${recipientCoins} VANTA Coins`,
          reference: transaction.id,
          metadata: JSON.stringify({ giftId: gift.id, giftName: gift.name, senderId, giftCoinValue: totalCost, recipientCoins, platformCoins, autoConverted: true, quantity, message, isAnon: Boolean(options.isAnon) }),
        },
      });

        return { transaction, updatedSender, updatedReceiver };
      });
    } catch (error) {
      // Two concurrent requests can both miss the preflight lookup. The unique
      // request key makes one transaction win; replay the committed winner
      // without charging or emitting a second gift event.
      const prismaError = error as { code?: string };
      if (options.requestId && prismaError.code === 'P2002') {
        const existing = await prisma.giftTransaction.findUnique({ where: { requestId: options.requestId } });
        if (existing && existing.senderId === senderId && existing.receiverId === receiverId && existing.giftId === giftId) {
          const currentWallet = await walletService.ensureWallet(senderId);
          return {
            transaction: existing,
            remainingBalance: currentWallet.coinBalance,
            amount: existing.amount,
            coins: existing.amount,
            quantity: existing.quantity,
            gift,
            replayed: true,
          };
        }
      }
      throw error;
    }

    // A notification delivery failure must not turn a committed transfer into
    // an API error. Socket delivery and preferences are handled by the service.
    await Promise.allSettled([
      notificationService.createNotification(
        receiverId,
        'gift',
        'Gift received',
        `${options.isAnon ? 'Someone' : senderInfo.username} sent you a ${gift.name}.`,
        { actorId: options.isAnon ? undefined : senderId, transactionId: result.transaction.id, giftId, senderId, streamId, amount: totalCost, quantity, isAnon: Boolean(options.isAnon), entityType: "giftTransaction", entityId: result.transaction.id, referenceKey: `gift-received:${result.transaction.id}` },
      ),
      notificationService.createNotification(
        senderId,
        'gift',
        'Gift sent',
        `You successfully sent a ${gift.name}.`,
        { transactionId: result.transaction.id, giftId, receiverId, streamId, amount: totalCost, quantity, entityType: "giftTransaction", entityId: result.transaction.id, referenceKey: `gift-sent:${result.transaction.id}` },
      ),
    ]);
    emitSocialEventToUser(senderId, 'social:wallet-updated', { coinBalance: result.updatedSender.coinBalance, transaction: result.transaction });
    emitSocialEventToUser(receiverId, 'social:wallet-updated', { coinBalance: result.updatedReceiver.coinBalance, recipientCoins, autoConverted: true, transaction: result.transaction });
    if (streamId) {
      // Keep realtime payloads compatible with deployments whose generated
      // Prisma client is regenerated separately from the application build.
      const premiumGift = gift as typeof gift & {
        artworkType?: string;
        rarity?: string;
        tier?: string;
        impactLevel?: number;
        effectProfile?: string;
      };
      emitSocialEventToRoom(`stream_${streamId}`, 'gift_received', {
        streamId,
        transaction: {
          ...result.transaction,
          giftName: gift.name,
           giftSlug: gift.slug,
           thumbnailUrl: gift.thumbnailUrl,
          animationUrl: gift.animationUrl,
           animationType: gift.animationType,
          glowColor: gift.glowColor,
           particleColor: gift.particleColor,
          animationDuration: gift.animationDuration,
           isLegendary: gift.isLegendary,
          artworkType: premiumGift.artworkType,
          rarity: premiumGift.rarity,
          tier: premiumGift.tier,
          impactLevel: premiumGift.impactLevel,
          effectProfile: premiumGift.effectProfile,
          senderName: options.isAnon ? 'Anonymous' : senderInfo.username,
        },
      });
    }

    return {
      transaction: result.transaction,
      remainingBalance: result.updatedSender.coinBalance,
      amount: totalCost,
      coins: totalCost,
      quantity,
      recipientCoins,
      platformCoins,
      autoConverted: true,
      sender: senderInfo,
      gift,
    };
  }

  async getGiftHistory(userId: string, limit = 50) {
    const transactions = await prisma.giftTransaction.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: { select: { id: true, username: true, fullName: true, avatar: true } },
        receiver: { select: { id: true, username: true, fullName: true, avatar: true } },
        gift: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return transactions.map((tx) => ({
      ...tx,
      sender: tx.isAnon && tx.receiverId === userId ? null : tx.sender,
      isIncoming: tx.receiverId === userId,
      isOutgoing: tx.senderId === userId,
    }));
  }
}

export const giftService = new GiftService();