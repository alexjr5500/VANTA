/** Keep at most the active decoder and two neighbors; data saver mounts only active. */
export function shouldMountReelVideo(index: number, active: number, visible: boolean, lowerData: boolean): boolean {
  if (!visible || !Number.isSafeInteger(index) || !Number.isSafeInteger(active) || index < 0 || active < 0) return false;
  return Math.abs(index - active) <= (lowerData ? 0 : 1);
}
