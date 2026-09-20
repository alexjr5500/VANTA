'use client';

// ============================================================================
// Curated VANTA Story backgrounds — intentional, premium, never garish.
// Every entry renders as a CSS background that also drives the viewer.
// ============================================================================

export interface StoryBackground {
  id: string;
  /** Human name shown in the picker. */
  label: string;
  /** CSS background value. */
  css: string;
  /** Suggested default text color for good contrast. */
  ink: string;
  group: 'solid' | 'gradient' | 'dark' | 'light' | 'vanta';
}

export const STORY_BACKGROUNDS: StoryBackground[] = [
  // ── Solid ──────────────────────────────────────────────────────────────────
  { id: 'ink', label: 'Ink', css: 'linear-gradient(180deg, #101014 0%, #070709 100%)', ink: '#f5f5f7', group: 'solid' },
  { id: 'obsidian', label: 'Obsidian', css: 'linear-gradient(160deg, #0b0b0e 0%, #050506 100%)', ink: '#dfbd55', group: 'solid' },
  { id: 'basalt', label: 'Basalt', css: 'linear-gradient(180deg, #1c1c20 0%, #121216 100%)', ink: '#ffffff', group: 'solid' },
  { id: 'ivory', label: 'Ivory', css: 'linear-gradient(180deg, #f7f5ef 0%, #ecebe4 100%)', ink: '#16161a', group: 'solid' },
  { id: 'porcelain', label: 'Porcelain', css: 'linear-gradient(180deg, #efeef1 0%, #e3e2e8 100%)', ink: '#1b1b1f', group: 'solid' },
  // ── Gradients ─────────────────────────────────────────────────────────────
  { id: 'midnight-gold', label: 'Midnight Gold', css: 'linear-gradient(145deg, #0f0f13 0%, #1a1510 48%, #241b0d 100%)', ink: '#dfbd55', group: 'gradient' },
  { id: 'noir', label: 'Noir', css: 'radial-gradient(120% 140% at 20% 0%, #232328 0%, #0a0a0d 55%, #050506 100%)', ink: '#f5f5f7', group: 'gradient' },
  { id: 'smoke-gold', label: 'Smoke & Gold', css: 'radial-gradient(130% 120% at 80% 100%, #3a2b12 0%, #121014 48%, #060608 100%)', ink: '#dfbd55', group: 'gradient' },
  { id: 'dusk', label: 'Dusk', css: 'linear-gradient(160deg, #23232c 0%, #141420 55%, #08080d 100%)', ink: '#ffffff', group: 'gradient' },
  { id: 'clay', label: 'Clay', css: 'linear-gradient(150deg, #4a2f24 0%, #241812 55%, #120b07 100%)', ink: '#f3e9e0', group: 'gradient' },
  { id: 'forest', label: 'Forest', css: 'linear-gradient(150deg, #1d2a22 0%, #101a14 55%, #070d09 100%)', ink: '#f1f7ee', group: 'gradient' },
  { id: 'ocean', label: 'Abyss', css: 'linear-gradient(150deg, #14202e 0%, #0b1420 50%, #060a12 100%)', ink: '#e9f1f8', group: 'gradient' },
  { id: 'lavender', label: 'Violet Haze', css: 'linear-gradient(160deg, #241c31 0%, #171224 55%, #0b0812 100%)', ink: '#efe7fb', group: 'gradient' },

  // ── Dark cinematic ─────────────────────────────────────────────────────────
  { id: 'cinema', label: 'Cinema', css: 'linear-gradient(180deg, #141416 0%, #08080a 60%, #030304 100%)', ink: '#ffffff', group: 'dark' },
  { id: 'nebula', label: 'Nebula', css: 'radial-gradient(140% 120% at 30% 10%, #22303f 0%, #0d1117 55%, #04050a 100%)', ink: '#f5f9ff', group: 'dark' },
  { id: 'ember', label: 'Ember', css: 'radial-gradient(140% 130% at 70% 20%, #4a1407 0%, #180a06 55%, #050404 100%)', ink: '#ffe0c2', group: 'dark' },
  // ── Light minimal ──────────────────────────────────────────────────────────
  { id: 'paper', label: 'Paper', css: 'linear-gradient(160deg, #fbfaf6 0%, #eceae2 100%)', ink: '#1c1c20', group: 'light' },
  { id: 'sand', label: 'Sand', css: 'linear-gradient(160deg, #f2eddf 0%, #e4dcc6 100%)', ink: '#2a241a', group: 'light' },
  { id: 'mist', label: 'Mist', css: 'linear-gradient(160deg, #eef2f4 0%, #dde4e8 100%)', ink: '#17202a', group: 'light' },
  { id: 'blush', label: 'Blush', css: 'linear-gradient(160deg, #f3e9e9 0%, #e6d4d4 100%)', ink: '#2c1a1a', group: 'light' },

  // ── VANTA inspired ─────────────────────────────────────────────────────────
  { id: 'vanta', label: 'VANTA', css: 'radial-gradient(120% 120% at 20% 20%, #2b220e 0%, #0c0b08 55%, #030303 100%)', ink: '#dfbd55', group: 'vanta' },
  { id: 'vanta-gold', label: 'VANTA Gold', css: 'radial-gradient(130% 140% at 80% 10%, #4a3a12 0%, #191307 55%, #070502 100%)', ink: '#f2c75c', group: 'vanta' },
  { id: 'gold-line', label: 'Gold Line', css: 'linear-gradient(160deg, #15120a 0%, #0d0b07 55%, #040402 100%)', ink: '#dfbd55', group: 'vanta' },
  { id: 'platinum', label: 'Platinum', css: 'linear-gradient(160deg, #26262c 0%, #151519 55%, #08080b 100%)', ink: '#e8e8ec', group: 'vanta' },
];

