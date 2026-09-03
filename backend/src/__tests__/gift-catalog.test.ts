import { initialGiftCatalog } from '../data/gift-catalog.data';

describe('premium gift catalog', () => {
  test('defines the complete branded catalog without emoji artwork', () => {
    expect(initialGiftCatalog.length).toBeGreaterThanOrEqual(58);
    expect(initialGiftCatalog.map(gift => gift.slug)).toEqual(expect.arrayContaining([
      'thumbs-up', 'fire', 'rose', 'heart', 'happy-day', 'fancy-pearl',
      'first-place', 'lets-ride', 'gold-medal', 'elite-status', 'yacht', 'diamond', 'crown',
    ]));
    initialGiftCatalog.forEach(gift => {
      expect(gift).not.toHaveProperty('emoji');
      expect(gift.animationType).toBeTruthy();
      expect(gift.animationDuration).toBeGreaterThanOrEqual(3);
      expect(gift.glowColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(gift.artworkType).toBeTruthy();
      expect(gift.rarity).toBeTruthy();
      expect(gift.impactLevel).toBeGreaterThanOrEqual(1);
    });
  });

  test('scales animation duration and spectacle with price', () => {
    const low = initialGiftCatalog.filter(gift => gift.price <= 25);
    const high = initialGiftCatalog.filter(gift => gift.price >= 1000);
    expect(Math.max(...low.map(gift => gift.animationDuration))).toBeLessThan(Math.min(...high.map(gift => gift.animationDuration)));
    expect(high.some(gift => 'isLegendary' in gift && gift.isLegendary)).toBe(true);
  });
});