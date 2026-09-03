'use client';

export const PROFILE_MEDIA_EVENT = 'vanta:profile-media-updated';

export type ProfileMediaUpdate = {
  userId: string;
  avatar?: string | null;
  bannerUrl?: string | null;
  previousAvatar?: string | null;
  previousBannerUrl?: string | null;
  updatedAt: number;
};

export function stripMediaVersion(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    parsed.searchParams.delete('v');
    return url.startsWith('http') ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url.replace(/([?&])v=\d+(&?)/, (_match, prefix, suffix) => suffix ? prefix : '').replace(/[?&]$/, '');
  }
}

export function versionMediaUrl(url?: string | null, version = Date.now()): string | null {
  const clean = stripMediaVersion(url);
  if (!clean || clean.startsWith('blob:') || clean.startsWith('data:')) return clean;
  const separator = clean.includes('?') ? '&' : '?';
  return `${clean}${separator}v=${version}`;
}

export function mediaUrlsMatch(left?: string | null, right?: string | null): boolean {
  return stripMediaVersion(left) === stripMediaVersion(right);
}

export function emitProfileMediaUpdate(detail: ProfileMediaUpdate) {
  window.dispatchEvent(new CustomEvent<ProfileMediaUpdate>(PROFILE_MEDIA_EVENT, { detail }));
}