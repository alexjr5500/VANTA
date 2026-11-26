/** Bounded Reels preloading and gesture rules, independent of the DOM. */
export const REEL_TAP_WINDOW_MS = 280;
export const REEL_TAP_SLOP_PX = 14;
export type ReelTap = { x: number; y: number; at: number };
export function isReelTap(start: ReelTap, end: ReelTap): boolean {
  return end.at >= start.at && end.at - start.at <= 450 &&
    Math.hypot(end.x - start.x, end.y - start.y) <= REEL_TAP_SLOP_PX;
}
export function isReelDoubleTap(first: ReelTap | null, second: ReelTap): boolean {
  return !!first && second.at >= first.at && second.at - first.at <= REEL_TAP_WINDOW_MS &&
    Math.hypot(second.x - first.x, second.y - first.y) <= 48;
}
export function reelPreload(index: number, active: number, lowerData: boolean): 'auto' | 'metadata' | null {
  if (index === active) return 'auto';
  if (Math.abs(index - active) !== 1) return null;
  return !lowerData && index === active + 1 ? 'auto' : 'metadata';
}
export function reelIndexAtScroll(scrollTop: number, pageHeight: number, count: number): number {
  if (!count || !Number.isFinite(pageHeight) || pageHeight <= 0 || !Number.isFinite(scrollTop)) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(scrollTop / pageHeight)));
}
/** Double taps are an ensure-like action; only the explicit heart can unlike. */
export function nextReelLike(liked: boolean, ensureLike: boolean): boolean | null {
  return ensureLike && liked ? null : !liked;
}
