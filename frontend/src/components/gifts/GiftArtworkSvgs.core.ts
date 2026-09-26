/**
 * GiftArtworkSvgs.core — PURE artwork registry for the VANTA premium gift
 * artwork library (no JSX, vite/node-test friendly).
 *
 * The scenes themselves live in GiftArtworkSvgs.tsx; this module owns the
 * identity resolution, palettes, labels and the scene manifest so tests can
 * pin coverage without parsing JSX.
 */

export type GiftArtworkId =
  | 'heart' | 'love' | 'thumb' | 'flame' | 'rose' | 'coffee' | 'balloon' | 'teddy'
  | 'happy' | 'pearl' | 'medal' | 'diamond' | 'crown' | 'car' | 'jet' | 'yacht'
  | 'dragon' | 'castle' | 'star' | 'comet' | 'orb' | 'ring' | 'capsule' | 'spark'
  | 'sun' | 'giftbox';

export interface GiftPalette {
  /** Light / specular stop — usually the rim or hot surface. */
  a: string;
  /** Mid / primary body color. */
  b: string;
  /** Deep / shadow stop — sculpts the 3D volume. */
  c: string;
}

const hasAny = (value: string, keys: string[]) => keys.some(k => value.includes(k));

/**
 * Maps any real gift (slug + catalog artworkType) to its dedicated artwork
 * scene. Ordering is deliberate: specific silhouettes first, generic last.
 */
export function resolveGiftArtworkId(slug = '', artworkType = ''): GiftArtworkId {
  const s = (slug || '').trim().toLowerCase();
  const t = (artworkType || '').trim().toLowerCase();
  const has = (...keys: string[]) => hasAny(s, keys) || hasAny(t, keys);
  if (has('coffee', 'latte', 'brew', 'espresso', 'mocha')) return 'coffee';
  if (has('balloon')) return 'balloon';
  if (has('thumb')) return 'thumb';
  if (has('fire', 'flame', 'ember', 'phoenix', 'cinder', 'flare')) return 'flame';
  if (has('rose', 'bloom', 'petal')) return 'rose';
  if (has('teddy', 'bear')) return 'teddy';
  if (has('yacht', 'boat', 'sail')) return 'yacht';
  if (has('dragon', 'wyvern')) return 'dragon';
  if (has('castle', 'fortress', 'citadel')) return 'castle';
  if (has('love', 'valentine')) return 'love';
  if (has('heart', 'kiss', 'embrace')) return 'heart';
  if (has('comet', 'meteor')) return 'comet';
  if (has('capsule', 'pod')) return 'capsule';
  if (has('star')) return 'star';
  if (has('pearl', 'shell', 'relic')) return 'pearl';
  if (has('medal', 'champion', 'league', 'ribbon', 'medallion', 'badge', 'place', 'victory')) return 'medal';
  if (has('diamond', 'prism', 'glacier', 'gem', 'crystal', 'shard')) return 'diamond';
  if (has('crown', 'royalty', 'crest', 'scepter', 'throne')) return 'crown';
  if (has('car', 'ride', 'roadster', 'coupe', 'velocity', 'auto', 'racer')) return 'car';
  if (has('jet', 'flight', 'cloud', 'wings', 'elite', 'pilot')) return 'jet';
  if (has('happy', 'cake', 'party', 'confetti', 'celebration')) return 'happy';
  if (has('spark', 'bolt', 'energy', 'lightning')) return 'spark';
  if (has('ring')) return 'ring';
  if (has('orb', 'sphere')) return 'orb';
  if (has('sun', 'sunset', 'dawn', 'horizon', 'golden')) return 'sun';
  return 'giftbox';
}
/* ────────────────────────────────────────────────────────────────────
   Art-directed VANTA palettes — one identity per gift family so the
   collection reads as a single premium team's work.
   ──────────────────────────────────────────────────────────────────── */

