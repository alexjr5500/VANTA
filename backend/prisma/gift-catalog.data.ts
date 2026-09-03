const core = [
  { slug: 'thumbs-up', name: 'Thumbs Up', price: 5, category: 'popular', isPopular: true, artworkType: 'thumb', animationType: 'polished-pop', animationDuration: 3, glowColor: '#36d9ff', particleColor: '#a855f7', description: 'A glossy electric-blue salute.' },
  { slug: 'fire', name: 'This Is Fire', price: 10, category: 'popular', isTrending: true, animationType: 'layered-flame', animationDuration: 3, glowColor: '#ff5a1f', particleColor: '#ffd166', description: 'Layered plasma flames for a standout moment.' },
  { slug: 'rose', name: 'Rose', price: 25, category: 'popular', isPopular: true, animationType: 'petal-bloom', animationDuration: 4, glowColor: '#ed245c', particleColor: '#ffb2cf', description: 'A sculpted crimson rose with drifting petals.' },
  { slug: 'heart', name: 'Heart', price: 50, category: 'popular', isFeatured: true, artworkType: 'heart', animationType: 'crystal-heart', animationDuration: 4, glowColor: '#ff3d9a', particleColor: '#f4c8ff', description: 'A radiant glass heart with a crystalline pulse.' },
  { slug: 'happy-day', name: 'Happy Day', price: 100, category: 'trending', isTrending: true, animationType: 'confetti-burst', animationDuration: 5, glowColor: '#ffb02e', particleColor: '#65f4ff', description: 'A colorful celebration wrapped in aurora light.' },
  { slug: 'teddy', name: 'Teddy', price: 150, category: 'popular', artworkType: 'teddy', animationType: 'teddy-wave', animationDuration: 5, glowColor: '#c57a44', particleColor: '#ffe0ad', description: 'A warm plush teddy with a playful wave.' },
  { slug: 'fancy-pearl', name: 'Fancy Pearl', price: 250, category: 'premium', isFeatured: true, animationType: 'pearl-reveal', animationDuration: 5, glowColor: '#9ddfff', particleColor: '#ffffff', description: 'An iridescent pearl revealed from a luxury shell.' },
  { slug: 'first-place', name: '1st Place', price: 500, category: 'premium', isPopular: true, animationType: 'medal-impact', animationDuration: 5, glowColor: '#e4a52e', particleColor: '#fff5a8', description: 'A polished champion medal with metallic sparks.' },
  { slug: 'lets-ride', name: "Let's Ride", price: 1000, category: 'luxury', isFeatured: true, animationType: 'neon-drive', animationDuration: 7, glowColor: '#20b9e9', particleColor: '#b8fbff', description: 'A futuristic performance car with neon trails.' },
  { slug: 'gold-medal', name: 'Gold Medal', price: 1500, category: 'luxury', animationType: 'gold-impact', animationDuration: 7, glowColor: '#e2a51d', particleColor: '#fff3a0', description: 'A grand gold medal surrounded by a victory burst.' },
  { slug: 'elite-status', name: 'Elite Status', price: 2000, category: 'luxury', isTrending: true, animationType: 'jet-flyby', animationDuration: 8, glowColor: '#68b7ff', particleColor: '#e4fbff', description: 'A private aircraft crossing the room in luxury.' },
  { slug: 'yacht', name: 'Yacht', price: 2250, category: 'luxury', isFeatured: true, artworkType: 'yacht', animationType: 'ocean-sail', animationDuration: 8, glowColor: '#1ed4ef', particleColor: '#e7ffff', description: 'A luxury yacht sailing through crystalline blue water.' },
  { slug: 'diamond', name: 'Diamond', price: 2500, category: 'luxury', isFeatured: true, isLegendary: true, artworkType: 'diamond', animationType: 'crystal-refraction', animationDuration: 9, glowColor: '#69d9ff', particleColor: '#ffffff', description: 'A monumental ice-blue diamond with brilliant refraction.' },
  { slug: 'crown', name: 'Crown', price: 3000, category: 'luxury', isFeatured: true, isTrending: true, isLegendary: true, artworkType: 'crown', animationType: 'royal-cinematic', animationDuration: 10, glowColor: '#8b5cf6', particleColor: '#65f4ff', description: 'The ultimate jeweled crown in royal violet and sapphire light.' },
];

