'use client';

import Link from 'next/link';
import { CalendarDays, Gift, Link2, MapPin, MessageCircle, Pencil, Share2, UserCheck, UserPlus } from 'lucide-react';
import VerificationBadge from '@/components/ui/VerificationBadge';
import Avatar from '@/components/ui/Avatar';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import type { ProfileData } from './profileTypes';
import { finite, formatCount, joinedDate, safeWebsite } from './profileTypes';

type Props = {
  profile: ProfileData;
  own: boolean;
  onFollow: () => void;
  onMessage: () => void;
  onGift: () => void;
  onCopy: () => void;
  onPeople: (_kind: 'followers' | 'following') => void;
  followPending?: boolean;
};

export default function ProfileHeader({ profile, own, onFollow, onMessage, onGift, onCopy, onPeople, followPending = false }: Props) {
  const avatar = resolveMediaUrl(profile.avatarUrl || profile.profile?.avatarUrl || profile.avatar || '');
  const cover = resolveMediaUrl(profile.bannerUrl || profile.profile?.bannerUrl || '' ) || '';
  const stats = {
    following: finite(profile.stats?.following ?? profile.stats?.totalFollowing ?? profile.counts?.following ?? profile._count?.following),
    followers: finite(profile.stats?.followers ?? profile.stats?.totalFollowers ?? profile.counts?.followers ?? profile._count?.followers),
    posts: finite(profile.stats?.posts ?? profile.stats?.totalPosts ?? profile.counts?.posts ?? profile._count?.posts),
    likes: finite(profile.stats?.likes ?? profile.stats?.totalLikes ?? profile.counts?.likes ?? profile._count?.likes),
  };

  const displayName = profile.fullName || profile.displayName || profile.username;

  return <header className="profile-header">
    <div className={`profile-cover ${cover ? 'has-image' : 'cover-fallback'}`} style={cover ? { backgroundImage: `url("${cover.replace(/"/g, '%22')}")` } : undefined}>
      {!cover && <><span className="cover-rule" aria-hidden="true" /><span className="cover-monogram" aria-hidden="true">V</span></>}
      <span className="cover-brand" aria-hidden="true">VANTA / PROFILE</span>
    </div>

    <div className="profile-overview">
      {/* The avatar sits on the cover's bottom-left edge, and the compact
          action buttons straddle the cover/profile boundary on the right so
          the header stays tight (no tall separate action row). */}
      <div className="profile-avatar">
        <Avatar src={avatar} alt={`${displayName}'s profile photo`} size="xl" fallback={displayName} />
      </div>

      <div className="profile-actions">
        {own ? (
          <>
            <Link className="profile-pill edit-action" href="/profile/editprofile" aria-label="Edit profile"><Pencil size={14} /><span>Edit Profile</span></Link>
            <button className="profile-icon share-action" onClick={onCopy} aria-label="Share profile"><Share2 size={16} /></button>
          </>
        ) : (
          <>
            <button className={`profile-pill ${profile.isFollowing ? '' : 'primary'}`} onClick={onFollow} disabled={followPending} aria-busy={followPending}>
              {profile.isFollowing ? <><UserCheck size={14} /><span>{followPending ? 'Updating' : 'Following'}</span></> : <><UserPlus size={14} /><span>{followPending ? 'Updating' : 'Follow'}</span></>}
            </button>
            <button className="profile-icon message" onClick={onMessage} aria-label="Message"><MessageCircle size={16} /></button>
            <button className="profile-icon share-action" onClick={onCopy} aria-label="Share profile"><Share2 size={16} /></button>
            <button className="profile-icon gift-action" onClick={onGift} aria-label="Send gift"><Gift size={16} /></button>
          </>
        )}
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

      <div className="profile-stats" aria-label="Profile statistics">
        {/* One clean horizontal row: count above its label, four equal columns.
            1.2K   Followers / 532   Following / 87   Posts / 4.8K Likes. */}
        <button onClick={() => onPeople('followers')}><strong>{formatCount(stats.followers)}</strong><span>Followers</span></button>
        <button onClick={() => onPeople('following')}><strong>{formatCount(stats.following)}</strong><span>Following</span></button>
        <div><strong>{formatCount(stats.posts)}</strong><span>Posts</span></div>
        <div><strong>{formatCount(stats.likes)}</strong><span>Likes</span></div>
      </div>
    </div>
  </header>;
}