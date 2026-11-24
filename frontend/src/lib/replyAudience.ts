/** Stored post/reel reply controls. Values match the backend's persisted contract. */
export const REPLY_AUDIENCE_LABELS = {
  EVERYONE: 'Everyone can reply',
  VERIFIED: 'Verified accounts can reply',
  FOLLOWING: 'Accounts you follow can reply',
  MENTIONED: 'Only mentioned accounts can reply',
  EXTENDED: 'Your follow network can reply',
} as const;

export type ReplyAudience = keyof typeof REPLY_AUDIENCE_LABELS;

export function isReplyAudience(value: unknown): value is ReplyAudience {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REPLY_AUDIENCE_LABELS, value);
}
