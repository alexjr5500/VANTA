/** A receiving link identifies an account only, never authorizes a transfer. */
export function parseReceivingLink(raw: string, trustedOrigins: string[]): string | null {
  if (raw.length > 2048) return null;
  try {
    const url = new URL(raw.trim());
    if (url.username || url.password || url.hash || url.pathname !== '/balance') return null;
    if (!trustedOrigins.includes(url.origin) || !['https:', 'http:'].includes(url.protocol)) return null;
    const entries = Array.from(url.searchParams.entries());
    if (entries.length !== 1 || entries[0][0] !== 'recipient') return null;
    const id = entries[0][1];
    return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
  } catch { return null; }
}
export function receivingOrigins(): string[] {
  const origins = ['https://vanta.app'];
  if (typeof window !== 'undefined') origins.push(window.location.origin);
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) { try { origins.push(new URL(configured).origin); } catch { /* invalid configuration */ } }
  return origins;
}
