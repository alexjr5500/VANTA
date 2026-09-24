"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { storage } from '@/lib/platformStorage';

type Theme = 'dark' | 'light';
export type ThemeMode = 'dark' | 'light' | 'system';
export type Accent = 'gold' | 'monochrome';
export type Density = 'comfortable' | 'compact';

interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  accent: Accent;
  density: Density;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
  setDensity: (density: Density) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_KEY = 'vanta_theme';
const THEME_MODE_KEY = 'vanta_theme_mode';
const ACCENT_KEY = 'vanta_accent';
const DENSITY_KEY = 'vanta_density';

const systemPrefersLight = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
};

function applyThemeAttributes(mode: ThemeMode, theme: Theme, accent: Accent, density: Density) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(theme);
  root.dataset.theme = theme;
  root.dataset.themeMode = mode;
  root.dataset.accent = accent;
  root.dataset.density = density;
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [theme, setThemeState] = useState<Theme>('dark');
  const [accent, setAccentState] = useState<Accent>('monochrome');
  const [density, setDensityState] = useState<Density>('comfortable');
  const [mounted, setMounted] = useState(false);

  // Resolve the concrete theme from the user's chosen mode.
  const resolveTheme = useCallback((mode: ThemeMode): Theme => {
    if (mode === 'system') return systemPrefersLight() ? 'light' : 'dark';
    return mode;
  }, []);

  // Hydrate saved preferences as early as possible and subscribe to OS
  // color-scheme changes while the user is in System mode.
  useEffect(() => {
    setMounted(true);
    const hydrate = async () => {
      const [mode, accentValue, densityValue, themeValue] = await Promise.all([
        storage.getItem(THEME_MODE_KEY),
        storage.getItem(ACCENT_KEY),
        storage.getItem(DENSITY_KEY),
        storage.getItem(THEME_KEY),
      ]);
      const nextMode: ThemeMode = mode === 'light' || mode === 'system' ? mode : 'dark';
      const nextAccent: Accent = accentValue === 'monochrome' ? 'monochrome' : 'gold';
      const nextDensity: Density = densityValue === 'compact' ? 'compact' : 'comfortable';
      const resolved = resolveTheme(nextMode);
      const nextTheme: Theme = nextMode === 'dark' ? 'dark' : resolved;
      setThemeModeState(nextMode);
      setThemeState(nextMode === 'light' ? 'light' : nextMode === 'dark' ? 'dark' : resolved || (themeValue === 'light' ? 'light' : 'dark'));
      setAccentState(nextAccent);
      setDensityState(nextDensity);
      applyThemeAttributes(nextMode, nextMode === 'system' ? resolved : nextMode, nextAccent, nextDensity);
    };
    void hydrate();

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onSystemChange = () => {
      void storage.getItem(THEME_MODE_KEY).then((mode) => {
        if (mode === 'system') {
          const resolved = systemPrefersLight() ? 'light' : 'dark';
          setThemeState(resolved);
          applyThemeAttributes('system', resolved, accent, density);
        }
      });
    };
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, [accent, density, resolveTheme]);

  // Keep `<html>` attributes in sync whenever any preference changes.
  useEffect(() => {
    if (!mounted) return;
    applyThemeAttributes(themeMode, theme, accent, density);
  }, [themeMode, theme, accent, density, mounted]);

  const toggleTheme = useCallback(() => {
    setThemeModeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : prev === 'light' ? 'dark' : systemPrefersLight() ? 'dark' : 'light';
      const concrete = resolveTheme(next);
      void storage.setItem(THEME_MODE_KEY, next);
      void storage.setItem(THEME_KEY, concrete);
      setThemeState(concrete);
      return next;
    });
  }, [resolveTheme]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    const concrete = resolveTheme(mode);
    setThemeModeState(mode);
    setThemeState(concrete);
    void storage.setItem(THEME_MODE_KEY, mode);
    void storage.setItem(THEME_KEY, concrete);
  }, [resolveTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeModeState(newTheme === 'light' ? 'light' : 'dark');
    setThemeState(newTheme);
    void storage.setItem(THEME_MODE_KEY, newTheme);
    void storage.setItem(THEME_KEY, newTheme);
  }, []);

  const setAccent = useCallback((nextAccent: Accent) => {
    setAccentState(nextAccent);
    void storage.setItem(ACCENT_KEY, nextAccent);
  }, []);

  const setDensity = useCallback((nextDensity: Density) => {
    setDensityState(nextDensity);
    void storage.setItem(DENSITY_KEY, nextDensity);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themeMode, accent, density, toggleTheme, setTheme, setThemeMode, setAccent, setDensity }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};