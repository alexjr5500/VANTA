import { Request, Response } from "express";
import { pushNotificationService } from "../services/push/push-notification.service";
import { webPushProvider } from "../services/push/web-push.provider";
import { fcmProvider } from "../services/push/fcm.provider";

// ============================================================================
// Push device REST handlers (all authenticated).
// ============================================================================

const toPublicDevice = (device: any) => ({
  id: device.id,
  platform: device.platform,
  provider: device.provider,
  deviceModel: device.deviceModel,
  appVersion: device.appVersion,
  isActive: device.isActive,
  lastSeenAt: device.lastSeenAt,
  createdAt: device.createdAt,
  updatedAt: device.updatedAt,
});

export const registerDevice = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as {
      token?: string;
      platform?: string;
      provider?: string;
      deviceModel?: string;
      appVersion?: string;
    };
    const device = await pushNotificationService.registerDevice(userId, {
      token: typeof body.token === "string" ? body.token : "",
      platform: body.platform,
      provider: body.provider,
      deviceModel: body.deviceModel,
      appVersion: body.appVersion,
    });
    res.status(200).json({ success: true, device: toPublicDevice(device) });
  } catch (error: any) {
    const message = error?.message || "Could not register push device";
    const status = /already registered|Too many active devices|Invalid token|not a valid/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
};

export const listDevices = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const devices = await pushNotificationService.listDevices(userId);
    res.status(200).json({ success: true, devices: devices.map(toPublicDevice) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Could not list push devices" });
  }
};

export const unregisterDevice = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const removed = await pushNotificationService.unregisterDevice(userId, req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Push device not found" });
      return;
    }
    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Could not unregister push device" });
  }
};

export const unregisterByToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = typeof (req.body || {}).token === "string" ? (req.body as any).token : "";
    if (!token) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    const removed = await pushNotificationService.unregisterByToken(userId, token);
    res.status(200).json({ success: true, removed });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Could not unregister push device" });
  }
};

/**
 * Public, read-only push configuration so the PWA can subscribe without any
 * secret. Exposes ONLY the VAPID public key (required by the browser for
 * `pushManager.subscribe({ applicationServerKey })`), asset URLs and which
 * providers are enabled. Never exposes private keys or credentials.
 */
export const getPushConfig = async (_req: Request, res: Response): Promise<void> => {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY || "";
  res.status(200).json({
    success: true,
    config: {
      serviceWorkerPath: "/vanta-sw.js",
      vapidPublicKey,
      icon: "/branding/vanta-icon-192.png",
      sound: "/sounds/vanta-ringtone.mp3",
      providers: {
        webpush: webPushProvider.isConfigured(),
        fcm: fcmProvider.isConfigured(),
      },
    },
  });
};