// Shared creator-studio types mirroring the REAL payloads returned by the
// backend creator/wallet/live endpoints. Presentation helpers only — every
// value passed in originates from existing VANTA services.

export interface CreatorStats {
  username: string;
  fullName: string | null;
  avatar: string | null;
  verified: boolean;
  role: string;
  totalFollowers: number;
  totalFollowing: number;
  totalPosts: number;
  totalReels: number;
  totalLiveSessions: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  giftsReceived: number;
  coins: number;
  earnings: number;
  earningsBalance: number;
}

export interface CreatorContentItem {
  id: string;
  type: 'post' | 'reel';
  title: string;
  mediaUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  createdAt: string;
}
