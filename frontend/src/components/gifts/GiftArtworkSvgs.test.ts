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
import { giftArtworkAsset } from './giftArtworkAssets';

// Reference assets are the primary artwork; retain regression checks for historical SVG scenes.
const SCENES_SRC = readFileSync(join(__dirname, 'GiftArtworkSvgs.tsx'), 'utf8');

describe('GiftArtworkSvgs — complete premium artwork coverage', () => {
  it('maps every approved gift to a distinct, exact reference asset', () => {
    expect(initialGiftCatalog).toHaveLength(70);
    const paths = initialGiftCatalog.map(gift => giftArtworkAsset(gift.slug, gift.name));
    expect(paths).toEqual(initialGiftCatalog.map(gift => '/gifts/reference/' + gift.slug + '.webp'));
    expect(new Set(paths).size).toBe(70);
    expect(giftArtworkAsset('unknown-custom-gift')).toBeUndefined();
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

  it('catalog names and slugs are unique', () => {
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

  it('pins the approved luxury prices and preserves catalog ordering', () => {
    expect(initialGiftCatalog.slice(10,20).map(gift => [gift.name, gift.price])).toEqual([
      ['Phoenix', 50000], ['Castle', 100000], ['Galaxy Dragon', 250000],
      ['Golden Throne', 500000], ['Infinity', 1000000], ['Luxury Car', 250],
      ['Motorcycle', 500], ['Ferrari', 500], ['G-Wagon', 1000], ['Superyacht', 2000],
    ]);
    expect(initialGiftCatalog.map(gift => gift.sortOrder)).toEqual(Array.from({length: 70}, (_, i) => i + 1));
  });
});
