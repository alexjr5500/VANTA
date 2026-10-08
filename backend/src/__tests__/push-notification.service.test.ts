// ============================================================================
// PushNotificationService unit tests.
//
// The prisma client and the web-push provider are mocked so no network or
// database calls ever happen. Covers token registration security, device
// management, offline suppression, idempotency, dead-token cleanup, and the
// notification-type gate.
// ============================================================================

import { PushNotificationService } from "../services/push/push-notification.service";
import { presenceRegistry } from "../services/push/presence-registry";
import { webPushProvider } from "../services/push/web-push.provider";
import { prisma } from "../prisma";

jest.mock("../prisma", () => ({
  prisma: {
    pushDevice: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    pushDelivery: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    notificationPreferences: {
      findUnique: jest.fn(),
    },
    callSession: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock("../services/push/web-push.provider", () => ({
  webPushProvider: {
    name: "webpush",
    isConfigured: jest.fn().mockReturnValue(false),
    send: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

const pushService = new PushNotificationService();

const validSubscription = JSON.stringify({
  endpoint: "https://push.example.com/send/abc123",
  expirationTime: null,
  keys: { p256dh: "p256dhValueForTests".repeat(3), auth: "authValueForTests".repeat(2) },
});

const deviceRow = (overrides: Record<string, unknown> = {}) => ({
  id: "device1",
  userId: "user1",
  token: validSubscription,
  platform: "web",
  provider: "webpush",
  deviceModel: null,
  appVersion: null,
  isActive: true,
  lastSeenAt: new Date(),
  ...overrides,
});

const payload = {
  eventId: "notification:n1",
  type: "message",
  title: "New Message",
  body: "Hello",
};

describe("PushNotificationService — device registration", () => {
  beforeEach(() => jest.clearAllMocks());

  test("registers an active device for an authenticated user", async () => {
    (prisma.pushDevice.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.pushDevice.count as jest.Mock).mockResolvedValue(0);
    (prisma.pushDevice.upsert as jest.Mock).mockResolvedValue(deviceRow());

    const device = await pushService.registerDevice("user1", {
      token: validSubscription,
      platform: "web",
      provider: "webpush",
      deviceModel: "Pixel 9",
      appVersion: "1.0.0",
    });

    expect(device).toBeTruthy();
    expect(prisma.pushDevice.upsert).toHaveBeenCalled();
  });

  test("rejects a malformed web push token", async () => {
    // Valid length + valid JSON, but missing the subscription keys → rejected.
    const malformed = JSON.stringify({ endpoint: "https://push.example.com/send/xxxxxx".repeat(2) });
    await expect(
      pushService.registerDevice("user1", { token: malformed, provider: "webpush" })
    ).rejects.toThrow(/not a valid web push subscription/);
    expect(prisma.pushDevice.upsert).not.toHaveBeenCalled();
  });

  test("refuses to let one user take over another user's device token", async () => {
    (prisma.pushDevice.findUnique as jest.Mock).mockResolvedValue(deviceRow({ userId: "user2" }));
    await expect(
      pushService.registerDevice("user1", { token: validSubscription })
    ).rejects.toThrow(/already registered to another account/);
    expect(prisma.pushDevice.upsert).not.toHaveBeenCalled();
  });

  test("caps the number of active devices per user", async () => {
    (prisma.pushDevice.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.pushDevice.count as jest.Mock).mockResolvedValue(20);
    await expect(
      pushService.registerDevice("user1", { token: validSubscription })
    ).rejects.toThrow(/Too many active devices/);
  });

  test("re-registering the same token only updates metadata", async () => {
    (prisma.pushDevice.findUnique as jest.Mock).mockResolvedValue(deviceRow());
    (prisma.pushDevice.upsert as jest.Mock).mockResolvedValue(deviceRow());
    await pushService.registerDevice("user1", { token: validSubscription, appVersion: "1.1.0" });
    const options = (prisma.pushDevice.upsert as jest.Mock).mock.calls[0][0];
    expect(options.update).toBeDefined();
    expect(options.update.isActive).toBe(true);
  });
});
describe("PushNotificationService — device management", () => {
  beforeEach(() => jest.clearAllMocks());

  test("unregister only deactivates the caller's own device", async () => {
    (prisma.pushDevice.findFirst as jest.Mock).mockResolvedValue(deviceRow());
    const ok = await pushService.unregisterDevice("user1", "device1");
    expect(ok).toBe(true);
    expect(prisma.pushDevice.update).toHaveBeenCalled();
  });

  test("unregister is a no-op for another user's device", async () => {
    (prisma.pushDevice.findFirst as jest.Mock).mockResolvedValue(null);
    const ok = await pushService.unregisterDevice("user1", "device1");
    expect(ok).toBe(false);
  });
});

describe("PushNotificationService — delivery", () => {
  beforeEach(() => jest.clearAllMocks());

  test("skips push while the user holds a live socket connection (foreground dedup)", async () => {
    (webPushProvider.isConfigured as jest.Mock).mockReturnValue(true);
    presenceRegistry.addConnection("user1", "socket-a");
    try {
      const results = await pushService.sendToUser("user1", payload);
      expect(results).toEqual([]);
      expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
    } finally {
      presenceRegistry.removeConnection("user1", "socket-a");
    }
  });

  test("returns SKIPPED when no provider is configured (no crash, no retry loop)", async () => {
    (webPushProvider.isConfigured as jest.Mock).mockReturnValue(false);
    (prisma.pushDevice.findMany as jest.Mock).mockResolvedValue([deviceRow()]);
    (prisma.pushDelivery.findUnique as jest.Mock).mockResolvedValue(null);

    const results = await pushService.sendToUser("user1", payload);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("SKIPPED");
    expect(webPushProvider.send).not.toHaveBeenCalled();
  });

  test("does not resend an event already delivered to a device (idempotency)", async () => {
    (webPushProvider.isConfigured as jest.Mock).mockReturnValue(true);
    (prisma.pushDevice.findMany as jest.Mock).mockResolvedValue([deviceRow()]);
    (prisma.pushDelivery.findUnique as jest.Mock).mockResolvedValue({ id: "pd1", status: "SENT" });

    const results = await pushService.sendToUser("user1", payload);
    expect(results[0].status).toBe("SKIPPED");
    expect(webPushProvider.send).not.toHaveBeenCalled();
  });

  test("sends successfully and records the delivery", async () => {
    (webPushProvider.isConfigured as jest.Mock).mockReturnValue(true);
    (webPushProvider.send as jest.Mock).mockResolvedValue({ ok: true });
    (prisma.pushDevice.findMany as jest.Mock).mockResolvedValue([deviceRow()]);
    (prisma.pushDelivery.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.pushDelivery.upsert as jest.Mock).mockResolvedValue({});

    const results = await pushService.sendToUser("user1", payload);
    expect(results[0].status).toBe("SENT");
    expect(webPushProvider.send).toHaveBeenCalledTimes(1);
    expect(prisma.pushDelivery.upsert).toHaveBeenCalled();
  });

  test("marks the device inactive when the provider says the token is dead", async () => {
    (webPushProvider.isConfigured as jest.Mock).mockReturnValue(true);
    (webPushProvider.send as jest.Mock).mockResolvedValue({ ok: false, invalid: true, error: "410 Gone" });
    (prisma.pushDevice.findMany as jest.Mock).mockResolvedValue([deviceRow()]);
    (prisma.pushDelivery.findUnique as jest.Mock).mockResolvedValue(null);

    const results = await pushService.sendToUser("user1", payload);
    expect(results[0].status).toBe("INVALID_TOKEN");
    // Dead token → deactivated so we never try again.
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } })
    );
  });

  test("requires an eventId (idempotency contract)", async () => {
    await expect(
      pushService.sendToUser("user1", { ...payload, eventId: "" })
    ).rejects.toThrow(/eventId/);
  });
});

describe("PushNotificationService — notification dispatch gate", () => {
  beforeEach(() => jest.clearAllMocks());

  test("pushes only supported (non-noise) notification types", async () => {
    (prisma.pushDevice.findMany as jest.Mock).mockResolvedValue([]);
    const noisy = await pushService.dispatchForCreatedNotification({
      id: "n1", userId: "user1", type: "LIVE_INTERACTION", title: "t", message: "m",
    });
    expect(noisy).toEqual([]);
    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();

    const supported = await pushService.dispatchForCreatedNotification({
      id: "n2", userId: "user1", type: "follow", title: "New Follower", message: "x followed you", data: "{}",
    });
    expect(supported).toEqual([]); // no devices — still a clean no-op
  });
});