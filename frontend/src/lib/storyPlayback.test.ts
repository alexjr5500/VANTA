// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  startStoryPlayback,
  openStoryLayer,
  closeStoryLayer,
  longPressStartStory,
  longPressEndStory,
  resetStoryPlayback,
  tapZone,
} from './storyPlayback';

describe('storyPlayback state machine', () => {
  it('starts in the playing (auto-advance) state', () => {
    const s = startStoryPlayback();
    expect(s.state).toBe('playing');
    expect(s.layers.size).toBe(0);
    expect(s.longPress).toBe(false);
  });

  it('pauses to interaction when an overlay opens and resumes when it closes', () => {
    let s = startStoryPlayback();
    s = openStoryLayer(s, 'comments');
    expect(s.state).toBe('interaction');

    s = closeStoryLayer(s, 'comments');
    expect(s.state).toBe('playing');
    expect(s.layers.size).toBe(0);
  });

  it('stays paused while any overlay still holds the story open', () => {
    let s = startStoryPlayback();
    s = openStoryLayer(s, 'reshare');
    s = openStoryLayer(s, 'comments');
    // Closing one overlay is not enough to resume.
    s = closeStoryLayer(s, 'reshare');
    expect(s.state).toBe('interaction');
    // Closing the last overlay resumes.
    s = closeStoryLayer(s, 'comments');
    expect(s.state).toBe('playing');
  });

  it('long-press pauses and release resumes from the same point', () => {
    let s = startStoryPlayback();
    s = longPressStartStory(s);
    expect(s.state).toBe('paused');

    s = longPressEndStory(s);
    expect(s.state).toBe('playing');
    expect(s.longPress).toBe(false);
  });

  it('a long-press release does not resume while an overlay is open', () => {
    let s = startStoryPlayback();
    s = openStoryLayer(s, 'comments');
    s = longPressStartStory(s);
    // Even though the user released, the comments overlay still holds it paused.
    s = longPressEndStory(s);
    expect(s.longPress).toBe(false);
    expect(s.state).toBe('interaction');
  });

  it('navigation resets every overlay and hold', () => {
    let s = startStoryPlayback();
    s = openStoryLayer(s, 'delete');
    s = longPressStartStory(s);
    s = resetStoryPlayback();
    expect(s.state).toBe('playing');
    expect(s.layers.size).toBe(0);
    expect(s.longPress).toBe(false);
  });

  it('tap zone maps the left half to previous and right half to next', () => {
    const width = 400;
    expect(tapZone(width, 0)).toBe('previous');
    expect(tapZone(width, 199)).toBe('previous');
    expect(tapZone(width, 200)).toBe('next');
    expect(tapZone(width, 399)).toBe('next');
  });
});