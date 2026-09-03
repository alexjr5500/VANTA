'use client';

import { useState, useEffect } from 'react';

/**
 * Custom hook for responsive design - tracks media query matches.
 * Returns `false` during SSR to ensure server and client initial render match.
 * Updates to the correct value after hydration.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check if window is defined (SSR safety)
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);
    // Set initial value
    setMatches(mediaQuery.matches);

    // Listen for changes
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [query]);

  // During SSR and before first client render, return false
  // This ensures server HTML matches initial client HTML
  if (!mounted) return false;

  return matches;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
export const useIsDarkMode = () => useMediaQuery('(prefers-color-scheme: dark)');