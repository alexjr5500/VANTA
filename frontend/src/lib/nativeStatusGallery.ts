export interface NativeRecentMedia {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  thumbnailUrl: string;
  mediaUrl: string;
}

export type NativeGalleryStatus = 'loading' | 'permission' | 'ready' | 'unavailable' | 'error';

export interface NativeStatusGalleryBridge {
  listRecent: (nonce: string) => string;
  requestAccess: (nonce: string) => void;
}

declare global {
  interface Window {
    VantaNativeGallery?: NativeStatusGalleryBridge;
    __VANTA_NATIVE_GALLERY_NONCE__?: string;
  }
}

export function nativeGalleryConnection(): { bridge: NativeStatusGalleryBridge; nonce: string } | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.VantaNativeGallery;
  const nonce = window.__VANTA_NATIVE_GALLERY_NONCE__;
  if (!bridge || typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(nonce)) return null;
  return { bridge, nonce };
}

/** Accept only media URLs produced by the current trusted Android activity. */
export function parseNativeGallery(raw: string, origin: string, nonce: string): {
  status: NativeGalleryStatus;
  items: NativeRecentMedia[];
} {
  try {
    const payload = JSON.parse(raw) as { status?: string; items?: unknown };
    const status: NativeGalleryStatus =
      payload.status === 'ready' || payload.status === 'permission' || payload.status === 'error'
        ? payload.status : 'unavailable';
    const items = Array.isArray(payload.items) ? payload.items : [];
    const prefix = origin.replace(/\/$/, '') + '/__vanta_native_gallery/' + nonce + '/';
    return {
      status,
      items: status !== 'ready' ? [] : items.slice(0, 120).flatMap((value): NativeRecentMedia[] => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Record<string, unknown>;
        const id = item.id;
        const name = item.name;
        const mimeType = item.mimeType;
        const size = item.size;
        const thumbnailUrl = item.thumbnailUrl;
        const mediaUrl = item.mediaUrl;
        if (typeof id !== 'string' || !/^[iv][0-9]+$/.test(id) ||
          typeof name !== 'string' || !name || name.length > 160 ||
          typeof mimeType !== 'string' || !/^(image|video)\/[A-Za-z0-9.+-]+$/.test(mimeType) ||
          typeof size !== 'number' || !Number.isFinite(size) || size < 0 ||
          typeof thumbnailUrl !== 'string' || thumbnailUrl !== prefix + 'thumb/' + id ||
          typeof mediaUrl !== 'string' || mediaUrl !== prefix + 'full/' + id
        ) return [];
        return [{ id, name, mimeType, size, thumbnailUrl, mediaUrl }];
      }),
    };
  } catch {
    return { status: 'error', items: [] };
  }
}
