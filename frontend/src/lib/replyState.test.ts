// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createReply, activeReplyFor } from './replyState';

describe('replyState conversation scoping', () => {
  const msgB = { id: 'm1', text: 'hello from Account B' };
  const msgG = { id: 'm2', text: 'group message' };

  it('returns the message only for the conversation it was created in', () => {
    const reply = createReply('convA', msgB);
    // Same conversation -> reply is active.
    expect(activeReplyFor(reply, 'convA')).toBe(msgB);
    // A different conversation -> the reply must never leak in.
    expect(activeReplyFor(reply, 'convB')).toBeNull();
    expect(activeReplyFor(reply, 'group-1')).toBeNull();
    expect(activeReplyFor(reply, 'channel-1')).toBeNull();
  });

  it('returns null when there is no active conversation', () => {
    const reply = createReply('convA', msgB);
    expect(activeReplyFor(reply, null)).toBeNull();
  });

  it('returns null for a null reply', () => {
    expect(activeReplyFor(null, 'convA')).toBeNull();
  });

  it('each conversation keeps its own independent reply', () => {
    const replyB = createReply('convA', msgB);
    const replyG = createReply('group-1', msgG);
    // Opening the group must NOT show Account B's reply.
    expect(activeReplyFor(replyB, 'group-1')).toBeNull();
    expect(activeReplyFor(replyG, 'group-1')).toBe(msgG);
    expect(activeReplyFor(replyG, 'convA')).toBeNull();
  });
});