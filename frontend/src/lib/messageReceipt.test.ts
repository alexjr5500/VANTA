// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hasVisibleReadReceipt, outgoingReceiptState, shouldRefreshReadReceipts } from './messageReceipt';

describe('chat read receipts', () => {
  it('keeps a fresh saved outgoing message at a SINGLE tick', () => {
    expect(outgoingReceiptState({ isOwn: true, pending: false, read: false })).toBe('sent');
    expect(outgoingReceiptState({ isOwn: true, pending: false })).toBe('sent');
  });
  it('uses DOUBLE ticks only after an actual read receipt', () => {
    expect(outgoingReceiptState({ isOwn: true, read: true })).toBe('read');
    expect(outgoingReceiptState({ isOwn: true, read: false })).toBe('sent');
  });
  it('does not show a sent/read tick while pending or failed', () => {
    expect(outgoingReceiptState({ isOwn: true, pending: true, read: true })).toBe('pending');
    expect(outgoingReceiptState({ isOwn: true, failed: true, read: true })).toBe('failed');
    expect(outgoingReceiptState({ isOwn: false, read: true })).toBe('none');
  });
  it('requires a DIFFERENT user in server-filtered receipt rows', () => {
    expect(hasVisibleReadReceipt({ reads: [] }, 'sender')).toBe(false);
    expect(hasVisibleReadReceipt({ reads: [{ userId: 'sender' }] }, 'sender')).toBe(false);
    expect(hasVisibleReadReceipt({ reads: [{ userId: 'recipient' }] }, 'sender')).toBe(true);
    expect(hasVisibleReadReceipt({ reads: [{ userId: 'recipient' }] })).toBe(false);
  });
  it('never overrides empty privacy-filtered receipts with a stale boolean', () => {
    expect(hasVisibleReadReceipt({ reads: [], read: true }, 'sender')).toBe(false);
    expect(hasVisibleReadReceipt({ read: false }, 'sender')).toBe(false);
    expect(hasVisibleReadReceipt({ isRead: true }, 'sender')).toBe(true);
  });
  it('ignores read events for other conversations and self-events', () => {
    const event = { conversationId: 'chat-a', readerId: 'recipient' };
    expect(shouldRefreshReadReceipts(event, 'chat-a', 'sender')).toBe(true);
    expect(shouldRefreshReadReceipts(event, 'chat-b', 'sender')).toBe(false);
    expect(shouldRefreshReadReceipts({ ...event, readerId: 'sender' }, 'chat-a', 'sender')).toBe(false);
    expect(shouldRefreshReadReceipts(event, null, 'sender')).toBe(false);
  });
});