export const PALETTE_BY_ID: Record<GiftArtworkId, GiftPalette> = {
  heart:    { a: '#ffb3c8', b: '#ff3476', c: '#a11246' },
  love:     { a: '#ffb6d8', b: '#ff3d9a', c: '#7b2fd6' },
  thumb:    { a: '#9ff4ff', b: '#32b8ff', c: '#1450e8' },
  flame:    { a: '#ffe9a3', b: '#ff7a1f', c: '#e2163c' },
  rose:     { a: '#ffc9d9', b: '#e6296f', c: '#8e0e47' },
  coffee:   { a: '#ffe3c0', b: '#b06a34', c: '#5a2c14' },
  balloon:  { a: '#ffd1dc', b: '#ff4f7d', c: '#b31d5c' },
  teddy:    { a: '#ffe1b8', b: '#c98a4a', c: '#7b4a2c' },
  happy:    { a: '#fff0a6', b: '#ffb62e', c: '#f25c24' },
  pearl:    { a: '#ffffff', b: '#bfe9ff', c: '#7a5cff' },
  medal:    { a: '#fff3a8', b: '#f0b83a', c: '#a85c10' },
  diamond:  { a: '#ffffff', b: '#8fdcff', c: '#3a6bff' },
  crown:    { a: '#ffe9a3', b: '#d4a017', c: '#7b2fd6' },
  car:      { a: '#c8fbff', b: '#29b4f0', c: '#1c3fd8' },
  jet:      { a: '#eaf6ff', b: '#7fb6ff', c: '#2c5adf' },
  yacht:    { a: '#ffffff', b: '#3fd7ef', c: '#1b66cf' },
  dragon:   { a: '#7dffb0', b: '#2fc76e', c: '#b3153f' },
  castle:   { a: '#e7d6ff', b: '#8b5cf6', c: '#3b1e8f' },
  star:     { a: '#ffffff', b: '#ffd76e', c: '#f2a51f' },
  comet:    { a: '#cfe9ff', b: '#8f6bff', c: '#2e3fd6' },
  orb:      { a: '#ffd0f4', b: '#a855f7', c: '#2f1a8f' },
  ring:     { a: '#cfeaff', b: '#3f9fe8', c: '#d4a017' },
  capsule:  { a: '#d8feff', b: '#3fcbe0', c: '#145a9f' },
  spark:    { a: '#fff6a6', b: '#ffc93c', c: '#19a6f0' },
  sun:      { a: '#ffb84d', b: '#ff7a1f', c: '#6b1226' },
  giftbox:  { a: '#ffd6f7', b: '#a855f7', c: '#4a1f8f' },
};

export const DEFAULT_PALETTE: GiftPalette = { a: '#f4c8ff', b: '#a855f7', c: '#ec4899' };

export function paletteFor(id: GiftArtworkId, hue = 265): GiftPalette {
  if (PALETTE_BY_ID[id]) return PALETTE_BY_ID[id];
  return { a: `hsl(${hue} 100% 86%)`, b: `hsl(${hue} 82% 57%)`, c: `hsl(${(hue + 58) % 360} 78% 46%)` };
}

/** Human-readable label per scene (used by tooling + tests). */
export const GIFT_ART_SCENE_NAMES: Record<GiftArtworkId, string> = {
  heart: 'Heart', love: 'Love', thumb: 'Thumbs Up', flame: 'Flame', rose: 'Rose',
  coffee: 'Coffee', balloon: 'Balloon', teddy: 'Teddy', happy: 'Happy Day',
  pearl: 'Pearl', medal: 'Medal', diamond: 'Diamond', crown: 'Crown', car: 'Car',
  jet: 'Jet', yacht: 'Yacht', dragon: 'Dragon', castle: 'Castle', star: 'Star',
  comet: 'Comet', orb: 'Orb', ring: 'Ring', capsule: 'Capsule', spark: 'Spark',
  sun: 'Sun', giftbox: 'Gift Box',
};

/**
 * Manifest of the dedicated scene function per artwork id. The test suite
 * cross-checks these names against the actual GiftArtworkSvgs.tsx source so
 * every gift family is guaranteed a hand-authored scene.
 */
export const GIFT_ART_MANIFEST: Record<GiftArtworkId, string> = {
  heart: 'HeartArt', love: 'LoveArt', thumb: 'ThumbArt', flame: 'FlameArt', rose: 'RoseArt',
  coffee: 'CoffeeArt', balloon: 'BalloonArt', teddy: 'TeddyArt', happy: 'HappyArt',
  pearl: 'PearlArt', medal: 'MedalArt', diamond: 'DiamondArt', crown: 'CrownArt', car: 'CarArt',
  jet: 'JetArt', yacht: 'YachtArt', dragon: 'DragonArt', castle: 'CastleArt', star: 'StarArt',
  comet: 'CometArt', orb: 'OrbArt', ring: 'RingArt', capsule: 'CapsuleArt', spark: 'SparkArt',
  sun: 'SunArt', giftbox: 'GiftboxArt',
};

/** All ids — none of the 63 catalogue gifts may fall to the generic giftbox. */
export const GIFT_ARTWORK_IDS: GiftArtworkId[] = Object.keys(GIFT_ART_SCENE_NAMES) as GiftArtworkId[];