'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, UserCheck, UserPlus, Users, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import type { ProfileItem } from './profileTypes';
import { unwrap } from './profileTypes';

/**
 * PeopleDialog — the single Followers / Following experience for VANTA.
 *
 * Layout is a stable modal shell (header + search are fixed) with an
 * independently scrolling list body, so the modal never jumps while the list
 * scrolls and the page behind it is never scrollable. Each row uses a fixed
 * right-aligned action column so the Follow/Following button never shifts or
 * overlaps the username — long names/usernames are ellipsized instead.
 */

export default function PeopleDialog({ kind, own, username, token, currentUserId, close }: { kind: 'followers' | 'following'; own: boolean; username: string; token?: string; currentUserId?: string; close: () => void }) {
  const [rows, setRows] = useState<ProfileItem[]>([]); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const pendingRef = useRef(new Set<string>());
  const title = kind === 'followers' ? 'Followers' : 'Following';
  useEffect(() => {
    const path = own ? `/api/profiles/me/${kind}` : `/api/profiles/${encodeURIComponent(username)}/${kind}`;
    let active = true;
    setLoading(true); setLoadError(''); setActionError('');
    apiGet<any>(`${path}?limit=60`, token, { skipCache: true })
      .then(result => { if (active) setRows(unwrap(result)); })
      .catch((reason: any) => {
        if (active && reason?.statusCode !== 499) setLoadError(reason?.message || `Unable to load ${kind}.`);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, own, token, username, retryKey]);
  const filtered = useMemo(() => { const value = query.trim().toLowerCase(); return value ? rows.filter(person => `${person.fullName || ''} ${person.username || ''}`.toLowerCase().includes(value)) : rows; }, [query, rows]);

  // Lock body scroll while the modal is open and allow closing with Escape.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close(); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey); };
  }, [close]);

  const toggleFollow = async (person: ProfileItem) => {
    if (!token || person.id === currentUserId || pendingRef.current.has(person.username)) return;
    pendingRef.current.add(person.username);
    const following = !!person.isFollowing;
    setPending(person.username); setActionError('');
    try {
      const result: any = following ? await apiDelete(`/api/profiles/${encodeURIComponent(person.username)}/follow`, token) : await apiPost(`/api/profiles/${encodeURIComponent(person.username)}/follow`, {}, token);
      setRows(current => current.map(row => row.username === person.username ? { ...row, isFollowing: typeof result?.isFollowing === 'boolean' ? result.isFollowing : !following } : row));
      window.dispatchEvent(new CustomEvent('vanta:follow-updated', { detail: result }));
    } catch (reason: any) { setActionError(reason?.message || `Unable to ${following ? 'unfollow' : 'follow'} @${person.username}.`); }
    finally { pendingRef.current.delete(person.username); setPending(null); }
  };
  return (
    <>
      <button className="dialog-backdrop" aria-label={`Close ${title}`} onClick={close} />
      <section className="people-dialog" role="dialog" aria-modal="true" aria-labelledby="people-title">
        <header>
          <div className="people-dialog-title">
            <h2 id="people-title">{title}</h2>
            <p>@{username}</p>
          </div>
          <button className="dialog-close" aria-label={`Close ${title}`} onClick={close}><X size={18} /></button>
        </header>
        <label className="people-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} autoFocus aria-label={`Search ${title}`} /></label>
        {actionError && <p className="dialog-alert" role="alert">{actionError}</p>}
        <div className="people-body">
          {loading ? <div className="people-state"><Loader2 className="spin" /><span>Loading {title.toLowerCase()}…</span></div>
            : loadError ? <div className="people-state"><Users size={22} /><span>{loadError}</span><button type="button" className="people-retry" onClick={() => setRetryKey(value => value + 1)}>Try again</button></div>
            : filtered.length ? filtered.map(person => <div className="people-row" key={person.id}>
                <Link href={`/profile/${person.username}`} onClick={close} className="people-link"><Avatar src={person.avatarUrl || person.avatar} alt={`${person.fullName || person.username}'s profile photo`} size="md" /><span className="people-name"><b className="people-display"><span className="inline-flex min-w-0 items-center gap-1"><span className="truncate">{person.fullName || person.username}</span>{person.verified && person.verificationType && <VerificationBadge verified type={person.verificationType} size="sm" showTooltip className="shrink-0 align-[-2px]" />}</span></b><small className="people-handle">@{person.username}</small></span></Link>
                {token && person.id !== currentUserId && <button className="people-follow" disabled={pending === person.username} onClick={() => void toggleFollow(person)} aria-busy={pending === person.username} aria-label={`${person.isFollowing ? 'Unfollow' : 'Follow'} @${person.username}`}>{pending === person.username ? <Loader2 className="spin-small" /> : person.isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />}<span>{pending === person.username ? 'Updating' : person.isFollowing ? 'Following' : 'Follow'}</span></button>}
              </div>)
            : <div className="people-state"><Users size={22} /><span>{rows.length ? `No ${title.toLowerCase()} match your search.` : `No ${title.toLowerCase()} yet.`}</span></div>}
        </div>
      </section>
    </>
  );
}