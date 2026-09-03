'use client';

// =============================================================================
// VANTA language switcher
// Allows users to switch languages and displays current locale
// =============================================================================

import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { locales, localeNames, isValidLocale, type Locale } from '@/lib/i18n/config';
import { isRTL } from '@/lib/i18n/config';

export function LanguageSwitcher({ 
  variant = 'dropdown',
  className = '',
}: { 
  variant?: 'dropdown' | 'list' | 'minimal';
  className?: string;
}) {
  const { locale, setLocale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLocaleChange = async (newLocale: Locale) => {
    await setLocale(newLocale);
    setIsOpen(false);
  };

  const currentLocaleName = localeNames[locale] || locale;

  if (variant === 'minimal') {
    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors rounded-lg hover:bg-[var(--card-bg-hover)]"
          aria-label={t('common.language')}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <span className="text-base">{getFlagEmoji(locale)}</span>
          <span className="uppercase font-medium text-xs">{locale}</span>
        </button>

        {isOpen && (
          <div
            className="absolute right-0 top-full z-50 mt-1 w-[min(240px,calc(100vw-24px))] max-h-[min(320px,calc(100dvh-24px))] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--glass-strong-bg)] shadow-elevated backdrop-blur-xl"
            role="listbox"
            aria-label={t('common.language')}
          >
            <div className="p-1 max-h-[300px] overflow-y-auto">
              {locales.map((code) => (
                <button
                  key={code}
                  onClick={() => handleLocaleChange(code)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors ${
                    code === locale
                      ? 'bg-[var(--gold)]/10 text-[var(--foreground)] font-medium'
                      : 'text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--card-bg-hover)]'
                  }`}
                  role="option"
                  aria-selected={code === locale}
                >
                  <span className="text-lg">{getFlagEmoji(code)}</span>
                  <span className="flex-1 text-left">{localeNames[code]}</span>
                  {code === locale && (
                    <svg className="w-4 h-4 text-[var(--gold)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className={`space-y-1 ${className}`}>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
          {t('common.language')}
        </label>
        <div className="grid gap-1" role="listbox" aria-label={t('common.language')}>
          {locales.map((code) => (
            <button
              key={code}
              onClick={() => handleLocaleChange(code)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors ${
                code === locale
                  ? 'bg-[var(--gold)]/10 border border-[var(--gold)]/20 text-[var(--foreground)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--card-bg-hover)] border border-transparent'
              }`}
              role="option"
              aria-selected={code === locale}
            >
              <span className="text-lg">{getFlagEmoji(code)}</span>
              <span className="flex-1 text-left">{localeNames[code]}</span>
              <span className="text-xs text-[var(--text-muted)] uppercase">{code}</span>
              {code === locale && (
                <span className="text-[var(--gold)] text-xs font-medium">{t('common.active') || 'Active'}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Default: dropdown
  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 text-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl hover:border-[var(--card-border-hover)] transition-all"
        aria-label={t('common.language')}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="text-lg">{getFlagEmoji(locale)}</span>
        <span className="text-[var(--foreground)]">{currentLocaleName}</span>
        <svg
          className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(280px,calc(100vw-24px))] max-h-[min(340px,calc(100dvh-24px))] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--glass-strong-bg)] shadow-elevated backdrop-blur-xl"
          role="listbox"
          aria-label={t('common.language')}
        >
          <div className="p-1 max-h-[320px] overflow-y-auto">
            {locales.map((code) => (
              <button
                key={code}
                onClick={() => handleLocaleChange(code)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors ${
                  code === locale
                    ? 'bg-[var(--gold)]/10 text-[var(--foreground)] font-medium'
                    : 'text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--card-bg-hover)]'
                }`}
                role="option"
                aria-selected={code === locale}
              >
                <span className="text-lg">{getFlagEmoji(code)}</span>
                <span className="flex-1 text-left">{localeNames[code]}</span>
                <span className="text-[10px] text-[var(--text-muted)] uppercase">{code}</span>
                {code === locale && (
                  <svg className="w-4 h-4 text-[var(--gold)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Simplified flag emoji mapping for language representation
function getFlagEmoji(localeCode: string): string {
  const flags: Record<string, string> = {
    'en': '🇺🇸',
    'fr': '🇫🇷',
    'es': '🇪🇸',
    'pt': '🇧🇷',
    'ar': '🇸🇦',
    'de': '🇩🇪',
    'it': '🇮🇹',
    'tr': '🇹🇷',
    'ru': '🇷🇺',
    'hi': '🇮🇳',
    'ur': '🇵🇰',
    'bn': '🇧🇩',
    'id': '🇮🇩',
    'vi': '🇻🇳',
    'th': '🇹🇭',
    'zh': '🇨🇳',
    'zh-TW': '🇹🇼',
    'ja': '🇯🇵',
    'ko': '🇰🇷',
  };
  return flags[localeCode] || '🌐';
}

export default LanguageSwitcher;