'use client';

// =============================================================================
// VANTA Accessibility Context (WCAG 2.1 AA)
// Provides accessibility features: high contrast, reduced motion, font scaling,
// screen reader announcements, focus management, keyboard navigation
// =============================================================================

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

type FontSize = 'small' | 'medium' | 'large' | 'extra-large';

interface AccessibilityContextType {
  // High contrast mode
  highContrast: boolean;
  toggleHighContrast: () => void;

  // Reduced motion
  reducedMotion: boolean;
  toggleReducedMotion: () => void;

  // Font size settings
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  fontSizeScale: number;

  // Focus indicators
  showFocusIndicators: boolean;

  // Screen reader live region announcements
  announce: (message: string, priority?: 'polite' | 'assertive') => void;

  // Skip to content
  skipToContentRef: React.RefObject<HTMLDivElement | null>;

  // Keyboard navigation
  keyboardMode: boolean;
  setKeyboardMode: (mode: boolean) => void;

  // Accessible media
  captionsEnabled: boolean;
  setCaptionsEnabled: (enabled: boolean) => void;
  captionSize: 'small' | 'medium' | 'large';
  setCaptionSize: (size: 'small' | 'medium' | 'large') => void;
}

const AccessibilityContext = createContext<AccessibilityContextType | null>(null);

const STORAGE_KEYS = {
  HIGH_CONTRAST: 'vanta-high-contrast',
  REDUCED_MOTION: 'vanta-reduced-motion',
  FONT_SIZE: 'vanta-font-size',
  CAPTIONS_ENABLED: 'vanta-captions-enabled',
  CAPTION_SIZE: 'vanta-caption-size',
};

const FONT_SIZE_SCALES: Record<FontSize, number> = {
  'small': 0.875,
  'medium': 1,
  'large': 1.125,
  'extra-large': 1.25,
};

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [fontSize, setFontSizeState] = useState<FontSize>('medium');
  const [showFocusIndicators, setShowFocusIndicators] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionSize, setCaptionSize] = useState<'small' | 'medium' | 'large'>('medium');
  
  const skipToContentRef = useRef<HTMLDivElement | null>(null);
  const announcerRef = useRef<HTMLDivElement | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [announcePriority, setAnnouncePriority] = useState<'polite' | 'assertive'>('polite');

  // Load saved preferences
  useEffect(() => {
    try {
      const savedHighContrast = localStorage.getItem(STORAGE_KEYS.HIGH_CONTRAST);
      if (savedHighContrast) setHighContrast(savedHighContrast === 'true');

      const savedReducedMotion = localStorage.getItem(STORAGE_KEYS.REDUCED_MOTION);
      if (savedReducedMotion) setReducedMotion(savedReducedMotion === 'true');

      const savedFontSize = localStorage.getItem(STORAGE_KEYS.FONT_SIZE) as FontSize | null;
      if (savedFontSize && FONT_SIZE_SCALES[savedFontSize]) setFontSizeState(savedFontSize);

      const savedCaptions = localStorage.getItem(STORAGE_KEYS.CAPTIONS_ENABLED);
      if (savedCaptions) setCaptionsEnabled(savedCaptions === 'true');

      const savedCaptionSize = localStorage.getItem(STORAGE_KEYS.CAPTION_SIZE) as 'small' | 'medium' | 'large' | null;
      if (savedCaptionSize) setCaptionSize(savedCaptionSize);

      // Check for system reduced motion preference
      const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (motionQuery.matches && !savedReducedMotion) {
        setReducedMotion(true);
      }

      // Check for system high contrast
      const contrastQuery = window.matchMedia('(prefers-contrast: more)');
      if (contrastQuery.matches && !savedHighContrast) {
        setHighContrast(true);
      }
    } catch {
      // localStorage may not be available
    }
  }, []);

  // Apply high contrast class
  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
    try {
      localStorage.setItem(STORAGE_KEYS.HIGH_CONTRAST, String(highContrast));
    } catch {}
  }, [highContrast]);

  // Apply reduced motion class
  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
    try {
      localStorage.setItem(STORAGE_KEYS.REDUCED_MOTION, String(reducedMotion));
    } catch {}
  }, [reducedMotion]);

  // Apply font size
  useEffect(() => {
    const scale = FONT_SIZE_SCALES[fontSize];
    document.documentElement.style.fontSize = `${scale * 100}%`;
    try {
      localStorage.setItem(STORAGE_KEYS.FONT_SIZE, fontSize);
    } catch {}
  }, [fontSize]);

  // Save caption preferences
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CAPTIONS_ENABLED, String(captionsEnabled));
    } catch {}
  }, [captionsEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CAPTION_SIZE, captionSize);
    } catch {}
  }, [captionSize]);

  // Keyboard navigation detection
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Tab') {
        setKeyboardMode(true);
        setShowFocusIndicators(true);
        document.documentElement.classList.add('keyboard-nav');
      }
    }

    function handleMouseDown() {
      if (keyboardMode) {
        setKeyboardMode(false);
        setShowFocusIndicators(false);
        document.documentElement.classList.remove('keyboard-nav');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [keyboardMode]);

  const toggleHighContrast = useCallback(() => {
    setHighContrast(prev => !prev);
  }, []);

  const toggleReducedMotion = useCallback(() => {
    setReducedMotion(prev => !prev);
  }, []);

  const setFontSize = useCallback((size: FontSize) => {
    setFontSizeState(size);
  }, []);

  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    setAnnouncement(message);
    setAnnouncePriority(priority);
    // Clear after announcement
    setTimeout(() => setAnnouncement(''), 3000);
  }, []);

  const fontSizeScale = FONT_SIZE_SCALES[fontSize];

  const value: AccessibilityContextType = {
    highContrast,
    toggleHighContrast,
    reducedMotion,
    toggleReducedMotion,
    fontSize,
    setFontSize,
    fontSizeScale,
    showFocusIndicators,
    skipToContentRef,
    announce,
    keyboardMode,
    setKeyboardMode,
    captionsEnabled,
    setCaptionsEnabled,
    captionSize,
    setCaptionSize,
  };

  return (
    <AccessibilityContext.Provider value={value}>
      {/* Skip to content link - first focusable element */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-[var(--gold)] focus:text-black focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
        onClick={(e) => {
          e.preventDefault();
          skipToContentRef.current?.focus();
        }}
        aria-label="Skip to main content"
      >
        Skip to main content
      </a>

      {/* Screen reader live region */}
      <div
        ref={announcerRef}
        role="status"
        aria-live={announcePriority}
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility(): AccessibilityContextType {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error('useAccessibility must be used within an AccessibilityProvider');
  }
  return context;
}

export { AccessibilityContext };
export type { FontSize };