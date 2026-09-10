// @vitest-environment node
/**
 * Regression coverage for camera constraint selection (cameraCapture).
 *
 * Historically every capture path hard-coded 1280x720 regardless of the device,
 * so HD/all phones captured soft video. These tests pin:
 *   - devices that support ≥1080p are requested at 1080p (ideal),
 *   - weaker devices fall back to 720p (never over-constrained),
 *   - continuous autofocus/exposure/white-balance constraints are only added
 *     when the device advertises them,
 *   - front/rear camera selection reads MediaTrackCapabilities.
 */
import { describe, expect, test } from 'vitest';
import {
  pickCaptureTarget,
  pickPrimaryCamera,
  pickVideoConstraints,
  readCameraProfile,
  CAPTURE_TARGETS,
} from './cameraCapture';

type FakeCamera = MediaDeviceInfo & { getCapabilities(): MediaTrackCapabilities };

function fakeCamera(overrides: Record<string, unknown>, label?: string): FakeCamera {
  const cam: FakeCamera = {
    deviceId: 'cam-1',
    groupId: 'g1',
    kind: 'videoinput',
    label: label ?? 'Front Camera',
    toJSON: () => ({ deviceId: 'cam-1' }),
    getCapabilities: () =>
      ({
        facingMode: ['user'],
        width: { min: 160, max: 1920, ideal: 1920 },
        height: { min: 90, max: 1080, ideal: 1080 },
        frameRate: { min: 10, max: 30, ideal: 30 },
        ...overrides,
      }) as MediaTrackCapabilities,
  } as FakeCamera;
  return cam;
}

describe('pickCaptureTarget', () => {
  test('returns 1080p when the device supports it', () => {
    const target = pickCaptureTarget(readCameraProfile(fakeCamera({})));
    expect(target.width).toBe(1920);
    expect(target.height).toBe(1080);
  });

  test('falls back to 720p for a 720p-only device', () => {
    const cam = fakeCamera({
      width: { min: 160, max: 1280 },
      height: { min: 90, max: 720 },
    });
    const target = pickCaptureTarget(readCameraProfile(cam));
    expect(target.width).toBe(1280);
    expect(target.height).toBe(720);
  });

  test('never requests unsupported resolutions (ideal constraints only)', () => {
    const cam = fakeCamera({
      width: { min: 160, max: 1280 },
      height: { min: 90, max: 720 },
    });
    const constraints = pickVideoConstraints(cam);
    const width = constraints.width as ConstrainULongRange;
    const height = constraints.height as ConstrainULongRange;
    // ideal only — no exact/max that could throw OverconstrainedError.
    expect(width.ideal).toBe(1280);
    expect(height.ideal).toBe(720);
    expect(width.max).toBeUndefined();
    expect(height.max).toBeUndefined();
  });
});

describe('pickVideoConstraints advanced camera controls', () => {
  test('adds continuous autofocus/exposure/white-balance when advertised', () => {
    const cam = fakeCamera({
      focusMode: ['manual', 'continuous'],
      exposureMode: ['manual', 'continuous'],
      whiteBalanceMode: ['auto', 'continuous'],
    });
    const constraints = pickVideoConstraints(cam);
    const advanced = (constraints.advanced ?? []) as Record<string, string>[];
    const joined = advanced.map((a) => JSON.stringify(a)).join('|');
    expect(joined).toContain('focusMode');
    expect(advanced.find((a) => a.focusMode === 'continuous')).toBeDefined();
    expect(advanced.find((a) => a.exposureMode === 'continuous')).toBeDefined();
    expect(advanced.find((a) => a.whiteBalanceMode === 'continuous')).toBeDefined();
  });

  test('omits advanced constraints on a camera that does not advertise them', () => {
    const cam = fakeCamera({});
    const constraints = pickVideoConstraints(cam);
    expect(constraints.advanced).toBeUndefined();
  });
});

describe('front/rear camera selection', () => {
  test('pickPrimaryCamera prefers a user-facing camera', () => {
    const front = fakeCamera({ facingMode: ['user'] });
    const rear = fakeCamera({ facingMode: ['environment'] }, 'Back Camera');
    expect(pickPrimaryCamera([rear, front])?.deviceId).toBe(front.deviceId);
  });

  test('pickPrimaryCamera falls back to the only camera when no facingMode is reported', () => {
    const cam = fakeCamera({ facingMode: [] });
    expect(pickPrimaryCamera([cam])?.deviceId).toBe(cam.deviceId);
  });
});

describe('CAPTURE_TARGETS shape', () => {
  test('targets are ordered best-to-worst with 30fps', () => {
    expect(CAPTURE_TARGETS.length).toBeGreaterThanOrEqual(2);
    expect(CAPTURE_TARGETS[0]).toEqual({ width: 1920, height: 1080, frameRate: 30 });
  });
});