export function backgroundById(id?: string | null): StoryBackground {
  return STORY_BACKGROUNDS.find(bg => bg.id === id) || STORY_BACKGROUNDS[0];
}

// ============================================================================
// Text Story fonts — system-safe premium stacks (no added network deps).
// ============================================================================

export interface StoryFont {
  id: string;
  label: string;
  /** font-family used in the editor + viewer. */
  css: string;
  /** Tracking (em) baked into the style presets. */
  letterSpacing: number;
  lineHeight: number;
}

export const STORY_FONTS: StoryFont[] = [
  { id: 'sans', label: 'Inter', css: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", letterSpacing: -0.01, lineHeight: 1.18 },
  { id: 'display', label: 'Display', css: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", letterSpacing: -0.03, lineHeight: 1.05 },
  { id: 'serif', label: 'Editorial', css: "'Georgia', 'Times New Roman', serif", letterSpacing: 0, lineHeight: 1.22 },
  { id: 'mono', label: 'Mono', css: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace", letterSpacing: -0.02, lineHeight: 1.3 },
  { id: 'wide', label: 'Wide', css: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", letterSpacing: 0.08, lineHeight: 1.2 },
  { id: 'serif-display', label: 'Editorial Display', css: "'Georgia', 'Times New Roman', serif", letterSpacing: -0.01, lineHeight: 1.08 },
];

export function fontById(id?: string | null): StoryFont {
  return STORY_FONTS.find(font => font.id === id) || STORY_FONTS[0];
}

export interface TextStoryStyleDefaults {
  background: string;
  font: string;
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  weight: number;
  italic: boolean;
  letterSpacing: number;
  lineHeight: number;
  alignY: 'top' | 'middle' | 'bottom';
  uppercase: boolean;
}

export const DEFAULT_TEXT_STYLE: TextStoryStyleDefaults = {
  background: 'ink',
  font: 'sans',
  size: 44,
  color: '#f5f5f7',
  align: 'center',
  weight: 700,
  italic: false,
  letterSpacing: -0.01,
  lineHeight: 1.18,
  alignY: 'middle',
  uppercase: false,
};

/** Curated ink colors for the text canvas. */
export const STORY_TEXT_COLORS: string[] = [
  '#f5f5f7', '#ffffff', '#dfbd55', '#f2c75c', '#16161a', '#1b1b1f', '#d6d3d0',
  '#e9f1f8', '#c9e8dd', '#f3d3c9', '#efe7fb', '#ffd9df', '#f6e7c0',
];

/** Curated swatch sizes (px) — the text canvas. */
export const STORY_TEXT_SIZES: number[] = [28, 32, 38, 44, 52, 64, 78, 96];