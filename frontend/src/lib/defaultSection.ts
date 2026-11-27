export const SECTION_OPTIONS = {
  timeline: [{value:'forYou',label:'For you'},{value:'following',label:'Following'}],
  explore: [{value:'forYou',label:'For you'},{value:'trending',label:'Trending'},{value:'homes',label:'VANTA Homes'},{value:'creators',label:'Creators'},{value:'reels',label:'Reels'},{value:'live',label:'Live'},{value:'communities',label:'Communities'}],
  live: [{value:'forYou',label:'For you'},{value:'following',label:'Following'},{value:'popular',label:'Popular'}],
} as const;
export type SectionArea = keyof typeof SECTION_OPTIONS;
type SectionValue<A extends SectionArea> = typeof SECTION_OPTIONS[A][number]['value'];
export function parseDefaultSection<A extends SectionArea>(area: A, raw: unknown): SectionValue<A> {
  return (SECTION_OPTIONS[area].some(item => item.value === raw) ? raw : 'forYou') as SectionValue<A>;
}
export function readDefaultSection<A extends SectionArea>(area: A): SectionValue<A> {
  try { return parseDefaultSection(area, localStorage.getItem('vanta_default_section:' + area)); }
  catch { return parseDefaultSection(area, null); }
}
export function writeDefaultSection(area: SectionArea, value: string) {
  if (!SECTION_OPTIONS[area].some(item => item.value === value)) throw new Error('Invalid section');
  localStorage.setItem('vanta_default_section:' + area, value);
}
