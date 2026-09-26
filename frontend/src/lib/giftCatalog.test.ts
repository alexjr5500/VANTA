// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { giftVisualQuality } from './giftCatalog';

/**
 * giftVisualQuality — existing price/rarity/impact combination is preserved
 * exactly; it only maps onto the artwork's artistic intensity (0-5).
 */
describe('giftVisualQuality (price + rarity -> artistic intensity)', () => {
  it('maps low-price common gifts to the clean premium tier (0-1)', () => {
    expect(giftVisualQuality({ price: 5, rarity: 'common', impactLevel: 1 })).toBe(1);
    expect(giftVisualQuality({ price: 10, rarity: 'common' })).toBe(1);
    expect(giftVisualQuality({ price: 25, rarity: 'common', impactLevel: 2 })).toBe(2);
    expect(giftVisualQuality({ price: 50, rarity: 'common' })).toBe(2);
  });

  it('maps 250+ / rare gifts to the richer tier (3)', () => {
    expect(giftVisualQuality({ price: 250, rarity: 'rare', impactLevel: 3 })).toBe(3);
    expect(giftVisualQuality({ price: 250, rarity: 'rare' })).toBe(3);
    expect(giftVisualQuality({ price: 750, rarity: 'rare', impactLevel: 3 })).toBe(3);
  });

  it('maps 1000+ / legendary gifts to the luxury tier (4)', () => {
    expect(giftVisualQuality({ price: 1000, rarity: 'legendary', impactLevel: 4 })).toBe(4);
    expect(giftVisualQuality({ price: 2000, rarity: 'legendary', impactLevel: 4 })).toBe(4);
    expect(giftVisualQuality({ price: 2250, rarity: 'legendary', impactLevel: 4 })).toBe(4);
  });

  it('maps 2500+ / mythic / isLegendary gifts to the signature tier (5)', () => {
    expect(giftVisualQuality({ price: 2500, rarity: 'mythic', impactLevel: 5, isLegendary: true })).toBe(5);
    expect(giftVisualQuality({ price: 3000, rarity: 'mythic', impactLevel: 5 })).toBe(5);
    expect(giftVisualQuality({ price: 1500, isLegendary: true })).toBe(5);
  });

  it('keeps price and rarity independent (never rewrites either)', () => {
    // A large price with SPECIAL rarity stays SPECIAL; the price places it in
    // the top artistic tier (the real catalog tops out at 3000 coins).
    expect(giftVisualQuality({ price: 100000, rarity: 'special', impactLevel: 1 })).toBe(5);
    // EPIC rarity with a modest price keeps a cinematic treatment.
    expect(giftVisualQuality({ price: 500, rarity: 'epic' })).toBe(4);
    // Null/unknown stays a clean 1.
    expect(giftVisualQuality(null)).toBe(1);
    expect(giftVisualQuality(undefined)).toBe(1);
  });
});