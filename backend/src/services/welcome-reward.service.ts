import { prisma } from "../prisma";

export class WelcomeRewardService {
  private readonly REWARD_COINS = 100;

  async claimWelcomeReward(userId: string) {
    const existing = await prisma.welcomeReward.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new Error("Welcome reward already claimed");
    }

    // Use transaction to atomically create reward, coin transaction, and update wallet
    const [reward] = await prisma.$transaction([
      prisma.welcomeReward.create({
        data: {
          userId,
          coins: this.REWARD_COINS,
        },
      }),
      prisma.coinTransaction.create({
        data: {
          userId,
          type: "WELCOME_REWARD",
          amount: this.REWARD_COINS,
          balance: this.REWARD_COINS,
          description: "Welcome reward - 100 VANTA Coins",
        },
      }),
      prisma.wallet.update({
        where: { userId },
        data: {
          coinBalance: { increment: this.REWARD_COINS },
        },
      }),
    ]);

    return reward;
  }

  async hasClaimedWelcomeReward(userId: string) {
    const reward = await prisma.welcomeReward.findUnique({
      where: { userId },
    });
    return !!reward;
  }

  async getWelcomeRewardStatus(userId: string) {
    const reward = await prisma.welcomeReward.findUnique({
      where: { userId },
    });

    return {
      claimed: !!reward,
      coins: reward?.coins || this.REWARD_COINS,
      claimedAt: reward?.claimedAt || null,
    };
  }

  async getWelcomeRewardStats() {
    const [totalIssued, totalCoins] = await Promise.all([
      prisma.welcomeReward.count(),
      prisma.coinTransaction.aggregate({
        where: { type: "WELCOME_REWARD" },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalRewardsIssued: totalIssued,
      totalCoinsDistributed: totalCoins._sum.amount || 0,
    };
  }
}

export const welcomeRewardService = new WelcomeRewardService();