'use client';

import Link from 'next/link';
import { CalendarDays, Copy, Ellipsis, Gift, Link2, MapPin, MessageCircle, Pencil, Share2, UserCheck, UserPlus } from 'lucide-react';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useEffect, useState } from 'react';
import Avatar from '@/components/ui/Avatar';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import type { ProfileData } from './profileTypes';
import { finite, formatCount, joinedDate, safeWebsite } from './profileTypes';

type Props = {
  profile: ProfileData;
  own: boolean;
  menuOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement>;
  onMenu: () => void;
  onFollow: () => void;
  onMessage: () => void;
  onGift: () => void;
  onCopy: () => void;
  onPeople: (_kind: 'followers' | 'following') => void;
  followPending?: boolean;
};

export default function ProfileHeader({ profile, own, menuOpen, menuRef, onMenu, onFollow, onMessage, onGift, onCopy, onPeople, followPending = false }: Props) {
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>();
  const avatar = resolveMediaUrl(profile.avatarUrl || profile.profile?.avatarUrl || profile.avatar || '');
  const cover = resolveMediaUrl(profile.bannerUrl || profile.profile?.bannerUrl || '') || '';
  const stats = {
    followers: finite(profile.stats?.followers ?? profile.stats?.totalFollowers ?? profile.counts?.followers ?? profile._count?.followers),
    following: finite(profile.stats?.following ?? profile.stats?.totalFollowing ?? profile.counts?.following ?? profile._count?.following),
    posts: finite(profile.stats?.posts ?? profile.stats?.totalPosts ?? profile.counts?.posts ?? profile._count?.posts),
    live: finite(profile.stats?.live ?? profile.stats?.liveSessions ?? profile.stats?.totalStreams ?? profile.counts?.live ?? profile._count?.livestreams),
  };

  const displayName = profile.fullName || profile.displayName || profile.username;

  useEffect(() => {
    if (!menuOpen) return;

    const updateMenuPosition = () => {
      const trigger = menuRef.current?.querySelector<HTMLButtonElement>('.profile-icon');
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = Math.min(210, window.innerWidth - 24);
      const menuHeight = own ? 98 : 54;
      const gap = 8;
      const left = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12));
      const below = rect.bottom + gap;
      const top = below + menuHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - menuHeight - gap);
      setMenuPosition({ top, left, width: menuWidth });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuOpen, menuRef, own]);

  return <header className="profile-header">
    <div className={`profile-cover ${cover ? 'has-image' : 'cover-fallback'}`} style={cover ? { backgroundImage: `url("${cover.replace(/"/g, '%22')}")` } : undefined}>
      {!cover && <><span className="cover-rule" aria-hidden="true" /><span className="cover-monogram" aria-hidden="true">V</span></>}
      <span className="cover-brand" aria-hidden="true">VANTA / PROFILE</span>
    </div>

    <div className="profile-overview">
      <div className="profile-anchor-row">
        <div className="profile-avatar">
          <Avatar src={avatar} alt={`${displayName}'s profile photo`} size="xl" fallback={displayName} />
        </div>
      </div>

      <div className="profile-identity">
        <div className="name-line">
          <h1>{displayName}</h1>
          {profile.verified && <VerificationBadge verified size="md" />}
        </div>
        <p className="profile-handle">@{profile.username}</p>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        <div className="profile-meta">
          {(profile.location || profile.city || profile.country) && <span><MapPin size={14} />{profile.location || [profile.city, profile.country].filter(Boolean).join(', ')}</span>}
          {safeWebsite(profile.website) && <a href={safeWebsite(profile.website)} target="_blank" rel="noreferrer"><Link2 size={14} />{profile.website!.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>}
          {joinedDate(profile) && <span><CalendarDays size={14} />Joined {joinedDate(profile)}</span>}
        </div>
      </div>

      <div className="profile-actions">
        {own ? <button className="profile-button share-action" onClick={onCopy} aria-label="Share profile"><Share2 size={16} /></button> : <><button className={`profile-button ${profile.isFollowing ? '' : 'primary'}`} onClick={onFollow} disabled={followPending} aria-busy={followPending}>{profile.isFollowing ? <UserCheck size={16} /> : <UserPlus size={16} />}{followPending ? 'Updating' : profile.isFollowing ? 'Following' : 'Follow'}</button><button className="profile-button message" onClick={onMessage} aria-label="Message"><MessageCircle size={16} /><span>Message</span></button><button className="profile-button share-action" onClick={onCopy} aria-label="Share profile"><Share2 size={16} /></button><button className="profile-button gift-action" onClick={onGift} aria-label="Send gift"><Gift size={16} /></button></>}
        <div className="profile-menu-wrap" ref={menuRef}>
          <button className="profile-icon" title="More actions" aria-label="More profile actions" aria-expanded={menuOpen} onClick={onMenu}><Ellipsis size={19} /></button>
          {menuOpen && <div className="profile-menu" role="menu" style={menuPosition}>
            {own && <Link href="/profile/editprofile" role="menuitem" onClick={onMenu}><Pencil size={16} />Edit Profile</Link>}
            <button type="button" role="menuitem" onClick={onCopy}><Copy size={16} />Copy Profile Link</button>
          </div>}
        </div>
      </div>

      <div className="profile-stats" aria-label="Profile statistics">
        <div><strong>{formatCount(stats.posts)}</strong><span>Posts</span></div>
        <button onClick={() => onPeople('followers')}><strong>{formatCount(stats.followers)}</strong><span>Followers</span></button>
        <button onClick={() => onPeople('following')}><strong>{formatCount(stats.following)}</strong><span>Following</span></button>
        <div><strong>{formatCount(stats.live)}</strong><span>Live</span></div>
      </div>
    </div>
  </header>;
}