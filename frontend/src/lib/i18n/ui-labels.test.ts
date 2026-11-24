// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { translateUiLabel } from './ui-labels';

describe('active-language shared UI labels', () => {
  it('uses a real locale translation when one exists', () => {
    expect(translateUiLabel('Settings', 'es', key => key === 'settings.title' ? 'Ajustes' : key)).toBe('Ajustes');
  });

  it('fills core French labels still English in the incomplete French bundle', () => {
    const placeholder = (_key: string) => 'Settings';
    expect(translateUiLabel('Settings', 'fr', placeholder)).toBe('Paramètres');
    expect(translateUiLabel('Privacy Policy', 'fr', () => 'Privacy Policy')).toBe('Politique de confidentialité');
    expect(translateUiLabel('Language & Region', 'fr', () => 'Language & Region')).toBe('Langue et région');
  });

  it('localizes navigation for a non-Latin language', () => {
    expect(translateUiLabel('Home', 'ar', () => 'Home')).toBe('الرئيسية');
    expect(translateUiLabel('Community Guidelines', 'ja', () => 'Community Guidelines')).toBe('コミュニティガイドライン');
  });

  it('never changes a user-created or unknown string or the English locale', () => {
    expect(translateUiLabel('Hello from my post', 'fr', () => 'Hello from my post')).toBe('Hello from my post');
    expect(translateUiLabel('Settings', 'en', () => 'Paramètres')).toBe('Settings');
  });
});
