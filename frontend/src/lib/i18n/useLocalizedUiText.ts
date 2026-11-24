'use client';

import { useCallback } from 'react';
import { useI18n } from './context';
import { translateUiLabel } from './ui-labels';

/** Selected-locale translations for reusable navigation and settings chrome. */
export function useLocalizedUiText(): (label: string) => string {
  const { locale, t } = useI18n();
  return useCallback((label: string) => translateUiLabel(label, locale, t), [locale, t]);
}
