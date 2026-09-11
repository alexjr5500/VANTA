/**
 * Centralized status/story playback state machine.
 *
 * VANTA uses ONE controller so that tap navigation, long-press, and every
 * interaction overlay (comments / reply / reshare / share / delete / viewers)
 * never fight over the active story's playback. Playback only resumes once every
 * opened interaction layer has been released and no long-press hold is active.
 *
 *   playing     -> story auto-advances (image timer or video).
 *   paused      -> a long-press is actively holding playback.
 *   interaction -> one or more overlays are open (comments, reshare, ...).
 *
 * These are pure, framework-free transition functions so the behavior is unit
 * testable alongside the component that renders the story viewer.
 */

export type StoryPlaybackState = 'playing' | 'paused' | 'interaction';

export interface StoryPlaybackSnapshot {
  state: StoryPlaybackState;
  layers: ReadonlySet<string>;
  longPress: boolean;
}

export function startStoryPlayback(): StoryPlaybackSnapshot {
  return { state: 'playing', layers: new Set(), longPress: false };
}

/** An interaction overlay opened -> hold playback until it is released. */
export function openStoryLayer(s: StoryPlaybackSnapshot, reason: string): StoryPlaybackSnapshot {
  const layers = new Set(s.layers);
  layers.add(reason);
  return { state: 'interaction', layers, longPress: s.longPress };
}

/** An interaction overlay closed. Playback resumes when no layer remains. */
export function closeStoryLayer(s: StoryPlaybackSnapshot, reason: string): StoryPlaybackSnapshot {
  const layers = new Set(s.layers);
  layers.delete(reason);
  return { state: nextState(layers.size, s.longPress), layers, longPress: s.longPress };
}

/** User pressed and is holding -> pause (unless overlays already hold it). */
export function longPressStartStory(s: StoryPlaybackSnapshot): StoryPlaybackSnapshot {
  if (s.layers.size > 0) return { state: 'interaction', layers: s.layers, longPress: true };
  return { state: 'paused', layers: s.layers, longPress: true };
}

/** User released the hold -> resume from the same position. */
export function longPressEndStory(s: StoryPlaybackSnapshot): StoryPlaybackSnapshot {
  return { state: nextState(s.layers.size, false), layers: s.layers, longPress: false };
}

/** Navigating to another story clears every overlay and hold. */
export function resetStoryPlayback(): StoryPlaybackSnapshot {
  return startStoryPlayback();
}

function nextState(layerCount: number, longPress: boolean): StoryPlaybackState {
  if (layerCount > 0) return 'interaction';
  return longPress ? 'paused' : 'playing';
}

/** Decide left/right tap from the tap X vs the container width. */
export function tapZone(width: number, x: number): 'previous' | 'next' {
  // Left half of the story goes back a story; right half advances.
  return x < width * 0.5 ? 'previous' : 'next';
}