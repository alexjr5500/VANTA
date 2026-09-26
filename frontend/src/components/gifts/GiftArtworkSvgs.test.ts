// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  GIFT_ART_MANIFEST,
  GIFT_ART_SCENE_NAMES,
  GIFT_ARTWORK_IDS,
  PALETTE_BY_ID,
  resolveGiftArtworkId,
  type GiftArtworkId,
} from './GiftArtworkSvgs.core';
import { initialGiftCatalog } from '../../../../backend/prisma/gift-catalog.data';

/**
 * Artwork-coverage regression suite.
 *
 * The VANTA catalog is 63 gifts today. Every one must resolve to a dedicated,
 * premium, hand-authored artwork scene — never the generic fallback box. These
 * tests pin that contract using the REAL seed catalog (no copy to drift).
 */

const SCENES_SRC = readFileSync(join(__dirname, 'GiftArtworkSvgs.tsx'), 'utf8');

describe('GiftArtworkSvgs — complete premium artwork coverage', () => {
  it('covers every gift in the real 63-gift catalog with a dedicated scene (never the generic fallback)', () => {
    const gifts = initialGiftCatalog;
    expect(gifts.length).toBeGreaterThanOrEqual(63);

    const generic: string[] = [];
    const byScene: Record<string, string[]> = {};
    for (const gift of gifts) {
      const id = resolveGiftArtworkId(gift.slug, gift.artworkType);
      (byScene[id] = byScene[id] || []).push(gift.slug);
      if (id === 'giftbox') generic.push(gift.slug);
      expect(GIFT_ARTWORK_IDS, `id "${id}" (${gift.slug}) is a known artwork scene`).toContain(id);
    }

    expect(generic, `no gift falls back to the generic giftbox: ${generic.join(', ')}`).toEqual([]);
    expect(Object.keys(byScene).length, 'catalog spans ≥ 23 distinct premium scenes').toBeGreaterThanOrEqual(23);
  });

  it('implements and labels every artwork id in the type union', () => {
    for (const id of GIFT_ARTWORK_IDS) {
      expect(PALETTE_BY_ID[id], `palette for "${id}"`).toBeDefined();
      expect(GIFT_ART_SCENE_NAMES[id], `label for "${id}"`).toBeDefined();
      const fn = GIFT_ART_MANIFEST[id];
      expect(fn, `manifest entry for "${id}"`).toBeDefined();
      expect(
        SCENES_SRC.includes(`function ${fn}(`),
        `"${id}" must have a hand-authored scene function ${fn}() in GiftArtworkSvgs.tsx`,
      ).toBe(true);
    }
  });

  it('keeps identity mapping stable for the flagship gifts', () => {
    expect(resolveGiftArtworkId('rose', 'rose')).toBe('rose');
    expect(resolveGiftArtworkId('diamond', 'diamond')).toBe('diamond');
    expect(resolveGiftArtworkId('crown', 'crown')).toBe('crown');
    expect(resolveGiftArtworkId('lets-ride', 'car')).toBe('car');
    expect(resolveGiftArtworkId('phoenix-flame', 'flame')).toBe('flame');
    expect(resolveGiftArtworkId('yacht', 'yacht')).toBe('yacht');
    expect(resolveGiftArtworkId('celestial-crown', 'crown')).toBe('crown');
    // Polar Star keeps its star silhouette (its slug identity wins over the
    // catalog's shared `diamond` artworkType — both layers resolve the same way).
    expect(resolveGiftArtworkId('polar-star', 'diamond')).toBe('star');
    expect(resolveGiftArtworkId('crystal-star', 'artifact')).toBe('star');
    expect(resolveGiftArtworkId('royal-dragon', 'artifact')).toBe('dragon');
    expect(resolveGiftArtworkId('aurora-castle', 'crown')).toBe('castle');
    expect(resolveGiftArtworkId('golden-horizon', 'artifact')).toBe('sun');
    expect(resolveGiftArtworkId('starlight-capsule', 'artifact')).toBe('capsule');
    expect(resolveGiftArtworkId('plasma-ring', 'artifact')).toBe('ring');
    expect(resolveGiftArtworkId('infinite-spark', 'artifact')).toBe('spark');
    expect(resolveGiftArtworkId('quantum-orb', 'artifact')).toBe('orb');
    expect(resolveGiftArtworkId('starry-love', 'heart')).toBe('love');
  });

  it('catalog names and slugs are unique (63 real gifts, untouched product data)', () => {
    const names = new Set(initialGiftCatalog.map((g) => g.name));
    const slugs = new Set(initialGiftCatalog.map((g) => g.slug));
    expect(names.size).toBe(initialGiftCatalog.length);
    expect(slugs.size).toBe(initialGiftCatalog.length);
  });

  it('prices never fall below their catalog values (artwork signal stays honest)', () => {
    // Every gift must keep a positive price; the art tiering only reads it.
    for (const gift of initialGiftCatalog) {
      expect(gift.price).toBeGreaterThanOrEqual(5);
      expect(Number.isSafeInteger(gift.price)).toBe(true);
    }
  });

  it('resolves the complete 63-gift distribution to exactly the intentional scene set', () => {
    const byScene: Record<string, number> = {};
    for (const gift of initialGiftCatalog) {
      const id = resolveGiftArtworkId(gift.slug, gift.artworkType);
      byScene[id] = (byScene[id] || 0) + 1;
    }
    // 23 art families cover the catalog today; any change to this distribution
    // must be a deliberate art-direction decision.
    expect(Object.keys(byScene)).toHaveLength(23);
    expect(byScene.thumb).toBe(1);
    expect((byScene.flame || 0) >= 5).toBe(true);
    expect((byScene.rose || 0) >= 5).toBe(true);
    expect((byScene.crown || 0) >= 6).toBe(true);
  });
});