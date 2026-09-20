'use client';

import StoryTray from '@/components/story/StoryTray';

// The Discover page previously showed its own story strip. The 2026 Story/Status
// experience is ONE canonical tray rendered everywhere, so Discover simply
// mounts the shared premium tray (it fetches `/api/stories` itself).
export default function DiscoverStories() {
  return <StoryTray compact />;
}