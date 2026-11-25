import { allowedCommunityReactions, COMMUNITY_REACTIONS, memberWelcome, mergeCommunitySettings, readCommunitySettings } from '../services/community-settings';

describe('Community engagement settings', () => {
  const enabled = new Date('2026-01-01T00:00:00Z');
  it('defaults to all supported reactions and no welcome', () => {
    expect(allowedCommunityReactions(null)).toEqual([...COMMUNITY_REACTIONS]);
    expect(memberWelcome(null, { id: 'p1', createdAt: enabled })).toBeNull();
  });
  it('allows specific reactions and disables all when requested', () => {
    const selected = mergeCommunitySettings(null, { reaction_1: false }, [], enabled);
    expect(allowedCommunityReactions(selected)).not.toContain('😂');
    expect(allowedCommunityReactions(selected)).toContain('❤️');
    expect(allowedCommunityReactions(mergeCommunitySettings(selected, { reactionsEnabled: false }, [], enabled))).toEqual([]);
  });
  it('preserves retention and unrelated settings and rejects untrusted keys or types', () => {
    const merged = mergeCommunitySettings('{"autoDeleteSeconds":3600,"sendMessages":false}', { sendMessages: 'true', postMessages: true, autoDeleteSeconds: 0, welcomeEnabledAt: '2000-01-01', reaction_0: false }, ['sendMessages'], enabled);
    expect(readCommunitySettings(merged)).toEqual({ autoDeleteSeconds: 3600, sendMessages: false, reaction_0: false });
  });
  it('delivers a welcome only to members who joined after activation, not the owner', () => {
    const settings = mergeCommunitySettings(null, { welcomeMessage: ' Welcome! ' }, [], enabled);
    expect(memberWelcome(settings, { id: 'new', role: 'MEMBER', createdAt: '2026-01-02T00:00:00Z' })).toEqual({ text: 'Welcome!', membershipId: 'new' });
    expect(memberWelcome(settings, { id: 'old', role: 'MEMBER', createdAt: '2025-12-31T00:00:00Z' })).toBeNull();
    expect(memberWelcome(settings, { id: 'owner', role: 'OWNER', createdAt: enabled })).toBeNull();
    expect(memberWelcome(settings, undefined)).toBeNull();
  });
  it('preserves activation on edits, clears it on disable, and caps welcome text', () => {
    const first = mergeCommunitySettings(null, { welcomeMessage: 'Hello' }, [], enabled);
    const edited = mergeCommunitySettings(first, { welcomeMessage: 'x'.repeat(600) }, [], new Date('2026-02-01'));
    expect(readCommunitySettings(edited).welcomeEnabledAt).toBe(enabled.toISOString());
    expect(readCommunitySettings(edited).welcomeMessage).toBe('x'.repeat(500));
    const disabled = mergeCommunitySettings(edited, { welcomeMessage: ' ' }, [], enabled);
    expect(memberWelcome(disabled, { id: 'new', createdAt: enabled })).toBeNull();
    expect(readCommunitySettings(disabled).welcomeEnabledAt).toBeNull();
  });
});
