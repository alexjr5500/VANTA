import { prisma } from "../prisma";

export class MatchService {
  /**
   * Discover profiles for a user based on their interests and preferences
   */
  async discover(userId: string, limit: number = 10) {
    try {
      // Get the current user's profile to find their interests
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          interests: true,
          city: true,
          country: true,
        },
      });

      if (!currentUser) {
        return [];
      }

      // Build discovery query - find users with similar interests or location
      const interests = currentUser.interests || [];
      const whereClause: any = {
        id: { not: userId },
        isActive: true,
      };

      // If user has interests, find users with matching interests
      if (interests.length > 0) {
        whereClause.interests = {
          hasSome: interests,
        };
      }

      const profiles = await prisma.user.findMany({
        where: whereClause,
        take: limit,
        orderBy: [
          { lastActive: 'desc' },
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          username: true,
          fullName: true,
          avatar: true,
          bio: true,
          verified: true,
          city: true,
          country: true,
          age: true,
          interests: true,
          photos: true,
          lastActive: true,
          createdAt: true,
          _count: {
            select: {
              followers: true,
              following: true,
            },
          },
          followers: {
            where: { followerId: userId },
            select: { id: true },
            take: 1,
          },
        },
      });

      return profiles.map(({ followers, ...profile }) => ({
        ...profile,
        following: followers.length > 0,
        isFollowing: followers.length > 0,
      }));
    } catch (error) {
      console.error('[MatchService] Error discovering profiles:', error);
      return [];
    }
  }
}

export const matchService = new MatchService();