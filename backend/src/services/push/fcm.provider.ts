import type { PushDeviceRecord, PushNotificationPayload } from "./push-types";
import type { PushProvider } from "./push-provider.interface";

// ============================================================================
// Firebase Cloud Messaging (FCM) provider — for Android/iOS native tokens and
// FCM-registered web tokens. This is the provider the spec asks for; it is
// inert until Firebase server credentials are configured, and it never exposes
// any credential to clients. The VANTA PWA delivers through the web-push
// (VAPID) provider; native Android/iOS apps register their FCM registration
// token through the same device endpoint with provider="fcm".
//
// Credentials (backend only — NEVER committed):
//   FIREBASE_PROJECT_ID        (already used by VANTA's phone OTP flow)
//   FIREBASE_CLIENT_EMAIL      service account client_email
//   FIREBASE_PRIVATE_KEY       service account private_key (JSON escaped)
//   FIREBASE_PRIVATE_KEY_ID    optional (service account private_key_id)
//   FIREBASE_CLIENT_ID         optional (service account client_id)
//   -- OR --
//   FIREBASE_CREDENTIALS_JSON  full service-account JSON (single line)
//   -- OR --
//   GOOGLE_APPLICATION_CREDENTIALS  path to service-account JSON (firebase-admin default)
// ============================================================================

let configured: boolean | null = null;
let admin: any = null;

function loadAdmin(): { admin: any } | null {
  if (configured !== null) return configured ? { admin } : null;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const credsJson = process.env.FIREBASE_CREDENTIALS_JSON;
  const googlePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!projectId) {
    configured = false;
    return null;
  }

  try {
    // Import lazily so an FCM-less deployment never pays for firebase-admin
    // at startup and a broken install can never crash the backend.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const firebaseAdmin = require("firebase-admin") as {
      initializeApp: (opts?: any) => any;
      apps?: any[];
      app: () => any;
      messaging: any;
    };

    let certData: any = undefined;
    if (credsJson) {
      certData = JSON.parse(credsJson);
    } else if (clientEmail && privateKey) {
      certData = {
        client_email: clientEmail,
        private_key: privateKey,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "unknown",
        client_id: process.env.FIREBASE_CLIENT_ID || "unknown",
        token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
      };
    } else if (!googlePath) {
      configured = false;
      return null;
    }

    if (certData || googlePath) {
      const app = firebaseAdmin.apps && firebaseAdmin.apps.length
        ? firebaseAdmin.app()
        : firebaseAdmin.initializeApp({ credential: certData, projectId });
      admin = { ...firebaseAdmin, app };
    }
    configured = Boolean(admin);
  } catch (error) {
    console.error("[push:fcm] Failed to initialize Firebase Admin (FCM disabled):", (error as Error)?.message);
    admin = null;
    configured = false;
  }
  return configured ? { admin } : null;
}

const stringifyData = (data: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
};
export const fcmProvider: PushProvider = {
  name: "fcm",

  isConfigured(): boolean {
    const loaded = loadAdmin();
    return configured === true && loaded !== null && Boolean(admin);
  },

  async send(device: PushDeviceRecord, payload: PushNotificationPayload) {
    const loaded = loadAdmin();
    if (!loaded) {
      return { ok: false, invalid: false, error: "FCM is not configured (FIREBASE_PROJECT_ID + service account)" };
    }

    const token = device.token;
    if (!token || token.length < 20) {
      return { ok: false, invalid: true, error: "Malformed FCM registration token" };
    }

    const ttl = payload.ttlSeconds ?? 86_400;
    const urgency = payload.priority === "high" ? "HIGH" : payload.priority === "low" ? "LOW" : "NORMAL";

    const message: any = {
      notification: { title: payload.title, body: payload.body },
      data: stringifyData(payload.data || {}),
    };

    if (device.platform === "android") {
      message.android = {
        priority: urgency,
        ttl,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.icon ? { icon: payload.icon } : {}),
          ...(payload.sound ? { sound: payload.sound } : {}),
        },
        ...(payload.data ? { data: stringifyData(payload.data) } : {}),
      };
    } else if (device.platform === "ios") {
      // APNs payload is limited to 4KB — keep data minimal.
      message.ios = {
        priority: urgency.toLowerCase(),
        ttl,
        notification: { title: payload.title, body: payload.body },
        ...(payload.data ? { data: stringifyData(payload.data) } : {}),
      };
    } else {
      message.webpush = {
        headers: {
          TTL: String(ttl),
          Urgency: urgency.toLowerCase(),
          ...(payload.tag ? { Topic: payload.tag.slice(0, 32) } : {}),
        },
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.icon ? { icon: payload.icon } : {}),
          ...(payload.badge ? { badge: payload.badge } : {}),
          ...(payload.sound ? { sound: payload.sound } : {}),
        },
      };
    }

    try {
      // sendEachForMulticast resolves with per-token results (HTTP v1): a dead
      // token surfaces as an error entry instead of throwing the whole batch.
      const batch = await admin.messaging.sendEachForMulticast({ tokens: [token] }, message);
      const response = batch?.responses?.[0];
      if (response?.success) return { ok: true };

      const error = response?.error as { code?: string; message?: string } | undefined;
      const code = String(error?.code || "");
      const text = error?.message || "FCM delivery failed";
      if (/UNREGISTERED|NOT_FOUND|registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) {
        return { ok: false, invalid: true, error: `FCM token invalid (${code})` };
      }
      return { ok: false, invalid: false, error: `FCM: ${code} ${text}`.slice(0, 300) };
    } catch (error: any) {
      const code = String(error?.code || "");
      if (/UNREGISTERED|NOT_FOUND|token-not-registered|invalid-argument/.test(code)) {
        return { ok: false, invalid: true, error: code.slice(0, 120) };
      }
      return {
        ok: false,
        invalid: false,
        error: error?.message ? String(error.message).slice(0, 300) : "FCM request failed",
      };
    }
  },
};