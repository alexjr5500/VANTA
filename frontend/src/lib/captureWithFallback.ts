/**
 * Android WebView can reject camera constraints discovered before capture
 * permission is granted. Retry only device-selection failures with the
 * platform's default camera; never retry a user permission denial.
 */
export async function getUserMediaWithFallback(
  constraints: MediaStreamConstraints,
  capture: (options: MediaStreamConstraints) => Promise<MediaStream> =
    (options) => navigator.mediaDevices.getUserMedia(options),
): Promise<MediaStream> {
  try {
    return await capture(constraints);
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    const specifiedVideo = typeof constraints.video === 'object' && constraints.video !== null;
    if (!specifiedVideo ||
      !['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotFoundError', 'DevicesNotFoundError'].includes(name ?? '')) {
      throw error;
    }
    return capture({ ...constraints, video: true });
  }
}
