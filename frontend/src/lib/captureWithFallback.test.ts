// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getUserMediaWithFallback } from './captureWithFallback';

const fakeStream = {} as MediaStream;
const captureError = (name: string) => Object.assign(new Error(name), { name });

describe('camera capture fallback (Android WebView)', () => {
  it('retries device-specific camera constraints with the default camera', async () => {
    const capture = vi.fn().mockRejectedValueOnce(captureError('OverconstrainedError')).mockResolvedValueOnce(fakeStream);
    const result = await getUserMediaWithFallback({ audio: true, video: { deviceId: { exact: 'unavailable' } } }, capture);
    expect(result).toBe(fakeStream);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenLastCalledWith({ audio: true, video: true });
  });

  it('never retries blocked permissions, preventing repeated Android prompts', async () => {
    const denied = captureError('NotAllowedError');
    const capture = vi.fn().mockRejectedValue(denied);
    await expect(getUserMediaWithFallback({ video: { width: { ideal: 1920 } } }, capture)).rejects.toBe(denied);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('does not retry voice-only capture or camera-busy errors', async () => {
    const busy = captureError('NotReadableError');
    const capture = vi.fn().mockRejectedValue(busy);
    await expect(getUserMediaWithFallback({ audio: true, video: false }, capture)).rejects.toBe(busy);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
