import type { PushDeviceRecord, PushNotificationPayload } from "../services/push/push-types";

describe("FCM modular SDK integration", () => {
  const keys = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_CREDENTIALS_JSON", "GOOGLE_APPLICATION_CREDENTIALS"] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const device: PushDeviceRecord = { id: "test-device", userId: "test-user", token: "synthetic-token-not-for-delivery", platform: "web", provider: "fcm", isActive: true, lastSeenAt: new Date() };
  const payload: PushNotificationPayload = { eventId: "test-event", type: "system", title: "Test", body: "Synthetic message" };
  const app = { name: "[DEFAULT]", options: { projectId: "synthetic-project" } };
  const cert = jest.fn();
  const applicationDefault = jest.fn();
  const initializeApp = jest.fn();
  const getApps = jest.fn();
  const getApp = jest.fn();
  const sendEachForMulticast = jest.fn();
  const getMessaging = jest.fn();

  function load() {
    jest.doMock("firebase-admin/app", () => ({ cert, applicationDefault, initializeApp, getApps, getApp }));
    jest.doMock("firebase-admin/messaging", () => ({ getMessaging }));
    return require("../services/push/fcm.provider").fcmProvider as typeof import("../services/push/fcm.provider").fcmProvider;
  }

  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    for (const key of keys) delete process.env[key];
    cert.mockReturnValue({ synthetic: true });
    initializeApp.mockReturnValue(app);
    getApps.mockReturnValue([]);
    getApp.mockReturnValue(app);
    getMessaging.mockReturnValue({ sendEachForMulticast });
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }] });
  });

  afterEach(() => {
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.dontMock("firebase-admin/app");
    jest.dontMock("firebase-admin/messaging");
    jest.resetModules();
  });

  it("remains disabled when credentials are absent", async () => {
    const provider = load();
    expect(provider.isConfigured()).toBe(false);
    expect((await provider.send(device, payload)).ok).toBe(false);
    expect(initializeApp).not.toHaveBeenCalled();
    expect(getMessaging).not.toHaveBeenCalled();
  });

  it("initializes the modular app and sends through its messaging instance", async () => {
    process.env.FIREBASE_PROJECT_ID = "synthetic-project";
    process.env.FIREBASE_CREDENTIALS_JSON = JSON.stringify({ project_id: "synthetic-project", client_email: "synthetic@example.invalid", private_key: "test-only" });
    const provider = load();
    expect(provider.isConfigured()).toBe(true);
    expect(cert).toHaveBeenCalledWith(expect.objectContaining({ project_id: "synthetic-project" }));
    expect(initializeApp).toHaveBeenCalledWith({ credential: { synthetic: true }, projectId: "synthetic-project" });
    expect(getMessaging).toHaveBeenCalledWith(app);
    expect(await provider.send(device, payload)).toEqual({ ok: true });
    expect(sendEachForMulticast).toHaveBeenCalledWith(expect.objectContaining({ tokens: [device.token], notification: { title: payload.title, body: payload.body } }));
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it("uses application-default credentials and reuses only the default app for the configured project", () => {
    process.env.FIREBASE_PROJECT_ID = "synthetic-project";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/synthetic/test-only.json";
    getApps.mockReturnValue([app]);
    const provider = load();
    expect(provider.isConfigured()).toBe(true);
    expect(applicationDefault).toHaveBeenCalledTimes(1);
    expect(getApp).toHaveBeenCalledTimes(1);
    expect(initializeApp).not.toHaveBeenCalled();
    expect(getMessaging).toHaveBeenCalledWith(app);
  });

  it("retains invalid-token handling", async () => {
    process.env.FIREBASE_PROJECT_ID = "synthetic-project";
    process.env.FIREBASE_CREDENTIALS_JSON = "{}";
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: false, error: { code: "messaging/registration-token-not-registered" } }] });
    const provider = load();
    expect(await provider.send(device, payload)).toMatchObject({ ok: false, invalid: true });
  });
});
