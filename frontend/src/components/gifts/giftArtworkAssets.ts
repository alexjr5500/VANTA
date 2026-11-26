// Approved reference art. Build verifies each file exists.
export const REFERENCE_GIFT_SLUGS = ["rose","heart","crown","panda","dragon","lion","yacht","galaxy","diamond","private-jet","phoenix","castle","galaxy-dragon","golden-throne","infinity","luxury-car","motorcycle","ferrari","g-wagon","superyacht","helicopter","space-shuttle","royal-carriage","magic-wand","magic-hat","teddy-bear","gift-box","music-note","shooting-star","fireworks","ice-cream","bubble-tea","coffee","pizza","burger","fries","sushi","cake","donut","chocolate","snowman","santa","reindeer","christmas-tree","gift-sack","valentine-bear","love-letter","rain-cloud","sunshine","moon","ocean-wave","butterfly","dolphin","star","moonlight","aurora","crystal-ball","treasure-chest","golden-key","time-hourglass","dragon-egg","phoenix-feather","lightning","fire-elemental","water-elemental","earth-elemental","wind-elemental","space-ring","golden-butterfly","diamond-heart"] as const;
const referenceSlugs = new Set<string>(REFERENCE_GIFT_SLUGS);
export function giftArtworkAsset(slug?: string, name?: string): string | undefined {
  const key = (slug || name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return referenceSlugs.has(key) ? '/gifts/reference/' + key + '.webp' : undefined;
}
