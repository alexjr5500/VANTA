'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  getPermissionState,
  isPushSupported,
  registerServiceWorker,
  subscribeAndRegister,
  unsubscribeAndUnregister,
  type PushPermissionState,
} from '@/lib/pushClient';
import { fetchPushConfig } from '@/lib/pushApi';

// ============================================================================
// PushProvider — global OS-push state for the signed-in user.
//
// * Registers the VANTA service worker.
// * NEVER prompts for notification permission on its own (Android 13+ UX):
//   it passively registers when permission is already granted and reports
//   the state so the Settings screen can give the user an explicit opt-in.
// * Re-subscribes when the browser rotates the push subscription
//   (pushsubscriptionchange) and unregisters the device on logout.
// ============================================================================

export type PushStatus =
  | 'unsupported'
  | 'unconfigured'
  | 'permission-pending'
  | 'permission-denied'
  | 'granted'
  | 'enabled'
  | 'error';

interface PushContextValue {
  supported: boolean;
  status: PushStatus;
  permission: PushPermissionState;
  deviceId: string | null;
  enablePush: () => Promise<{ ok: boolean; reason?: string }>;
  disablePush: () => Promise<void>;
}

const PushContext = createContext<PushContextValue | undefined>(undefined);

export function PushProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<PushStatus>('unsupported');
  const [permission, setPermission] = useState<PushPermissionState>('default');
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const refreshing = useRef(false);
  const lastTokenRef = useRef<string | null>(null);

  /** Passive sync: register the SW + register the device IF permission is granted. */
  const syncPassive = useCallback(async (requestPermission: boolean): Promise<{ ok: boolean; reason?: string }> => {
    if (!token || !user) return { ok: false, reason: 'no-session' };
    if (!isPushSupported()) {
      setStatus('unsupported');
      setSupported(false);
      return { ok: false, reason: 'unsupported' };
    }
    setSupported(true);

    if (refreshing.current) return { ok: false, reason: 'in-flight' };
    refreshing.current = true;
    try {
      const config = await fetchPushConfig();
      if (!config || !config.vapidPublicKey) {
        setStatus('unconfigured');
        return { ok: false, reason: 'not-configured' };
      }

      await registerServiceWorker();
      const currentPermission = await getPermissionState().catch(() => 'default' as PushPermissionState);
      setPermission(currentPermission);

      if (currentPermission === 'denied' && !requestPermission) {
        setStatus('permission-denied');
        return { ok: false, reason: 'permission-denied' };
      }
      if (currentPermission === 'default' && !requestPermission) {
        setStatus('permission-pending');
        return { ok: false, reason: 'permission-pending' };
      }

      const result = await subscribeAndRegister(token, { requestPermission });
      if (result.ok) {
        setDeviceId(result.deviceId || null);
        lastTokenRef.current = token;
        setStatus(result.permission === 'denied' ? 'permission-denied' : 'enabled');
        return { ok: true };
      }
      setPermission(result.permission || currentPermission);
      if (result.reason === 'permission-denied') setStatus('permission-denied');
      else if (result.reason === 'permission-pending') setStatus('permission-pending');
      else setStatus('error');
      return { ok: false, reason: result.reason };
    } finally {
      refreshing.current = false;
    }
  }, [token, user]);

  useEffect(() => {
    void syncPassive(false);
  }, [syncPassive]);

  // Re-sync when the window regains focus and the browser rotated the
  // subscription (handled by the service worker's pushsubscriptionchange).
  useEffect(() => {
    const onFocus = () => {
      if (!refreshing.current) void syncPassive(false);
    };
    const onSwMessage = (event: MessageEvent) => {
      const data = (event as any).data;
      if (data && typeof data === 'object' && data.type === 'vanta-push-subscription-changed') {
        void syncPassive(false);
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('message', onSwMessage);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('message', onSwMessage);
    };
  }, [syncPassive]);

  // Logout: best-effort deactivate this device's token server-side.
  useEffect(() => {
    if (!token && lastTokenRef.current) {
      const hadToken = lastTokenRef.current;
      void unsubscribeAndUnregister(hadToken).finally(() => {
        setDeviceId(null);
        setStatus('unsupported');
        lastTokenRef.current = null;
      });
    }
  }, [token]);

  const enablePush = useCallback(async () => {
    const result = await syncPassive(true);
    if (!result.ok && result.reason === 'permission-denied') setStatus('permission-denied');
    return result;
  }, [syncPassive]);

  const disablePush = useCallback(async () => {
    await unsubscribeAndUnregister(token);
    setDeviceId(null);
    setStatus('permission-pending');
  }, [token]);

  const value: PushContextValue = {
    supported,
    status,
    permission,
    deviceId,
    enablePush,
    disablePush,
  };

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush(): PushContextValue {
  const context = useContext(PushContext);
  if (!context) throw new Error('usePush must be used within PushProvider');
  return context;
}