import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(path.resolve(__dirname, 'page.tsx'), 'utf8');
const detail = readFileSync(path.resolve(__dirname, '[id]/page.tsx'), 'utf8');

describe('reels share sheet wiring', () => {
  it('main feed uses the TikTok-style ReelShareSheet, not the old dialog', () => {
    expect(feed).toContain("import ReelShareSheet from '@/components/social/ReelShareSheet'");
    expect(feed).toContain('<ReelShareSheet');
    expect(feed).not.toContain('SharePanel');
    expect(feed).not.toContain('Share to apps');
  });

  it('feed wires send, repost, save, report and native handlers', () => {
    for (const prop of ['onSend={sendToChat}', 'onSave=', 'onReport=', 'onNative=', 'onCopy=']) {
      expect(feed).toContain(prop);
    }
  });

  it('single reel page still uses the same sheet', () => {
    expect(detail).toContain('<ReelShareSheet');
  });
});
