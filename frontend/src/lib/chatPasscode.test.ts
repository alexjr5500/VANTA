import { describe, expect, it } from 'vitest';
import { chatLockKey, parseChatLock, validChatPin } from './chatPasscode';

describe('device chat lock records', () => {
  it('requires exactly six ASCII digits', () => {
    expect(validChatPin('012345')).toBe(true);
    for (const value of ['', '12345', '1234567', '1234ab', '１２３４５６']) expect(validChatPin(value)).toBe(false);
  });
  it('scopes lock storage to the signed-in account', () => {
    expect(chatLockKey('first')).not.toBe(chatLockKey('second'));
  });
  it('fails closed for corrupt or unknown versions', () => {
    expect(parseChatLock(null)).toBeNull();
    for (const value of ['{}', 'null', 'broken', '{"version":2}']) expect(() => parseChatLock(value)).toThrow();
    const record = { version: 1, salt: 'a'.repeat(32), digest: 'b'.repeat(64), failures: 0, retryAt: 0 };
    expect(parseChatLock(JSON.stringify(record))).toEqual(record);
    expect(() => parseChatLock(JSON.stringify({...record, failures: 99}))).toThrow();
  });
});
