// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestNativeLocation } from './nativeLocation';

afterEach(() => vi.unstubAllGlobals());

describe('Android native location handshake', () => {
  it('waits for the trusted origin nonce rather than falling back to denied WebView geolocation', async () => {
    const requestCurrentLocation = vi.fn();
    const host = Object.assign(new EventTarget(), {
      VantaNativeLocation: { requestCurrentLocation },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      __VANTA_NATIVE_LOCATION_NONCE__: undefined as string | undefined,
    });
    vi.stubGlobal('window', host);
    const location = requestNativeLocation();
    expect(location).not.toBeNull();
    expect(requestCurrentLocation).not.toHaveBeenCalled();

    host.__VANTA_NATIVE_LOCATION_NONCE__ = 'trusted-nonce';
    host.dispatchEvent(new Event('vanta-native-location-ready'));
    expect(requestCurrentLocation).toHaveBeenCalledTimes(1);
    const [nonce, requestId] = requestCurrentLocation.mock.calls[0] as [string, string];
    expect(nonce).toBe('trusted-nonce');
    const result = Object.assign(new Event('vanta-native-location-result'), {
      detail: { requestId, lat: 6.6, lng: 3.5, accuracy: 25 },
    });
    host.dispatchEvent(result);
    await expect(location).resolves.toEqual({ lat: 6.6, lng: 3.5, accuracy: 25 });
  });

  it('returns null when the app has no native location bridge', () => {
    const host = Object.assign(new EventTarget(), { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    vi.stubGlobal('window', host);
    expect(requestNativeLocation()).toBeNull();
  });
});
