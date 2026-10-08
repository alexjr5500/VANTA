import { prisma } from "../../prisma";
import { metricsCollector } from "../monitoring.service";
import { jobQueue, JOB_TYPES, JOB_PRIORITY } from "../queue.service";
import { webPushProvider } from "./web-push.provider";
import { fcmProvider } from "./fcm.provider";
import { presenceRegistry } from "./presence-registry";
import type { PushProvider } from "./push-provider.interface";
import type { CallPushEvent, PushDeviceRecord, PushNotificationPayload, PushSendResult } from "./push-types";

// ============================================================================
// PushNotificationService — the single entry point for OS-level push delivery.
//
// The rest of VANTA never talks to FCM / Web Push directly. It calls:
//   pushNotificationService.sendToUser(userId, { eventId, type, title, body, data })
// and the service resolves the user's active devices, picks the right provider
// (webpush for PWA subscriptions, fcm for Android/iOS tokens), enforces
// idempotency (UNIQUE(eventId, deviceId) in the PushDelivery ledger), rate
// limits, invalid-dead-token cleanup, retries (existing JobQueue), structured
// logging and observability counters.
// ============================================================================

const MAX_DEVICES_PER_USER = 20;
const MAX_PUSHES_PER_USER_PER_MINUTE = 40;
const TERMINAL_STATUSES = new Set(["SENT", "INVALID_TOKEN", "SKIPPED"]);
const PUSH_DELIVER_JOB = "push:deliver";
const CALL_EXPIRE_JOB = "call:expire";
const CALL_RING_TIMEOUT_MS = 90_000;

// Notification types that produce an OS push when the recipient is offline.
// Normalized to lowercase; every type in the app's Notification table maps here.
const PUSHABLE_TYPES = new Set([
  "follow",
  "like",
  "comment",
  "mention",
  "message",
  "group",
  "channel",
  "live",
  "gift",
  "wallet",
  "system",
  "milestone",
]);

const PROVIDERS: Record<string, PushProvider> = {
  webpush: webPushProvider,
  fcm: fcmProvider,
};

const parseDeviceToken = (token: string | unknown): { ok: boolean; error?: string } => {
  if (typeof token !== "string" || token.length < 20 || token.length > 20_000) {
    return { ok: false, error: "Invalid token" };
  }
  return { ok: true };
};
export class PushNotificationService {
  private sendTimestamps = new Map<string, number[]>();

  constructor() {
    this.registerQueueHandlers();
  }

  // --------------------------------------------------------------------------
  // Device registration (authenticated)
  // --------------------------------------------------------------------------

  async registerDevice(
    userId: string,
    input: { token: string; platform?: string; provider?: string; deviceModel?: string; appVersion?: string }
  ) {
    const platform = normalizeEnum(input.platform, ["web", "android", "ios"], "web");
    const provider = normalizeEnum(input.provider, ["webpush", "fcm"], "webpush");

    const token = typeof input.token === "string" ? input.token.trim() : "";
    const valid = parseDeviceToken(token);
    if (!valid.ok) throw new Error(valid.error);

    // Web push tokens must be a valid PushSubscription JSON blob.
    if (provider === "webpush") {
      try {
        const sub = JSON.parse(token);
        if (!sub || typeof sub.endpoint !== "string" || !sub.keys || typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string") {
          throw new Error("bad subscription");
        }
      } catch {
        throw new Error("Token is not a valid web push subscription");
      }
    }
    if (provider === "fcm" && token.length < 20) throw new Error("Token is not a valid FCM registration token");

    // A malicious client must not be able to take over another user's row: the
    // token unique key means an existing row belongs to the current user or we
    // reject it loudly instead of silently re-parenting someone else's device.
    const existing = await prisma.pushDevice.findUnique({ where: { token } });
    if (existing && existing.userId !== userId) {
      throw new Error("Token is already registered to another account");
    }

    if (!existing) {
      const activeCount = await prisma.pushDevice.count({ where: { userId, isActive: true } });
      if (activeCount >= MAX_DEVICES_PER_USER) {
        throw new Error(`Too many active devices (max ${MAX_DEVICES_PER_USER}). Remove an old device first.`);
      }
    }

    const device = await prisma.pushDevice.upsert({
      where: { token },
      update: {
        userId,
        platform,
        provider,
        deviceModel: typeof input.deviceModel === "string" ? input.deviceModel.slice(0, 120) : existing?.deviceModel,
        appVersion: typeof input.appVersion === "string" ? input.appVersion.slice(0, 40) : existing?.appVersion,
        isActive: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        token,
        platform,
        provider,
        deviceModel: typeof input.deviceModel === "string" ? input.deviceModel.slice(0, 120) : undefined,
        appVersion: typeof input.appVersion === "string" ? input.appVersion.slice(0, 40) : undefined,
        lastSeenAt: new Date(),
      },
    });

    console.log(
      JSON.stringify({
        event: "push_token_registered",
        userId,
        deviceId: device.id,
        platform: device.platform,
        provider: device.provider,
        createdAt: new Date().toISOString(),
      })
    );
    return device;
  }

