/**
 * First-party Android WebView location bridge. A native permission prompt can
 * recover from WebView's cached geolocation denial without leaking coordinates
 * to third-party frames or auto-sharing location.
 */
export interface VantaCoordinates { lat: number; lng: number; accuracy?: number }
interface NativeLocationResult {
  requestId: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  error?: string;
}
interface VantaNativeLocationBridge {
  requestCurrentLocation(nonce: string, requestId: string): void;
}
type NativeLocationWindow = Window & {
  VantaNativeLocation?: VantaNativeLocationBridge;
  __VANTA_NATIVE_LOCATION_NONCE__?: string;
};

/** Null means no native bridge: callers should use navigator.geolocation. */
export function requestNativeLocation(timeoutMs = 20000): Promise<VantaCoordinates> | null {
  if (typeof window === 'undefined') return null;
  const host = window as NativeLocationWindow;
  const bridge = host.VantaNativeLocation;
  const nonce = host.__VANTA_NATIVE_LOCATION_NONCE__;
  if (!bridge || typeof bridge.requestCurrentLocation !== 'function' || !nonce) return null;

  const requestId = 'location-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  return new Promise<VantaCoordinates>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('vanta-native-location-result', onResult);
    };
    const finish = (coords?: VantaCoordinates, error?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (coords) resolve(coords);
      else reject(new Error(error || 'Location unavailable'));
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<NativeLocationResult>).detail;
      if (!detail || detail.requestId !== requestId) return;
      if (detail.error) { finish(undefined, detail.error); return; }
      if (!Number.isFinite(detail.lat) || !Number.isFinite(detail.lng)) {
        finish(undefined, 'Location unavailable');
        return;
      }
      const lat = Number(detail.lat), lng = Number(detail.lng);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        finish(undefined, 'Invalid location'); return;
      }
      finish({ lat, lng, accuracy: detail.accuracy });
    };
    const timer = window.setTimeout(() => finish(undefined, 'Location timed out. Turn on device Location and try again.'), timeoutMs);
    window.addEventListener('vanta-native-location-result', onResult);
    try { bridge.requestCurrentLocation(nonce, requestId); }
    catch { finish(undefined, 'Native location permission request failed'); }
  });
}
