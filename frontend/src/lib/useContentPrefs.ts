import { useCallback, useEffect, useState } from 'react';

/**
 * Device-local content & media preferences, synchronized with the Content &
 * Media Settings page (which persists them under the same localStorage key
 * via useLocalPrefs). These are intentionally device-local — autoplay and
 * data-usage behavior is per-device, not account-level.
 */

export const CONTENT_PREFS_KEY = 'vanta_content_extras';

export interface ContentPrefs {
  autoplay: boolean;
  lowerData: boolean;
  quality: string;
  hideSensitive: boolean;
}

export const CONTENT_PREFS_DEFAULTS: ContentPrefs = {
  autoplay: true,
  lowerData: false,
  quality: 'auto',
  hideSensitive: true,
};

export function readContentPrefs(): ContentPrefs {
  if (typeof window === 'undefined') return CONTENT_PREFS_DEFAULTS;
  try {
    const raw = localStorage.getItem(CONTENT_PREFS_KEY);
    if (!raw) return CONTENT_PREFS_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ContentPrefs>;
    return { ...CONTENT_PREFS_DEFAULTS, ...parsed };
  } catch {
    return CONTENT_PREFS_DEFAULTS;
  }
}

export function useContentPrefs(): { prefs: ContentPrefs; hydrated: boolean } {
  const [prefs, setPrefs] = useState<ContentPrefs>(CONTENT_PREFS_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  const refresh = useCallback(() => {
    setPrefs(readContentPrefs());
    setHydrated(true);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [refresh]);

  return { prefs, hydrated };
}