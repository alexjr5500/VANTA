"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { storage } from '@/lib/platformStorage';
import { authGetMe, authRefreshToken, authLogout } from '@/lib/authApi';
import type { AuthUser } from '@/lib/authApi';
import { ApiError } from '@/lib/api';
import { invalidateCache } from '@/lib/apiClient';
import { emitProfileMediaUpdate, versionMediaUrl } from '@/lib/profileMedia';

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
  login: (userData: AuthUser, accessToken: string, refreshToken?: string) => void;
  updateUser: (userData: Partial<AuthUser>, options?: { versionMedia?: boolean }) => Promise<AuthUser | null>;
  logout: () => void;
  isLoading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  isRefreshing: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_STORAGE_KEY = 'vanta_token';
const REFRESH_TOKEN_STORAGE_KEY = 'vanta_refresh_token';
const USER_STORAGE_KEY = 'vanta_user';
// Legacy pre-VANTA auth keys: read/migrated once and removed so existing
// sessions carry over seamlessly to the vanta_* storage keys.
const LEGACY_STORAGE_KEYS = ['sparklive_token', 'sparklive_refresh_token', 'sparklive_user'] as const;
const USER_SYNC_CHANNEL = 'vanta-user-sync';
const REFRESH_TOKEN_INTERVAL = 5 * 60 * 1000; // Refresh every 5 minutes

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const userRef = useRef<AuthUser | null>(null);
  const tokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null);
  
  const router = useRouter();
  const pathname = usePathname();

  const updateUser = useCallback(async (
    userData: Partial<AuthUser>,
    options: { versionMedia?: boolean } = {},
  ) => {
    const currentUser = userRef.current || user;
    if (!currentUser) return null;
    const version = Date.now();
    const incomingAvatar = userData.avatar ?? userData.avatarUrl;
    const incomingBanner = userData.bannerUrl;
    const avatar = options.versionMedia && incomingAvatar !== undefined
      ? versionMediaUrl(incomingAvatar, version)
      : incomingAvatar;
    const bannerUrl = options.versionMedia && incomingBanner !== undefined
      ? versionMediaUrl(incomingBanner, version)
      : incomingBanner;
    const nextUser: AuthUser = {
      ...currentUser,
      ...userData,
      ...(incomingAvatar !== undefined ? { avatar, avatarUrl: avatar } : {}),
      ...(incomingBanner !== undefined ? { bannerUrl } : {}),
    };
    const mediaUpdate = {
      userId: currentUser.id,
      avatar,
      bannerUrl,
      previousAvatar: currentUser.avatar ?? currentUser.avatarUrl,
      previousBannerUrl: currentUser.bannerUrl,
      updatedAt: version,
    };
    setUser(nextUser);
    userRef.current = nextUser;
    emitProfileMediaUpdate(mediaUpdate);
    await storage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(USER_SYNC_CHANNEL);
      channel.postMessage({ user: nextUser, mediaUpdate });
      channel.close();
    }
    invalidateCache();
    return nextUser;
  }, [user]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    refreshTokenRef.current = refreshToken;
  }, [refreshToken]);

  // localStorage is shared by tabs. Keep rotated credentials synchronized so
  // one tab cannot continue using (and later reject) another tab's old token.
  useEffect(() => {
    const syncStoredSession = (event: StorageEvent) => {
      if (event.key === TOKEN_STORAGE_KEY) {
        setToken(event.newValue);
        tokenRef.current = event.newValue;
      } else if (event.key === REFRESH_TOKEN_STORAGE_KEY) {
        setRefreshToken(event.newValue);
        refreshTokenRef.current = event.newValue;
      } else if (event.key === USER_STORAGE_KEY) {
        if (!event.newValue) {
          setUser(null);
          userRef.current = null;
          return;
        }
        try {
          const nextUser = JSON.parse(event.newValue) as AuthUser;
          setUser(nextUser);
          userRef.current = nextUser;
        } catch {
          // Ignore malformed cached profile data; /me remains authoritative.
        }
      }
    };
    window.addEventListener('storage', syncStoredSession);
    return () => window.removeEventListener('storage', syncStoredSession);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(USER_SYNC_CHANNEL);
    channel.onmessage = ({ data }) => {
      if (!data?.user) return;
      setUser(data.user);
      userRef.current = data.user;
      if (data.mediaUpdate) emitProfileMediaUpdate(data.mediaUpdate);
      invalidateCache();
    };
    return () => channel.close();
  }, []);

  // Clear session
  const clearSession = useCallback(async () => {
    setToken(null);
    setRefreshToken(null);
    setUser(null);
    tokenRef.current = null;
    refreshTokenRef.current = null;
    userRef.current = null;
    await storage.removeItem(TOKEN_STORAGE_KEY);
    await storage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    await storage.removeItem(USER_STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) await storage.removeItem(key);
  }, []);

  // Refresh access token
  const refreshAccessToken = useCallback(async (currentRefreshToken: string) => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    setIsRefreshing(true);
    const refreshPromise = (async () => {
      const executeRefresh = async () => {
        let attemptedRefreshToken = currentRefreshToken;
        try {
          // Another tab may have rotated the token while this caller waited.
          const latestRefreshToken = await storage.getItem(REFRESH_TOKEN_STORAGE_KEY);
          attemptedRefreshToken = latestRefreshToken || currentRefreshToken;
          const response = await authRefreshToken({ refreshToken: attemptedRefreshToken });
          if (!response.token) return null;

          setToken(response.token);
          tokenRef.current = response.token;
          await storage.setItem(TOKEN_STORAGE_KEY, response.token);

          if (response.refreshToken) {
            setRefreshToken(response.refreshToken);
            refreshTokenRef.current = response.refreshToken;
            await storage.setItem(REFRESH_TOKEN_STORAGE_KEY, response.refreshToken);
          }
          return response.token;
        } catch (error) {
          // Only a definitive 401 from the refresh endpoint invalidates the
          // session. Keep the stored session through outages/restarts.
          if (error instanceof ApiError && error.statusCode === 401) {
            // A second tab may have rotated the token while this request was
            // in flight. Never erase a newer persisted session.
            const latestRefreshToken = await storage.getItem(REFRESH_TOKEN_STORAGE_KEY);
            if (!latestRefreshToken || latestRefreshToken === attemptedRefreshToken) {
              await clearSession();
              setError('Session expired. Please log in again.');
            }
          } else {
            console.warn('Token refresh temporarily unavailable');
          }
          return null;
        }
      };

      try {
        // Web Locks serializes refresh-token rotation across tabs and provider
        // remounts. Fall back to the in-tab single-flight guard where absent.
        if (typeof navigator !== 'undefined' && navigator.locks) {
          return await navigator.locks.request('vanta-auth-token-refresh', executeRefresh);
        }
        return await executeRefresh();
      } finally {
        setIsRefreshing(false);
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [clearSession]);

  // Restore session from storage
  const restoreSession = useCallback(async () => {
    try {
      const readMigrated = async (key: string, legacyKey: string) => {
        const current = await storage.getItem(key);
        if (current) return current;
        const legacy = await storage.getItem(legacyKey);
        if (legacy) await storage.setItem(key, legacy);
        return legacy;
      };
      const storedToken = await readMigrated(TOKEN_STORAGE_KEY, LEGACY_STORAGE_KEYS[0]);
      const storedRefreshToken = await readMigrated(REFRESH_TOKEN_STORAGE_KEY, LEGACY_STORAGE_KEYS[1]);
      const storedUser = await readMigrated(USER_STORAGE_KEY, LEGACY_STORAGE_KEYS[2]);

      if (storedToken || storedRefreshToken) {
        // Restore state from storage immediately
        if (storedToken) {
          setToken(storedToken);
          tokenRef.current = storedToken;
        }
        setRefreshToken(storedRefreshToken);
        refreshTokenRef.current = storedRefreshToken;
        if (storedUser) {
          try {
            const parsedUser: AuthUser = JSON.parse(storedUser);
            setUser(parsedUser);
            userRef.current = parsedUser;
          } catch {
            // The token can still be validated and the user reconstructed
            // from /me; do not destroy the session because cached UI data is
            // malformed.
          }
        }

        // Verify the access token when available. Refresh-only sessions are
        // recovered without manufacturing client-side authentication state.
        try {
          if (!storedToken) {
            const newToken = await refreshAccessToken(storedRefreshToken!);
            if (newToken) {
              const response = await authGetMe(newToken);
              if (response.user) {
                setUser(response.user);
                userRef.current = response.user;
                await storage.setItem(USER_STORAGE_KEY, JSON.stringify(response.user));
              }
            }
            setIsLoading(false);
            return;
          }
          const response = await authGetMe(storedToken);
          if (response.user) {
            setUser(response.user);
            userRef.current = response.user;
            await storage.setItem(USER_STORAGE_KEY, JSON.stringify(response.user));
          }
        } catch (error) {
          const statusCode = error instanceof ApiError ? error.statusCode : undefined;
          // An expired access token can be recovered. Transient failures keep
          // the persisted session and cached user available for retry.
          if (storedRefreshToken) {
            const newToken = await refreshAccessToken(storedRefreshToken);
            if (newToken || statusCode !== 401) {
              setIsLoading(false);
              return;
            }
          }
          if (statusCode === 401 && !refreshTokenRef.current) await clearSession();
        }

        setIsLoading(false);
        return;
      }
    } catch (error) {
      console.error('Failed to restore auth session', error);
      // A temporary storage/platform failure is not proof that the session is
      // invalid. Leave persisted credentials untouched for the next recovery.
    }

    // Only reach here if no stored token was found — mark loading as complete
    setIsLoading(false);
  }, [clearSession, refreshAccessToken]);

  // Login
  const login = useCallback(async (userData: AuthUser, accessToken: string, newRefreshToken?: string) => {
    setToken(accessToken);
    setRefreshToken(newRefreshToken || null);
    setUser(userData);
    tokenRef.current = accessToken;
    refreshTokenRef.current = newRefreshToken || null;
    userRef.current = userData;
    setError(null);
    
    await storage.setItem(TOKEN_STORAGE_KEY, accessToken);
    await storage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    
    if (newRefreshToken) {
      await storage.setItem(REFRESH_TOKEN_STORAGE_KEY, newRefreshToken);
    } else {
      await storage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    if (token) {
      try {
        await authLogout(token);
      } catch (error) {
        console.warn('Logout API call failed:', error);
        // Continue with local logout even if API fails
      }
    }
    
    await clearSession();
    setError(null);
    router.push('/login');
  }, [token, clearSession, router]);

  // Restore session on mount
  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // API requests report an actual 401 here. Recover first; only the refresh
  // endpoint can conclude that the persistent session is genuinely invalid.
  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      const expiredToken = (event as CustomEvent<{ token?: string }>).detail?.token;
      // Ignore a late 401 from a request that used a token already replaced by
      // a successful refresh.
      if (expiredToken && tokenRef.current && expiredToken !== tokenRef.current) return;
      const storedRefreshToken = refreshTokenRef.current;
      if (storedRefreshToken) {
        void refreshAccessToken(storedRefreshToken);
      } else {
        // Storage can be populated before React commits provider state (login,
        // hydration, or a cross-tab rotation). Re-read it before concluding
        // that the persistent session is absent.
        void storage.getItem(REFRESH_TOKEN_STORAGE_KEY).then((persistedRefreshToken) => {
          if (persistedRefreshToken) {
            setRefreshToken(persistedRefreshToken);
            refreshTokenRef.current = persistedRefreshToken;
            void refreshAccessToken(persistedRefreshToken);
          } else {
            void clearSession();
          }
        });
      }
    };
    window.addEventListener('vanta-auth-expired', handleAuthExpired);
    return () => window.removeEventListener('vanta-auth-expired', handleAuthExpired);
  }, [clearSession, refreshAccessToken]);

  // A development compile or short outage can make initial validation fail.
  // Keep the persistent session and retry when connectivity/app focus returns.
  useEffect(() => {
    const recoverPersistedSession = () => {
      if (tokenRef.current || !refreshTokenRef.current || refreshInFlightRef.current) return;
      void refreshAccessToken(refreshTokenRef.current);
    };
    window.addEventListener('online', recoverPersistedSession);
    window.addEventListener('focus', recoverPersistedSession);
    return () => {
      window.removeEventListener('online', recoverPersistedSession);
      window.removeEventListener('focus', recoverPersistedSession);
    };
  }, [refreshAccessToken]);

  // Set up token refresh interval
  useEffect(() => {
    if (!token || !refreshToken) return;

    const interval = setInterval(async () => {
      await refreshAccessToken(refreshToken);
    }, REFRESH_TOKEN_INTERVAL);

    return () => clearInterval(interval);
  }, [token, refreshToken, refreshAccessToken]);

  // Handle public/private routes
  useEffect(() => {
    if (isLoading) return;

    const publicRoutes = ['/login', '/register', '/forgot-password', '/'];
    const isPublicRoute = publicRoutes.includes(pathname);

    // A refresh token represents a recoverable persisted session. Do not turn
    // a temporary API/dev-server outage into a logout while recovery retries.
    if (!token && !refreshToken && !isPublicRoute) {
      router.push('/login');
    } else if (token && isPublicRoute) {
      // After login/signup/password reset or root landing entry, always land on the Reels feed
      router.push('/reels');
    }
  }, [isLoading, token, refreshToken, pathname, router]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        refreshToken,
        login,
        updateUser,
        logout,
        isLoading,
        error,
        setError,
        isRefreshing,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

