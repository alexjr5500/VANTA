import { fetchPushConfig, registerDevice, unregisterDeviceByToken } from "./pushApi";

// ============================================================================
// VANTA web push client — subscribes the browser to the Push API and keeps the
// backend device-token store in sync. No secrets are ever handled here: the
// push subscription is public by design and the VAPID *public* key is fetched
// from the backend at runtime.
//
// Permission UX (Android/desktop): we NEVER trigger the browser permission
// prompt on first launch. The app passively registers when permission was
// already granted, and `enablePush()` requests permission only when the user
// taps the explicit "Enable notifications" control in Settings.
// ============================================================================

export type PushPermissionState = "default" | "granted" | "denied";

export interface PushRegistrationResult {
  ok: boolean;
  reason?: string;
  permission?: PushPermissionState;
  deviceId?: string | null;
}

const SW_PATH = "/vanta-sw.js";
const STORED_TOKEN_KEY = "vanta_push_subscription_token";
const STORED_DEVICE_ID_KEY = "vanta_push_device_id";

/** Convert an ArrayBuffer to a URL-safe base64 string (no padding). */
const bufferToBase64Url = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Convert a URL-safe base64 public key to the Uint8Array PushManager expects. */
export const base64UrlToUint8Array = (value: string): Uint8Array => {
  const pad = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalized = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export const isPushSupported = (): boolean =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  typeof window.PushManager !== "undefined";

/** Register (or re-activate) the VANTA service worker. */
export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.register(SW_PATH);
    void navigator.serviceWorker.ready.catch(() => undefined);
    return registration;
  } catch {
    return null;
  }
};

/** Current browser push subscription (or null). */
export const getPushSubscription = async (): Promise<PushSubscription | null> => {
  try {
    const registration = await navigator.serviceWorker.ready;
    return registration?.pushManager?.getSubscription() ?? null;
  } catch {
    return null;
  }
};

export const getPermissionState = async (): Promise<PushPermissionState> => {
  try {
    const registration = await navigator.serviceWorker.ready;
    const permission = (registration?.pushManager as any)?.permission;
    if (permission === "granted" || permission === "denied") return permission;
    return "default";
  } catch {
    return "default";
  }
};

export { STORED_TOKEN_KEY, STORED_DEVICE_ID_KEY };
/**
 * Subscribe this browser and register the device token with the backend.
 *
 * When `requestPermission` is false and the browser has not granted
 * permission yet, this resolves ok=false WITHOUT prompting — the caller
 * surfaces the status and lets the user opt in explicitly.
 */
export async function subscribeAndRegister(
  authToken: string,
  options: { requestPermission?: boolean } = {}
): Promise<PushRegistrationResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }

  const config = await fetchPushConfig();
  if (!config || !config.vapidPublicKey) {
    return { ok: false, reason: "not-configured" };
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    return { ok: false, reason: "sw-failed" };
  }
  void navigator.serviceWorker.ready.catch(() => undefined);

  let permission: PushPermissionState = "default";
  try {
    permission = (await getPermissionState()) as PushPermissionState;
  } catch {
    permission = "default";
  }

  if (permission === "default" && !options.requestPermission) {
    return { ok: false, reason: "permission-pending", permission };
  }
  if (permission === "denied" && !options.requestPermission) {
    return { ok: false, reason: "permission-denied", permission };
  }

  const manager = registration.pushManager;

  // If permission was previously denied and the user now explicitly opts in,
  // requestPermissions() re-opens the browser prompt.
  if (permission === "denied" || permission === "default") {
    try {
      await (manager as any).requestPermissions?.();
    } catch {
      return { ok: false, reason: "permission-denied", permission: "denied" };
    }
  }

  let subscription: PushSubscription | null = null;
  try {
    subscription = await manager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: config.vapidPublicKey,
    });
  } catch {
    return { ok: false, reason: "subscribe-failed" };
  }

const token = JSON.stringify({
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: bufferToBase64Url((await subscription.getKey("p256dh")) ?? new ArrayBuffer(0)),
      auth: bufferToBase64Url((await subscription.getKey("auth")) ?? new ArrayBuffer(0)),
    },
  });

  try {
    localStorage.setItem(STORED_TOKEN_KEY, token);
  } catch {
    // storage unavailable
  }

  const device = await registerDevice(
    token,
    {
      platform: "web",
      provider: "webpush",
      deviceModel: detectionString(),
      appVersion: "pwa",
    },
    authToken
  );

  if (!device) {
    // The subscription is valid even if the backend is temporarily unreachable;
    // retried on the next focus / pushsubscriptionchange event.
    return { ok: true, permission, deviceId: null };
  }

  try {
    localStorage.setItem(STORED_DEVICE_ID_KEY, device.id);
  } catch {
    // non-fatal
  }

  return { ok: true, permission, deviceId: device.id };
}

/** Best-effort unsubscribe + tell the backend the token is dead (logout). */
export async function unsubscribeAndUnregister(authToken: string | null): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(STORED_TOKEN_KEY);
  } catch {
    token = null;
  }

  if (token) {
    if (authToken) {
      await unregisterDeviceByToken(token, authToken).catch(() => undefined);
    }
    try {
      localStorage.removeItem(STORED_TOKEN_KEY);
      localStorage.removeItem(STORED_DEVICE_ID_KEY);
    } catch {
      // ignore
    }
  }
}

/** Human-readable device description for the settings screen. */
function detectionString(): string {
  try {
    const ua = navigator.userAgent || "";
    const platform =
      /android/i.test(ua)
        ? "android"
        : /iPhone|iPad|iPod/i.test(ua)
          ? "ios"
          : /Macintosh|Mac OS X/i.test(ua)
            ? "mac"
            : /Windows/i.test(ua)
              ? "windows"
              : /Linux/i.test(ua)
                ? "linux"
                : "web";
    const brand = /Samsung/i.test(ua) ? "Samsung" : /Pixel/i.test(ua) ? "Pixel" : platform;
    return `${brand} · ${platform}`;
  } catch {
    return "web";
  }
}