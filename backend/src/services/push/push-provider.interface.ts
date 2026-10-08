import type { PushDeviceRecord, PushNotificationPayload } from "./push-types";

/**
 * The single transport contract every push provider implements. The rest of
 * VANTA talks to PushNotificationService, which picks the right provider per
 * device — low-level FCM/Web Push plumbing never leaks into business code.
 */
export interface PushProvider {
  readonly name: "webpush" | "fcm";

  /** True when the environment has the credentials needed to deliver. */
  isConfigured(): boolean;

  /**
   * Deliver one notification to one device.
   *
   * @returns { ok: true } on successful delivery.
   * @returns { ok: false, invalid: true } when the provider reports the token
   *   is no longer registered (404/410 unregistered, FCM NOT_REGISTERED) —
   *   the caller marks the device inactive and stops retrying it.
   * @returns { ok: false, invalid: false, error } for transient failures that
   *   MAY be retried (network, 429, 5xx, provider outage).
   */
  send(
    device: PushDeviceRecord,
    payload: PushNotificationPayload
  ): Promise<{ ok: boolean; invalid?: boolean; error?: string }>;
}