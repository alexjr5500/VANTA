import { API_BASE_URL } from './api';

/**
 * The single canonical default avatar for VANTA accounts that genuinely have no
 * profile picture. A self-contained SVG data URI so it renders identically on
 * every page, every browser and every device without an extra network request.
 */
export const DEFAULT_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2a2a30"/>
          <stop offset="1" stop-color="#151517"/>
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="48" fill="url(#g)"/>
      <circle cx="48" cy="39" r="24" fill="#3a3a42"/>
      <path d="M12 88c6-24 19-34 36-34s30 10 36 34" fill="#3a3a42"/>
    </svg>`
  );

/**
 * Resolve media references returned by the API against the API/storage origin.
 * Upload records may contain `/uploads/...` paths so they remain portable
 * between environments; resolving them in the browser prevents Next.js from
 * incorrectly receiving those media requests.
 *
 * Handles:
 *  - `blob:` / `data:` (object URLs / uploaded-then-optimized previews) - pass through
 *  - `/uploads/...`   - resolved against the API origin this browser uses
 *  - `uploads/...`    - legacy bare form, same resolution
 *  - `<filename>`     - even older records that stored only the filename
 *  - `http(s)://<host>/uploads/...` - any host (localhost, LAN IP, old dev host)
 *    that previously pointed at OUR /uploads mount is rewritten to the current
 *    API origin so media does not depend on the uploader's machine
 *  - external/CDN URLs (e.g. Cloudinary) - left untouched
 *  - local filesystem paths (`C:\...`, `\\server\...`) - rejected, cannot be served
 */
export function resolveMediaUrl(value?: string | null): string {
  const source = value?.trim();
  if (!source) return '';

  if (/^(?:blob:|data:)/i.test(source)) return source;

  // Local filesystem / Windows paths are never browser-addressable media.
  if (/^[a-zA-Z]:[\\/]/.test(source) || /^\\\\/.test(source)) return '';

  // Protocol-relative ("//host/path") - resolve against the API origin.
  if (source.startsWith('//')) {
    try {
      return `${new URL(API_BASE_URL).origin}${source}`;
    } catch {
      return `${API_BASE_URL}${source}`;
    }
  }

  if (/^https?:\/\//i.test(source)) {
    try {
      const parsed = new URL(source);
      const apiOrigin = new URL(API_BASE_URL).origin;
      // `/uploads/**` is THIS backend's own storage mount, so any absolute URL
      // pointing at that path must always be resolved against the API origin this
      // browser is currently configured to use. Real external/CDN URLs (for
      // example Cloudinary `res.cloudinary.com/...`) do not use the `/uploads`
      // mount and are left untouched.
      if (/^\/(?:uploads|api\/files)\//i.test(parsed.pathname)) {
        return `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
      if (parsed.origin === apiOrigin) return source;

      const host = parsed.hostname;
      const isLoopbackAuthority = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
      // Private/LAN ranges: 10.x, 192.168.x, 172.16-31.x, and *.local mDNS.
      const isPrivateLanAuthority =
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /\.local$/i.test(host);

      if (isLoopbackAuthority || isPrivateLanAuthority) {
        return `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
      return source;
    } catch {
      return source;
    }
  }

  // Older upload records stored only the generated filename, while the
  // backend serves local media from /uploads. Resolve both that legacy shape
  // and the current /uploads/... path to the API origin.
  const normalized = source.replace(/^\/+/, '');
  const uploadPath = normalized.startsWith('uploads/')
    ? `/${normalized}`
    : `/uploads/${normalized}`;

  try {
    return new URL(uploadPath, `${API_BASE_URL}/`).toString();
  } catch {
    return uploadPath;
  }
}
