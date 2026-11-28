import { describe, expect, it } from 'vitest';
import { parseVoicePlaybackRate } from './voicePlayback';

describe('voice playback rate', () => {
  it('uses supported device preferences', () => {
    expect(parseVoicePlaybackRate('{"speed":"1.5"}')).toBe(1.5);
    expect(parseVoicePlaybackRate('{"speed":"2"}')).toBe(2);
  });
  it('defaults safely for invalid or absent preferences', () => {
    for (const value of [null, 'null', 'bad json', '{"speed":"100"}', '{}']) expect(parseVoicePlaybackRate(value)).toBe(1);
  });
});
