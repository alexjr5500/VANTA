'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, UserCheck, UserPlus, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import type { ProfileItem } from './profileTypes';
import { unwrap } from './profileTypes';

export default function PeopleDialog({ kind, own, username, token, currentUserId, close }: { kind: 'followers' | 'following'; own: boolean; username: string; token?: string; currentUserId?: string; close: () => void }) {
  const [rows, setRows] = useState<ProfileItem[]>([]); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const path = own ? `/api/profiles/me/${kind}` : `/api/profiles/${encodeURIComponent(username)}/${kind}`;
    setLoading(true); setLoadError(''); setActionError('');
    apiGet<any>(`${path}?limit=40`, token, { skipCache: true })
      .then(result => setRows(unwrap(result)))
      .catch((reason: any) => setLoadError(reason?.message || `Unable to load ${kind}.`))
      .finally(() => setLoading(false));
  }, [kind, own, token, username]);
  const filtered = useMemo(() => { const value = query.trim().toLowerCase(); return value ? rows.filter(person => `${person.fullName || ''} ${person.username || ''}`.toLowerCase().includes(value)) : rows; }, [query, rows]);
  return <><button className="dialog-backdrop" aria-label="Close" onClick={close} /><section className="people-dialog" role="dialog" aria-modal="true" aria-labelledby="people-title">
    <header><div><h2 id="people-title">{kind}</h2><p>@{username}</p></div><button className="dialog-close" aria-label="Close" onClick={close}><X size={18} /></button></header>
    <label className="people-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${kind}`} autoFocus /></label>
    {actionError && <p className="dialog-alert" role="alert">{actionError}</p>}
    {loading ? <Loader2 className="spin" /> : loadError ? <p className="dialog-empty" role="alert">{loadError}</p> : filtered.length ? filtered.map(person => <div className="people-row" key={person.id}><Link href={`/profile/${person.username}`} onClick={close}><Avatar src={person.avatarUrl || person.avatar} alt={`${person.fullName || person.username}'s profile photo`} size="md" /><span><b>{person.fullName || person.username}</b><small>@{person.username}</small></span>{person.verified && <VerificationBadge type="BLUE" size="sm" showTooltip />}</Link>{token && person.id !== currentUserId && <button className="people-follow" disabled={pending === person.username} onClick={async () => { const following = !!person.isFollowing; setPending(person.username); setActionError(''); try { const result: any = following ? await apiDelete(`/api/profiles/${encodeURIComponent(person.username)}/follow`, token) : await apiPost(`/api/profiles/${encodeURIComponent(person.username)}/follow`, {}, token); setRows(current => current.map(row => row.username === person.username ? { ...row, isFollowing: !!result?.isFollowing } : row)); window.dispatchEvent(new CustomEvent('vanta:follow-updated', { detail: result })); } catch (reason: any) { setActionError(reason?.message || `Unable to ${following ? 'unfollow' : 'follow'} @${person.username}.`); } finally { setPending(null); } }} aria-label={`${person.isFollowing ? 'Unfollow' : 'Follow'} @${person.username}`}>{person.isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />}{person.isFollowing ? 'Following' : 'Follow'}</button>}</div>) : <p className="dialog-empty">{rows.length ? `No ${kind} match your search.` : `No ${kind} yet.`}</p>}
  </section></>;
}