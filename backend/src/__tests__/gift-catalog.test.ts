import { initialGiftCatalog } from '../data/gift-catalog.data';

describe('premium gift catalog', () => {
  test('defines the complete branded catalog without emoji artwork', () => {
    expect(initialGiftCatalog).toHaveLength(70);
    expect(initialGiftCatalog.map(gift => [gift.slug, gift.name, gift.price])).toEqual([
  [
    "rose",
    "Rose",
    10
  ],
  [
    "heart",
    "Heart",
    20
  ],
  [
    "crown",
    "Crown",
    50
  ],
  [
    "panda",
    "Panda",
    100
  ],
  [
    "dragon",
    "Dragon",
    200
  ],
  [
    "lion",
    "Lion",
    500
  ],
  [
    "yacht",
    "Yacht",
    1000
  ],
  [
    "galaxy",
    "Galaxy",
    2000
  ],
  [
    "diamond",
    "Diamond",
    5000
  ],
  [
    "private-jet",
    "Private Jet",
    10000
  ],
  [
    "phoenix",
    "Phoenix",
    50000
  ],
  [
    "castle",
    "Castle",
    100000
  ],
  [
    "galaxy-dragon",
    "Galaxy Dragon",
    250000
  ],
  [
    "golden-throne",
    "Golden Throne",
    500000
  ],
  [
    "infinity",
    "Infinity",
    1000000
  ],
  [
    "luxury-car",
    "Luxury Car",
    250
  ],
  [
    "motorcycle",
    "Motorcycle",
    500
  ],
  [
    "ferrari",
    "Ferrari",
    500
  ],
  [
    "g-wagon",
    "G-Wagon",
    1000
  ],
  [
    "superyacht",
    "Superyacht",
    2000
  ],
  [
    "helicopter",
    "Helicopter",
    2500
  ],
  [
    "space-shuttle",
    "Space Shuttle",
    5000
  ],
  [
    "royal-carriage",
    "Royal Carriage",
    10000
  ],
  [
    "magic-wand",
    "Magic Wand",
    50
  ],
  [
    "magic-hat",
    "Magic Hat",
    100
  ],
  [
    "teddy-bear",
    "Teddy Bear",
    200
  ],
  [
    "gift-box",
    "Gift Box",
    500
  ],
  [
    "music-note",
    "Music Note",
    1000
  ],
  [
    "shooting-star",
    "Shooting Star",
    2000
  ],
  [
    "fireworks",
    "Fireworks",
    5000
  ],
  [
    "ice-cream",
    "Ice Cream",
    10
  ],
  [
    "bubble-tea",
    "Bubble Tea",
    20
  ],
  [
    "coffee",
    "Coffee",
    50
  ],
  [
    "pizza",
    "Pizza",
    100
  ],
  [
    "burger",
    "Burger",
    200
  ],
  [
    "fries",
    "Fries",
    500
  ],
  [
    "sushi",
    "Sushi",
    1000
  ],
  [
    "cake",
    "Cake",
    2000
  ],
  [
    "donut",
    "Donut",
    5000
  ],
  [
    "chocolate",
    "Chocolate",
    10000
  ],
  [
    "snowman",
    "Snowman",
    25
  ],
  [
    "santa",
    "Santa",
    50
  ],
  [
    "reindeer",
    "Reindeer",
    100
  ],
  [
    "christmas-tree",
    "Christmas Tree",
    200
  ],
  [
    "gift-sack",
    "Gift Sack",
    500
  ],
  [
    "valentine-bear",
    "Valentine Bear",
    1000
  ],
  [
    "love-letter",
    "Love Letter",
    2000
  ],
  [
    "rain-cloud",
    "Rain Cloud",
    5000
  ],
  [
    "sunshine",
    "Sunshine",
    10000
  ],
  [
    "moon",
    "Moon",
    25000
  ],
  [
    "ocean-wave",
    "Ocean Wave",
    50
  ],
  [
    "butterfly",
    "Butterfly",
    100
  ],
  [
    "dolphin",
    "Dolphin",
    200
  ],
  [
    "star",
    "Star",
    500
  ],
  [
    "moonlight",
    "Moonlight",
    1000
  ],
  [
    "aurora",
    "Aurora",
    2000
  ],
  [
    "crystal-ball",
    "Crystal Ball",
    5000
  ],
  [
    "treasure-chest",
    "Treasure Chest",
    10000
  ],
  [
    "golden-key",
    "Golden Key",
    25000
  ],
  [
    "time-hourglass",
    "Time Hourglass",
    25000
  ],
  [
    "dragon-egg",
    "Dragon Egg",
    100
  ],
  [
    "phoenix-feather",
    "Phoenix Feather",
    200
  ],
  [
    "lightning",
    "Lightning",
    500
  ],
  [
    "fire-elemental",
    "Fire Elemental",
    1000
  ],
  [
    "water-elemental",
    "Water Elemental",
    2000
  ],
  [
    "earth-elemental",
    "Earth Elemental",
    5000
  ],
  [
    "wind-elemental",
    "Wind Elemental",
    10000
  ],
  [
    "space-ring",
    "Space Ring",
    25000
  ],
  [
    "golden-butterfly",
    "Golden Butterfly",
    50000
  ],
  [
    "diamond-heart",
    "Diamond Heart",
    100000
  ]
]);
    expect(new Set(initialGiftCatalog.map(gift => gift.slug)).size).toBe(70);
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