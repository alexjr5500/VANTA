/**
 * Backward-compatible shim so existing imports (`@/components/create/ReelTimeline`)
 * keep resolving to the shared VANTA video timeline trimmer used by every
 * video upload flow.
 */
export { default } from '@/components/video/VideoTrimTimeline';
export type { VideoTrimTimelineProps } from '@/components/video/VideoTrimTimeline';