'use client';

// Lightweight global signal shared by the Story composer and the Story tray:
// whenever a Story/Status is published or deleted, `notifyStoryFeedChanged`
// triggers every mounted tray to re-fetch `/api/stories` without any drilling.
export const STORY_FEED_CHANGED_EVENT = 'vanta:story-feed-changed';

export function notifyStoryFeedChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STORY_FEED_CHANGED_EVENT));
}

export function onStoryFeedChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(STORY_FEED_CHANGED_EVENT, handler);
  return () => window.removeEventListener(STORY_FEED_CHANGED_EVENT, handler);
}