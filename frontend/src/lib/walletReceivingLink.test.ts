import { describe, it, expect } from 'vitest';
import { parseReceivingLink } from './walletReceivingLink';
const origins = ['https://vanta.app'];
describe('receiving link', () => {
  it('accepts a recipient-only trusted link', () => expect(parseReceivingLink('https://vanta.app/balance?recipient=abc_123',origins)).toBe('abc_123'));
  it.each(['https://evil.example/balance?recipient=abc','https://vanta.app.evil.example/balance?recipient=abc','https://vanta.app@evil.example/balance?recipient=abc','https://evil@vanta.app/balance?recipient=abc','https://vanta.app/balance?recipient=a&recipient=b','https://vanta.app/balance?recipient=a&amount=100','https://vanta.app/balance?recipient=a#send','https://vanta.app/other?recipient=a','https://vanta.app/balance?recipient=%2F','javascript:alert(1)'])('rejects %s',url=>expect(parseReceivingLink(url,origins)).toBeNull());
});
