// ============================================================================
// VANTA — Push notification shared types
// ============================================================================
// Central types used by the push providers, the PushNotificationService, and
// the REST/socket integration layers. Kept intentionally small and explicit.

/** Device platforms the push system can target. */
export type PushPlatform = "web" | "android" | "ios";

/** Concrete transport used to deliver a push. */
export type PushProviderName = "webpush" | "fcm";

/** A W3C Web Push subscription as stored for provider = "webpush". */
export interface WebPushSubscription {
  endpoint: string;
  expirationTime?: string | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/** A push action button rendered by the OS/browser alongside the notification. */
export interface PushAction {
  action: string;
  title: string;
}

/** Structured payload every notification carries (data minimization). */
export interface PushNotificationPayload {
  /** Idempotency key — MUST be stable per business event (notification id, callId, message id...). */
  eventId: string;
  /** Business notification type, e.g. incoming_call | message | follow | gift | wallet | system. */
  type: string;
  title: string;
  body: string;
  /** Minimal, schema-free metadata used for tap routing (never secrets). */
  data?: Record<string, unknown>;
  /** high drives urgency (see Web Push Urgency header / FCM priority). */
  priority?: "low" | "normal" | "high";
  /** OS-rendered action buttons (Answer / Decline for calls). */
  actions?: PushAction[];
  icon?: string;
  badge?: string;
  /** Sound played with the notification (Web Push `sound` on supporting platforms). */
  sound?: string;
  /** Vibration pattern for Android call notifications. */
  vibrate?: string;
  renotify?: boolean;
  /** Tag used to coalesce/replace/dismiss an existing visible notification. */
  tag?: string;
  requireInteraction?: boolean;
  /** Time-to-live in seconds (drops the push when the device is offline longer). */
  ttlSeconds?: number;
}

/** Outcome of a single device delivery attempt. */
export interface PushSendResult {
  deviceId: string | null;
  platform: string;
  provider: string;
  status: "SENT" | "FAILED" | "INVALID_TOKEN" | "SKIPPED";
  error?: string;
}

/** Denormalized PushDevice row consumed by providers. */
export interface PushDeviceRecord {
  id: string;
  userId: string;
  token: string;
  platform: string;
  provider: string;
  deviceModel?: string | null;
  appVersion?: string | null;
  isActive: boolean;
  lastSeenAt: Date;
}

/** Call event kinds dispatched by the calling integration. */
export type CallPushEvent =
  | "incoming_call"
  | "call_ended"
  | "call_declined"
  | "call_cancelled"
  | "call_answered"
  | "missed_call";