  async listDevices(userId: string) {
    return prisma.pushDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        platform: true,
        provider: true,
        deviceModel: true,
        appVersion: true,
        isActive: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** Deactivate a device (client calls this when the user signs out on a device). */
  async unregisterDevice(userId: string, deviceId: string) {
    const device = await prisma.pushDevice.findFirst({ where: { id: deviceId, userId } });
    if (!device) return false;
    await prisma.pushDevice.update({ where: { id: device.id }, data: { isActive: false } });
    console.log(JSON.stringify({ event: "push_token_invalidated", userId, deviceId: device.id, reason: "unregistered_by_user" }));
    return true;
  }

  async unregisterByToken(userId: string, token: string) {
    const device = await prisma.pushDevice.findUnique({ where: { token } });
    if (!device || device.userId !== userId) return false;
    await prisma.pushDevice.update({ where: { id: device.id }, data: { isActive: false } });
    console.log(JSON.stringify({ event: "push_token_invalidated", userId, deviceId: device.id, reason: "unregistered_by_user" }));
    return true;
  }

  /** Periodically drop devices that have been inactive for a long time. */
  async pruneInactiveDevices(beforeDays: number = 120) {
    const cutoff = new Date(Date.now() - beforeDays * 86_400_000);
    const result = await prisma.pushDevice.updateMany({
      where: { isActive: true, lastSeenAt: { lt: cutoff } },
      data: { isActive: false },
    });
    if (result.count > 0) {
      console.log(JSON.stringify({ event: "push_devices_pruned", count: result.count, beforeDays }));
    }
    return result.count;
  }
// --------------------------------------------------------------------------
  // Send API
  // --------------------------------------------------------------------------

  /**
   * Deliver a push to every ACTIVE device belonging to `userId`.
   *
   * @param opts.onlyIfOffline When true (default), pushes are suppressed for
   *   users with a live Socket.IO connection — their in-app realtime UI already
   *   surfaced the event, so an OS notification would be a duplicate. Call and
   *   other high-priority flows pass false; the service worker performs the
   *   foreground dedup at the device instead.
   */
  async sendToUser(
    userId: string,
    payload: PushNotificationPayload,
    opts: { onlyIfOffline?: boolean } = {}
  ): Promise<PushSendResult[]> {
    if (!payload.eventId) throw new Error("PushNotificationPayload.eventId is required (idempotency)");
    if (opts.onlyIfOffline !== false && presenceRegistry.isConnected(userId)) {
      return [];
    }
    if (!this.throttleAllowed(userId)) {
      console.warn(JSON.stringify({ event: "push_send_throttled", userId, type: payload.type }));
      return [];
    }

    const devices = await prisma.pushDevice.findMany({ where: { userId, isActive: true }, take: MAX_DEVICES_PER_USER });
    if (!devices.length) return [];

    return Promise.all(devices.map((device) => this.deliver(device, payload)));
  }

  async sendToDevices(devices: PushDeviceRecord[], payload: PushNotificationPayload): Promise<PushSendResult[]> {
    return Promise.all(devices.map((device) => this.deliver(device, payload)));
  }
async sendToToken(
    token: string,
    payload: PushNotificationPayload,
    opts: { userId?: string } = {}
  ): Promise<PushSendResult[]> {
    const device = await prisma.pushDevice.findUnique({ where: { token } });
    if (!device || !device.isActive) return [];
    if (opts.userId && device.userId !== opts.userId) return [];
    return [await this.deliver(device, payload)];
  }

  /**
   * Entry point used by NotificationService.createNotification: push a newly
   * created in-app notification to the user's devices while they are offline.
   * Never throws — push failures must never affect notification creation.
   */
  async dispatchForCreatedNotification(notification: {
    id: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    data?: string | null;
  }): Promise<PushSendResult[]> {
    try {
      const type = normalizeType(notification.type);
      if (!PUSHABLE_TYPES.has(type)) return []; // e.g. live_interaction noise
      const data = parseMetadata(notification.data || null);

      return await this.sendToUser(notification.userId, {
        eventId: `notification:${notification.id}`,
        type,
        title: notification.title || type,
        body: notification.message || "",
        data: { ...data, notificationId: notification.id, type },
        priority: type === "wallet" || type === "system" || type === "milestone" ? "high" : "normal",
        renotify: true,
      }, { onlyIfOffline: true });
    } catch (error) {
      console.error("[push] dispatch for created notification failed:", (error as Error)?.message || error);
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Call notifications (highest priority)
  // --------------------------------------------------------------------------

  async notifyIncomingCall(calleeId: string, session: { callId: string; conversationId: string; callerId: string; type: string; callerName?: string }): Promise<PushSendResult[]> {
    if (!(await this.pushEnabledForUser(calleeId))) return [];
    const ttlSeconds = Math.max(45, Math.floor(CALL_RING_TIMEOUT_MS / 1000));
    const tag = `vanta-call-${session.callId}`;
    const callerName = session.callerName?.slice(0, 80) || "Someone";
    return this.sendToUser(calleeId, {
      eventId: `call:${session.callId}`,
      type: "incoming_call",
      title: "📞 Incoming VANTA Call",
      body: `${callerName} is calling you`,
      priority: "high",
      ttlSeconds,
      tag,
      renotify: true,
      requireInteraction: true,
      vibrate: "[[400,200,300,200,400]]",
      sound: "/sounds/vanta-ringtone.mp3",
      icon: "/branding/vanta-icon-192.png",
      actions: [
        { action: "answer", title: "Answer" },
        { action: "decline", title: "Decline" },
      ],
      data: { type: "incoming_call", callId: session.callId, callerId: session.callerId, conversationId: session.conversationId, callType: session.type },
    }, { onlyIfOffline: false });
  }

  /** Push used to dismiss a still-visible incoming-call notification (cancel/answer on another device). */
  async notifyCallResolution(calleeId: string, callId: string, event: Extract<CallPushEvent, "call_cancelled" | "call_answered" | "call_declined" | "call_ended">): Promise<PushSendResult[]> {
    const tag = `vanta-call-${callId}`;
    const labels: Record<string, string> = {
      call_cancelled: "Call cancelled",
      call_answered: "Call answered",
      call_declined: "Call declined",
      call_ended: "Call ended",
    };
    return this.sendToUser(calleeId, {
      eventId: `call-resolve:${callId}:${event}`,
      type: event,
      title: labels[event],
      body: "",
      priority: "normal",
      ttlSeconds: 120,
      tag,
      data: { type: event, callId },
    }, { onlyIfOffline: false });
  }

  async notifyMissedCall(calleeId: string, callId: string, callerName?: string): Promise<PushSendResult[]> {
    if (!(await this.pushEnabledForUser(calleeId))) return [];
    return this.sendToUser(calleeId, {
      eventId: `call-resolve:${callId}:missed_call`,
      type: "missed_call",
      title: "Missed VANTA Call",
      body: callerName ? `${callerName} tried to call you` : "You missed a VANTA call",
      priority: "normal",
      ttlSeconds: 3600,
      tag: `vanta-call-${callId}`,
      data: { type: "missed_call", callId },
    }, { onlyIfOffline: false });
  }
// --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async deliver(device: PushDeviceRecord, payload: PushNotificationPayload): Promise<PushSendResult> {
    try {
      // Idempotency: if this event already reached this device with a terminal
      // outcome, do not push again (retries, multiple workers, FCM redelivery).
      const prior = await prisma.pushDelivery.findUnique({
        where: { eventId_deviceId: { eventId: payload.eventId, deviceId: device.id } },
      });
      if (prior && TERMINAL_STATUSES.has(prior.status)) {
        return { deviceId: device.id, platform: device.platform, provider: device.provider, status: "SKIPPED" };
      }

      const provider = PROVIDERS[device.provider] || webPushProvider;
      if (!provider.isConfigured()) {
        await this.recordDelivery(device, payload, "SKIPPED", `${provider.name} not configured`);
        return { deviceId: device.id, platform: device.platform, provider: device.provider, status: "SKIPPED" };
      }

      metricsCollector.increment("push.attempts", 1, { type: payload.type, platform: device.platform, provider: provider.name });
      console.log(JSON.stringify({
        event: "push_send_started",
        userId: device.userId,
        deviceId: device.id,
        type: payload.type,
        platform: device.platform,
        provider: provider.name,
        eventId: payload.eventId,
      }));

      const result = await provider.send(device, payload);

      if (result.ok) {
        await this.recordDelivery(device, payload, "SENT");
        metricsCollector.increment("push.success", 1, { type: payload.type, platform: device.platform, provider: provider.name });
        console.log(JSON.stringify({ event: "push_send_success", userId: device.userId, deviceId: device.id, type: payload.type, provider: provider.name }));
        return { deviceId: device.id, platform: device.platform, provider: device.provider, status: "SENT" };
      }

      if (result.invalid) {
        // Dead token — never try again. Deactivate the device row.
        await prisma.pushDevice.updateMany({ where: { id: device.id }, data: { isActive: false } });
        await this.recordDelivery(device, payload, "INVALID_TOKEN", result.error);
        metricsCollector.increment("push.invalid_tokens", 1, { type: payload.type, platform: device.platform, provider: provider.name });
        console.log(JSON.stringify({ event: "push_token_invalidated", userId: device.userId, deviceId: device.id, reason: result.error, provider: provider.name }));
        return { deviceId: device.id, platform: device.platform, provider: device.provider, status: "INVALID_TOKEN", error: result.error };
      }
// Transient failure — record and schedule ONE bounded retry via the
      // existing JobQueue (groupId de-dupes the retry job itself).
      await this.recordDelivery(device, payload, "FAILED", result.error);
      metricsCollector.increment("push.failed", 1, { type: payload.type, platform: device.platform, provider: provider.name });
      console.log(JSON.stringify({ event: "push_send_failure", userId: device.userId, deviceId: device.id, type: payload.type, provider: provider.name, error: result.error }));
      await jobQueue.add(PUSH_DELIVER_JOB, { deviceId: device.id, payload }, JOB_PRIORITY.HIGH, {
        groupId: `push:${payload.eventId}:${device.id}`,
        delay: 2_000,
        timeout: 15_000,
      });
      return { deviceId: device.id, platform: device.platform, provider: device.provider, status: "FAILED", error: result.error };
    } catch (error: any) {
      await this.recordDelivery(device, payload, "FAILED", String(error?.message || error).slice(0, 300));
      console.error(`[push] deliver failed for device ${device.id}:`, error?.message || error);
      return { deviceId: device.id, platform: device.platform, provider: device.provider, status: "FAILED", error: error?.message };
    }
  }

  /** Re-fetch a device and deliver (used by the retry job handler). */
  async deliverByDeviceId(deviceId: string, payload: PushNotificationPayload): Promise<PushSendResult | null> {
    const device = await prisma.pushDevice.findUnique({ where: { id: deviceId } });
    if (!device || !device.isActive) return null;
    const prior = await prisma.pushDelivery.findUnique({
      where: { eventId_deviceId: { eventId: payload.eventId, deviceId } },
    });
    if (prior && TERMINAL_STATUSES.has(prior.status)) return null;
    return this.deliver(device, payload);
  }
private async recordDelivery(
    device: PushDeviceRecord,
    payload: PushNotificationPayload,
    status: string,
    error?: string
  ): Promise<void> {
    const data = {
      userId: device.userId,
      eventId: payload.eventId,
      type: payload.type,
      deviceId: device.id,
      platform: device.platform,
      provider: device.provider,
      status,
      error: error ? String(error).slice(0, 500) : null,
    };
    try {
      await prisma.pushDelivery.upsert({
        where: { eventId_deviceId: { eventId: payload.eventId, deviceId: device.id } },
        update: { status, error: data.error, userId: device.userId, type: payload.type },
        create: data,
      });
    } catch (dup) {
      // Unique(eventId, deviceId) violated by a concurrent worker — the other
      // worker already recorded this delivery. Consider the job handled.
    }
  }

  private async pushEnabledForUser(userId: string): Promise<boolean> {
    try {
      const prefs = await prisma.notificationPreferences.findUnique({ where: { userId }, select: { pushAlerts: true } });
      return prefs ? prefs.pushAlerts !== false : true;
    } catch {
      return true;
    }
  }

  /** Lightweight sliding-window throttle per user (anti-abuse; complements the app's API limits). */
  private throttleAllowed(userId: string): boolean {
    const now = Date.now();
    const window = now - 60_000;
    const stamps = (this.sendTimestamps.get(userId) || []).filter((t) => t > window);
    if (stamps.length >= MAX_PUSHES_PER_USER_PER_MINUTE) {
      this.sendTimestamps.set(userId, stamps);
      return false;
    }
    stamps.push(now);
    this.sendTimestamps.set(userId, stamps);
    return true;
  }

  private registerQueueHandlers(): void {
    jobQueue.registerHandler(PUSH_DELIVER_JOB, async (job: any) => {
      const { deviceId, payload } = job.data || {};
      if (!deviceId || !payload?.eventId) return;
      await this.deliverByDeviceId(deviceId, payload);
    });
    jobQueue.registerHandler(CALL_EXPIRE_JOB, async () => {
      await this.expireStaleCalls();
    });
  }

  /** Mark RINGING call sessions past their timeout as EXPIRED and push a missed-call notice. */
  async expireStaleCalls(): Promise<number> {
    const now = new Date();
    const stale = await prisma.callSession.findMany({
      where: { status: "RINGING", expiresAt: { lt: now } },
      select: { callId: true, calleeId: true, callerId: true },
      take: 200,
    });
    if (!stale.length) return 0;
    await prisma.callSession.updateMany({
      where: { callId: { in: stale.map((s) => s.callId) } },
      data: { status: "EXPIRED" },
    });
    for (const session of stale) {
      try {
        await this.notifyMissedCall(session.calleeId, session.callId);
      } catch (error) {
        console.error("[push:call] missed-call push failed:", (error as Error)?.message);
      }
    }
    return stale.length;
  }
}

export const pushNotificationService = new PushNotificationService();

// Every 5 minutes, expire stale call sessions and prune long-inactive devices.
const maintenanceTimer = setInterval(() => {
  void pushNotificationService.expireStaleCalls().catch(() => undefined);
  void pushNotificationService.pruneInactiveDevices(120).catch(() => undefined);
}, 300_000);
maintenanceTimer.unref?.();

function normalizeEnum(value: unknown, allowed: string[], fallback: string): string {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(v) ? v : fallback;
}

function normalizeType(type: string): string {
  return String(type || "").trim().toLowerCase();
}

function parseMetadata(data: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}