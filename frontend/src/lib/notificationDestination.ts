import type { VantaNotification } from '@/context/NotificationContext';

type Target = Partial<Pick<VantaNotification, 'type' | 'data' | 'actor' | 'actorId' | 'entityType' | 'entityId'>>;
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;

export function notificationDestination(notification: Target): string | null {
  let raw: unknown = notification.data;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const entity = notification.entityType?.toLowerCase();
  const type = notification.type?.trim().toLowerCase() || '';
  if (type === 'delegation_invite' || entity === 'account_delegation') return '/settings/security/delegation';
  if (type === 'chat_request' || entity === 'chat_request') return '/chat/requests';
  const reel = id(data.reelId) || id(data.videoId) || (entity === 'reel' || entity === 'video' ? id(notification.entityId) : null);
  const post = id(data.postId) || (entity === 'post' ? id(notification.entityId) : null);
  const stream = id(data.streamId) || (entity === 'live' ? id(notification.entityId) : null);
  const conversation = id(data.conversationId) || id(data.groupId) || id(data.channelId) || (entity === 'conversation' ? id(notification.entityId) : null);
  if (reel) return '/reels/' + reel;
  if (post) return '/post/' + post + (id(data.commentId) || type === 'comment' || entity === 'comment' ? '#comments' : '');
  if (stream) return '/live/' + stream;
  if (conversation) return '/chat?conversation=' + conversation;
  if (data.transactionId || type === 'wallet' || type.startsWith('wallet_')) return '/balance/transactions';
  // Older payloads may contain the legacy Home/Reels query route instead of an entity.
  if (typeof data.destination === 'string' && /^\/(?!\/)[^\\\s]*$/.test(data.destination)) {
    const url = new URL(data.destination, 'https://vanta.invalid');
    const oldPost = url.pathname === '/home' ? id(url.searchParams.get('post')) : null;
    const oldReel = url.pathname === '/reels' ? id(url.searchParams.get('reel')) : null;
    if (oldPost) return '/post/' + oldPost + (url.searchParams.has('comment') ? '#comments' : '');
    if (oldReel) return '/reels/' + oldReel;
    if (url.pathname !== '/home' && url.pathname !== '/') return data.destination;
  }
  const actor = id(notification.actor?.username) || id(data.followerUsername) || id(notification.actorId) || id(data.actorId) || id(data.followerId) || (entity === 'profile' ? id(notification.entityId) : null);
  return actor ? '/profile/' + actor : null;
}
