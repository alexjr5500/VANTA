// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isReplyAudience, REPLY_AUDIENCE_LABELS } from './replyAudience';

describe('post reply audience options', () => {
  it('exposes all five supported choices', () => {
    expect(Object.keys(REPLY_AUDIENCE_LABELS)).toEqual([
      'EVERYONE', 'VERIFIED', 'FOLLOWING', 'MENTIONED', 'EXTENDED',
    ]);
  });

  it('rejects unknown or malformed draft selections', () => {
    expect(isReplyAudience('FOLLOWING')).toBe(true);
    expect(isReplyAudience('EVERYONE')).toBe(true);
    expect(isReplyAudience('UNKNOWN')).toBe(false);
    expect(isReplyAudience(null)).toBe(false);
    expect(isReplyAudience({})).toBe(false);
  });
});
