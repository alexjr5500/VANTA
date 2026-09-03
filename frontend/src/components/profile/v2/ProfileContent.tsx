'use client';

import { Bookmark, CalendarDays, Eye, Film, Gift, Globe2, Heart, Image as ImageIcon, Info, Link2, MapPin, MessageCircle, Play, Radio, Share2, Trash2 } from 'lucide-react';
import type { ProfileData, ProfileItem, ProfileTab } from './profileTypes';
import { cleanPostId, formatCount, joinedDate, mediaUrl, postKind, safeWebsite } from './profileTypes';

type Props = {
  tab: ProfileTab; rows: ProfileItem[]; profile: ProfileData; own: boolean; router: any;
  onLike: (_item: ProfileItem) => void; onSave: (_item: ProfileItem) => void;
  onComment: (_item: ProfileItem) => void; onGift: (_item: ProfileItem) => void;
  onDelete: (_item: ProfileItem) => void; onShare: (_item: ProfileItem) => void;
  onCreate?: () => void;
};

export default function ProfileContent(props: Props) {
  const { tab, rows, profile, own, router, onLike, onSave, onComment, onGift, onDelete, onShare, onCreate } = props;
  if (tab === 'about') return <About profile={profile} />;
  if (!rows.length) return <Empty tab={tab} own={own} onCreate={onCreate} />;
  return <div className="content-grid">{rows.map(item => {
    const image = mediaUrl(item);
    const isLive = tab === 'live';
    const kind = isLive || tab === 'reels' ? 'video' : postKind(item);
    const isVideo = kind === 'video';
    const isText = kind === 'text';
    const destination = isLive ? `/live/${item.id}` : tab === 'reels' ? `/reels/${item.id}` : `/post/${cleanPostId(item)}`;
    return <article className={isText ? 'content-tile tile-text' : 'content-tile'} key={item.id} onDoubleClick={() => (tab === 'posts' || tab === 'likes') && onLike(item)}>
      {isText ? (
        <button className="tile-open tile-text-open" onClick={() => router.push(destination)} aria-label={`Open ${tab} item`}>
          <span className="tile-text-icon"><MessageCircle size={18} /></span>
          <p className="tile-text-body">{item.content || item.title || 'Text post'}</p>
          {(tab === 'posts' || tab === 'likes') && <span className="tile-text-meta"><button onClick={() => onLike(item)} aria-label="Like"><Heart size={12} fill={item.liked ? 'currentColor' : 'none'} />{formatCount(item.likes ?? item._count?.likes)}</button><button onClick={() => onComment(item)} aria-label="Comments"><MessageCircle size={12} />{formatCount(item.comments ?? item._count?.comments)}</button></span>}
        </button>
      ) : (
        <button className="tile-open" onClick={() => router.push(destination)} aria-label={`Open ${tab} item`}>{image ? <img src={image} alt={item.content || item.title || `${tab} item`} loading="lazy" /> : <div className="tile-fallback"><span>{isLive ? <Radio /> : tab === 'reels' ? <Film /> : <ImageIcon />}</span><small>{item.content || item.title || 'VANTA'}</small></div>}</button>
      )}
      {isVideo && !isLive && <span className="tile-type"><Play size={11} className="tile-type-play" />{tab === 'reels' ? 'REEL' : 'VIDEO'}</span>}
      {isLive && <span className={`tile-type ${item.status === 'LIVE' ? 'is-live' : ''}`}>{item.status === 'LIVE' ? 'LIVE' : 'STREAM'}</span>}
      {isVideo && !isLive && <span className="tile-play"><span className="tile-play-chip"><Play size={16} fill="currentColor" /></span></span>}
      {!isText && <div className="tile-overlay"><div className="tile-metrics">{isLive || tab === 'reels' ? <><Eye size={16} />{formatCount(item.views ?? item.viewerCount ?? item.totalViewers)}</> : <><button onClick={() => onLike(item)} aria-label="Like"><Heart size={17} fill={item.liked ? 'currentColor' : 'none'} />{formatCount(item.likes ?? item._count?.likes)}</button><button onClick={() => onComment(item)} aria-label="Comments"><MessageCircle size={17} />{formatCount(item.comments ?? item._count?.comments)}</button></>}</div><div className="tile-actions">{(tab === 'posts' || tab === 'likes') && <><button onClick={() => onShare(item)} aria-label="Share"><Share2 size={16} /></button><button onClick={() => onSave(item)} aria-label="Bookmark"><Bookmark size={16} fill={item.saved ? 'currentColor' : 'none'} /></button>{!own && <button onClick={() => onGift(item)} aria-label="Send gift"><Gift size={16} /></button>}{own && tab === 'posts' && <button onClick={() => onDelete(item)} aria-label="Delete"><Trash2 size={16} /></button>}</>}</div></div>}
    </article>;
  })}</div>;
}

function About({ profile }: { profile: ProfileData }) {
  return <div className="about-list"><h2>About</h2>
    {profile.bio && <section><Info /><div><b>Bio</b><p>{profile.bio}</p></div></section>}
    <section><Globe2 /><div><b>Username</b><p>@{profile.username}</p></div></section>
    {(profile.location || profile.city || profile.country) && <section><MapPin /><div><b>Location</b><p>{profile.location || [profile.city, profile.country].filter(Boolean).join(', ')}</p></div></section>}
    {safeWebsite(profile.website) && <section><Link2 /><div><b>Website</b><a href={safeWebsite(profile.website)} target="_blank" rel="noreferrer">{profile.website}</a></div></section>}
    {joinedDate(profile) && <section><CalendarDays /><div><b>Member since</b><p>{joinedDate(profile)}</p></div></section>}
  </div>;
}

function Empty({ tab, own, onCreate }: { tab: ProfileTab; own: boolean; onCreate?: () => void }) {
  const title = tab === 'likes' && !own ? 'Liked posts are private or unavailable' : `No ${tab === 'live' ? 'live streams' : tab} yet`;
  const Icon = tab === 'live' ? Radio : tab === 'reels' ? Film : tab === 'media' ? ImageIcon : MessageCircle;
  return <div className="profile-empty"><span><Icon /></span><h2>{title}</h2><p>{own ? 'Your published content will appear here.' : 'There is nothing public to show here.'}</p>{own && tab === 'posts' && onCreate && <button className="profile-button primary" onClick={onCreate}>Create post</button>}</div>;
}