const extraNames = [
  ['neon-flare','Neon Flare',15,'flame'],['ember-orbit','Ember Orbit',20,'flame'],['solar-cinder','Solar Cinder',25,'flame'],['crimson-bloom','Crimson Bloom',50,'rose'],['velvet-rose','Velvet Rose',75,'rose'],['aurora-petal','Aurora Petal',100,'rose'],['prism-kiss','Prism Kiss',150,'heart'],['luminous-embrace','Luminous Embrace',200,'heart'],['starry-love','Starry Love',250,'heart'],['confetti-rocket','Confetti Rocket',50,'happy'],['aurora-party','Aurora Party',100,'happy'],['celebration-orb','Celebration Orb',250,'happy'],['moon-shell','Moon Shell',300,'pearl'],['iridescent-relic','Iridescent Relic',400,'pearl'],['tide-pearl','Tide Pearl',500,'pearl'],['champion-ribbon','Champion Ribbon',350,'medal'],['victory-medallion','Victory Medallion',500,'medal'],['diamond-league','Diamond League',750,'medal'],['hyper-roadster','Hyper Roadster',1000,'car'],['aurora-coupe','Aurora Coupe',1250,'car'],['velocity-x','Velocity X',1500,'car'],['skyline-jet','Skyline Jet',1000,'jet'],['cloud-nine','Cloud Nine',1500,'jet'],['royal-flight','Royal Flight',2000,'jet'],['frost-prism','Frost Prism',1000,'diamond'],['glacier-shard','Glacier Shard',1500,'diamond'],['polar-star','Polar Star',2000,'diamond'],['solar-crown','Solar Crown',1500,'crown'],['empire-crown','Empire Crown',2000,'crown'],['celestial-crown','Celestial Crown',2500,'crown'],['crystal-star','Crystal Star',50,'artifact'],['violet-comet','Violet Comet',100,'artifact'],['quantum-orb','Quantum Orb',250,'artifact'],['holo-badge','Holo Badge',500,'medal'],['plasma-ring','Plasma Ring',750,'artifact'],['nova-scepter','Nova Scepter',1000,'crown'],['eclipse-gem','Eclipse Gem',1250,'diamond'],['starlight-capsule','Starlight Capsule',1500,'artifact'],['infinite-spark','Infinite Spark',2000,'artifact'],['galaxy-crest','Galaxy Crest',2500,'crown'],['cosmic-wings','Cosmic Wings',3000,'jet'],['phoenix-flame','Phoenix Flame',3000,'flame'],['royal-dragon','Royal Dragon',3000,'artifact'],['aurora-castle','Aurora Castle',3000,'crown'],['platinum-throne','Platinum Throne',3000,'medal'],['time-crystal','Time Crystal',3000,'diamond'],['nebula-heart','Nebula Heart',3000,'heart'],['lunar-rose','Lunar Rose',2000,'rose'],['golden-horizon','Golden Horizon',2500,'artifact'],
] as const;

const palettes = [
  ['#7c3cff', '#ff4fbd'], ['#16d9ff', '#536dff'], ['#ff4b7d', '#ffbf69'],
  ['#49f5c7', '#8b5cf6'], ['#ffe37a', '#ff7a1a'], ['#b8fbff', '#4f71ff'],
] as const;

const extraGifts = extraNames.map(([slug, name, price, artworkType], index) => {
  const colors = palettes[index % palettes.length];
  return { slug, name, price, category: (price >= 1000 ? 'luxury' : price >= 250 ? 'premium' : 'popular'), artworkType, animationType: `premium-${artworkType}`, animationDuration: price >= 1000 ? 8 : price >= 250 ? 5 : 3, glowColor: colors[0], particleColor: colors[1], isLegendary: price >= 2500, isFeatured: price >= 1500 || index % 11 === 0, isTrending: index % 7 === 0, isPopular: price < 500 && index % 3 === 0, description: `A bespoke ${name} digital sculpture with cinematic VANTA lighting.`, sortOrder: index + 14 };
});

const inferArtwork = (slug: string) => {
  if (/fire|flame|flare|cinder|ember|phoenix/.test(slug)) return 'flame';
  if (/rose|bloom|petal/.test(slug)) return 'rose';
  if (/heart|love|kiss|embrace/.test(slug)) return 'heart';
  if (/pearl|shell/.test(slug)) return 'pearl';
  if (/medal|place|champion|league|badge|throne/.test(slug)) return 'medal';
  if (/ride|roadster|coupe|velocity/.test(slug)) return 'car';
  if (/jet|flight|cloud|wings|elite/.test(slug)) return 'jet';
  if (/diamond|ice|prism|glacier|gem|crystal/.test(slug)) return 'diamond';
  if (/crown|royalty|crest|scepter|castle/.test(slug)) return 'crown';
  if (/happy|party|confetti|celebration/.test(slug)) return 'happy';
  if (/thumb/.test(slug)) return 'thumb';
  return 'artifact';
};

export const initialGiftCatalog = [...core, ...extraGifts].map((gift, index) => ({
  ...gift, artworkType: gift.artworkType || inferArtwork(gift.slug),
  rarity: gift.price >= 2500 ? 'mythic' : gift.price >= 1000 ? 'legendary' : gift.price >= 250 ? 'rare' : 'common',
  tier: gift.price >= 1000 ? 'high' : gift.price >= 50 ? 'mid' : 'low', impactLevel: gift.price >= 2500 ? 5 : gift.price >= 1000 ? 4 : gift.price >= 250 ? 3 : gift.price >= 50 ? 2 : 1,
  effectProfile: gift.price >= 1000 ? 'cinematic-burst' : gift.price >= 250 ? 'particle-reveal' : 'polished-shimmer', sortOrder: 'sortOrder' in gift ? gift.sortOrder : index + 1,
}));
