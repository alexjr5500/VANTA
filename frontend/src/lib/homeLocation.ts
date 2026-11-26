/** Homes displays the owner's public locality fields, not geocoded areas or land measurements. */
export function homeLocationLine(listing: {area?: unknown; city?: unknown; state?: unknown; country?: unknown} | null | undefined, fallback = 'Location to be confirmed'): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of [listing?.area, listing?.city, listing?.state, listing?.country]) {
    if (typeof value !== 'string') continue;
    const label = value.trim().replace(/\s+/g, ' ');
    const key = label.toLocaleLowerCase('en');
    if (!label || seen.has(key)) continue;
    seen.add(key);
    parts.push(label);
  }
  return parts.join(', ') || fallback;
}
