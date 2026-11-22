import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(path.resolve(__dirname, 'page.tsx'), 'utf8');
const detail = readFileSync(path.resolve(__dirname, '[id]/page.tsx'), 'utf8');
const hub = readFileSync(path.resolve(__dirname, '../../components/profile/v2/CreatorHubPage.tsx'), 'utf8');

describe('reel action rail', () => {
  it('has repost only on the single reel page (removed from main /reels)', () => {
    expect(feed).not.toContain('onRepost');
    expect(detail).toContain("onClick={() => void repost()} active={Boolean(reel.isReposted)}");
  });
  it('gift turns active after a real send, from server state', () => {
    expect(feed).toContain('isGifted: true');
    expect(feed).toContain('active={Boolean(reel.isGifted)}');
  });
  it('no reposted toast', () => {
    expect(feed).not.toContain("'Reel reposted'");
    expect(detail).not.toContain("'Reel reposted'");
    expect(feed).not.toContain("'Repost removed'");
  });
  it('rail buttons are not wrapped in a shared circle', () => {
    expect(feed).not.toMatch(/rounded-full[^"]*"[^>]*>\s*<Action/);
  });
  it('profile has a reposts tab backed by /reposts', () => {
    expect(hub).toContain("id: 'reposts'");
    expect(hub).toContain("tab === 'reposts'");
  });
});
