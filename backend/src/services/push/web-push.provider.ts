import webpush from "web-push";
import type { PushDeviceRecord, PushNotificationPayload, WebPushSubscription } from "./push-types";
import type { PushProvider } from "./push-provider.interface";

// ============================================================================
// Web Push (VAPID) provider — the ACTIVE push channel for the VANTA PWA.
//
// Delivers real OS-level push notifications through the browser's push service
// (Chrome/GCM, Android PWA, Firefox autopush, Safari 16+ installed PWA,
// desktop). The subscription is a W3C PushSubscription; the server signs every
// request with the VAPID key pair so the push service accepts the POST.
//
// Credentials (backend only, NEVER client-side):
//   VAPID_SUBJECT      mailto: or https: contact for the push service
//   VAPID_PUBLIC_KEY   URL-safe base64 public key (65 bytes, no 0x04 prefix)
//   VAPID_PRIVATE_KEY  URL-safe base64 private key
//
// Generate once:  npx web-push generate-vapid-keys --json
// ============================================================================

const SUBJECT = process.env.VAPID_SUBJECT || process.env.WEB_PUSH_SUBJECT || "";
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || process.env.WEB_PUSH_PRIVATE_KEY || "";

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_TTL_SECONDS = 86_400; // Drop un-deliverable pushes after 24h

let initialized = false;
let configured: boolean | null = null;

function init(): boolean {
  if (configured !== null) return configured;
  if (!SUBJECT || !PUBLIC_KEY || !PRIVATE_KEY) {
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch (error) {
    console.error("[push:webpush] VAPID configuration rejected:", (error as Error)?.message);
    configured = false;
  }
  return configured;
}

/** Derive a push-service `topic` header (max 32 URL/filename-safe base64 chars). */
function deriveTopic(payload: PushNotificationPayload): string | undefined {
  if (!payload.tag || payload.tag.length > 32) {
    const stable = payload.tag || payload.eventId;
    return stable.length > 26 ? `v1-${stable.slice(-23)}` : `v1-${stable}`;
  }
  return payload.tag;
}

export const webPushProvider: PushProvider = {
  name: "webpush",

  isConfigured(): boolean {
    return init();
  },

  async send(device: PushDeviceRecord, payload: PushNotificationPayload) {
    if (!init()) {
      return { ok: false, invalid: false, error: "VAPID keys are not configured (VAPID_SUBJECT/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)" };
    }

    let subscription: WebPushSubscription;
    try {
      subscription = JSON.parse(device.token) as WebPushSubscription;
      if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        return { ok: false, invalid: true, error: "Malformed web push subscription" };
      }
    } catch {
      // The token is not a web push subscription; the device row is unusable.
      return { ok: false, invalid: true, error: "Not a web push subscription" };
    }

    // JSON payload. The service worker reads it with event.data.text() +
    // JSON.parse so it works regardless of the push service content-type.
    const body = JSON.stringify({
      eventId: payload.eventId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      actions: payload.actions || [],
      tag: payload.tag || undefined,
      priority: payload.priority,
      requireInteraction: Boolean(payload.requireInteraction),
      vibrate: payload.vibrate || undefined,
      sound: payload.sound || undefined,
      renotify: Boolean(payload.renotify),
    });

    try {
      await webpush.sendNotification(subscription, body, {
        ttl: payload.ttlSeconds ?? DEFAULT_TTL_SECONDS,
        urgency: payload.priority === "high" ? "high" : payload.priority === "low" ? "low" : "normal",
        topic: deriveTopic(payload),
        timeout: REQUEST_TIMEOUT_MS,
      });
      return { ok: true };
    } catch (error: any) {
      const status = Number(error?.statusCode || 0);
      // 404/410 (and GCM "not registered" responses) mean the subscription has
      // disappeared — the browser unsubscribed or cleared site data.
      if (status === 404 || status === 410) {
        return { ok: false, invalid: true, error: `Push service reports token unregistered (${status})` };
      }
      if (status === 429) {
        return { ok: false, invalid: false, error: "Push service rate limit (429)" };
      }
      if (status >= 500 && status < 600) {
        return { ok: false, invalid: false, error: `Push service failure (${status})` };
      }
      return {
        ok: false,
        invalid: false,
        error: error?.message ? String(error.message).slice(0, 300) : "Unknown web push error",
      };
    }
  },
};