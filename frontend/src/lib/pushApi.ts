import { apiDelete, apiGet, apiPost } from "./apiClient";

// ============================================================================
// Push notification API helpers (device token registration).
// ============================================================================

export interface PushProviderStatus {
  webpush: boolean;
  fcm: boolean;
}

export interface PushConfig {
  serviceWorkerPath: string;
  /** VAPID public key (URL-safe base64) used as the PushManager applicationServerKey. */
  vapidPublicKey: string;
  icon: string;
  sound: string;
  providers: PushProviderStatus;
}

export interface PushDeviceDto {
  id: string;
  platform: string;
  provider: string;
  deviceModel?: string | null;
  appVersion?: string | null;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export const fetchPushConfig = async (): Promise<PushConfig | null> => {
  try {
    const response = await apiGet<{ success?: boolean; config?: PushConfig }>("/api/push/config", undefined, {
      skipCache: true,
    });
    return response?.config || null;
  } catch {
    return null;
  }
};

export const registerDevice = async (
  token: string,
  input: { platform?: string; provider?: string; deviceModel?: string; appVersion?: string },
  authToken: string
): Promise<PushDeviceDto | null> => {
  try {
    const response = await apiPost<{ device?: PushDeviceDto }>(
      "/api/push/devices",
      {
        token,
        platform: input.platform,
        provider: input.provider,
        deviceModel: input.deviceModel,
        appVersion: input.appVersion,
      },
      authToken
    );
    return response?.device || null;
  } catch {
    return null;
  }
};

export const listDevices = async (authToken: string): Promise<PushDeviceDto[]> => {
  try {
    const response = await apiGet<{ devices?: PushDeviceDto[] }>("/api/push/devices", authToken, { skipCache: true });
    return response?.devices || [];
  } catch {
    return [];
  }
};

export const unregisterDeviceById = async (deviceId: string, authToken: string): Promise<boolean> => {
  try {
    await apiDelete(`/api/push/devices/${encodeURIComponent(deviceId)}`, authToken);
    return true;
  } catch {
    return false;
  }
};

export const unregisterDeviceByToken = async (token: string, authToken: string): Promise<boolean> => {
  try {
    await apiDelete("/api/push/devices", authToken, { token });
    return true;
  } catch {
    return false;
  }
};