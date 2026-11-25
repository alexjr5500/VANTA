'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, ImagePlus, Loader2, Save, UserRound, X } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import ImageCropEditor from '@/components/ui/ImageCropEditor';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPut } from '@/lib/apiClient';
import { MAX_AVATAR_SIZE, MAX_BANNER_SIZE, uploadAvatar, uploadBanner, validateFile } from '@/lib/uploadService';
import { versionMediaUrl } from '@/lib/profileMedia';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import './edit-profile.css';
import './edit-profile-recovery.css';

type Form = { fullName: string; username: string; bio: string; city: string; website: string; dateOfBirth: string };
type Media = { file: File | null; preview: string };
type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';
const empty: Form = { fullName: '', username: '', bio: '', city: '', website: '', dateOfBirth: '' };
const types = ['image/jpeg', 'image/png', 'image/webp'];
const profileValue = (value: any) => value?.profile || value?.data || value;

export default function EditProfilePage() {
  const router = useRouter(); const { token, refreshToken, updateUser, isLoading: authLoading } = useAuth();
  const avatarInput = useRef<HTMLInputElement>(null); const coverInput = useRef<HTMLInputElement>(null);
  const [cropTarget, setCropTarget] = useState<{ kind: 'avatar' | 'cover'; file: File } | null>(null);
  const [form, setForm] = useState<Form>(empty); const [original, setOriginal] = useState<Form>(empty);
  const [avatar, setAvatar] = useState<Media>({ file: null, preview: '' }); const [cover, setCover] = useState<Media>({ file: null, preview: '' });
  const [initialMedia, setInitialMedia] = useState({ avatar: '', cover: '' }); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState<Availability>('idle'); const [progress, setProgress] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0); const [loadFailed, setLoadFailed] = useState(false);
  const profileRequest = useRef(0);
  const usernameCheck = useRef(0);
  const [verifiedUsername, setVerifiedUsername] = useState('');
  const saveInFlight = useRef(false);

  useEffect(() => {
    if (!token) {
      if (!authLoading && !refreshToken) router.replace('/login?next=/profile/editprofile');
      return;
    }
    const requestId = ++profileRequest.current;
    let active = true;
    setLoading(true); setLoadFailed(false); setError('');
    apiGet<any>('/api/profiles/me', token, { skipCache: true }).then(value => {
      if (!active || requestId !== profileRequest.current) return;
      const profile = profileValue(value);
      if (!profile || typeof profile !== 'object' || !profile.username) throw new Error('Your profile data is unavailable.');
      const next = { fullName: profile.fullName || '', username: profile.username || '', bio: profile.bio || '', city: profile.city || '', website: profile.website || '', dateOfBirth: profile.dateOfBirth ? String(profile.dateOfBirth).slice(0, 10) : '' };
      const media = { avatar: profile.avatarUrl || profile.profile?.avatarUrl || profile.avatar || '', cover: profile.bannerUrl || profile.profile?.bannerUrl || '' };
      setForm(next); setOriginal(next); setInitialMedia(media); setAvatar({ file: null, preview: resolveMediaUrl(media.avatar) }); setCover({ file: null, preview: resolveMediaUrl(media.cover) });
      setLoadFailed(false);
    }).catch((reason: any) => {
      if (!active || requestId !== profileRequest.current || reason?.statusCode === 499) return;
      setLoadFailed(true);
      setError(reason?.statusCode === 401 ? 'Your session has expired. Please sign in again.' : reason?.message || 'Unable to load your profile. Check your connection and try again.');
    }).finally(() => {
      if (active && requestId === profileRequest.current) setLoading(false);
    });
    return () => { active = false; };
  }, [authLoading, loadAttempt, refreshToken, router, token]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(original) || !!avatar.file || !!cover.file, [avatar.file, cover.file, form, original]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty && !saving) event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, saving]);
  useEffect(() => () => { if (avatar.file) URL.revokeObjectURL(avatar.preview); }, [avatar.file, avatar.preview]);
  useEffect(() => () => { if (cover.file) URL.revokeObjectURL(cover.preview); }, [cover.file, cover.preview]);

  useEffect(() => {
    const checkId = ++usernameCheck.current;
    const username = form.username.trim().toLowerCase();
    setVerifiedUsername('');
    if (username === original.username.trim().toLowerCase()) { setAvailability('idle'); return; }
    if (!/^[a-z0-9_.]{3,30}$/.test(username)) { setAvailability('invalid'); return; }
    setAvailability('checking');
    let active = true;
    const timer = window.setTimeout(() => apiGet<any>(`/api/auth/check-username?username=${encodeURIComponent(username)}`, token || undefined, { skipCache: true })
      .then(value => {
        if (active && checkId === usernameCheck.current) {
          const available = value?.available === true || value?.data?.available === true;
          setVerifiedUsername(available ? username : '');
          setAvailability(available ? 'available' : 'taken');
        }
      })
      .catch(() => { if (active && checkId === usernameCheck.current) setAvailability('error'); }), 450);
    return () => { active = false; window.clearTimeout(timer); usernameCheck.current += 1; };
  }, [form.username, original.username, token]);

  const setField = (field: keyof Form, value: string) => { setSuccess(''); setError(''); setForm(current => ({ ...current, [field]: value })); };
  const selectImage = (kind: 'avatar' | 'cover', event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const validation = validateFile(file, { maxSize: kind === 'avatar' ? MAX_AVATAR_SIZE : MAX_BANNER_SIZE, allowedTypes: types, fieldName: kind === 'avatar' ? 'Profile photo' : 'Cover photo' });
    if (validation) { setError(validation); return; }
    setCropTarget({ kind, file });
  };
  const applyCrop = (file: File) => {
    if (!cropTarget) return;
    const setter = cropTarget.kind === 'avatar' ? setAvatar : setCover;
    setter({ file, preview: URL.createObjectURL(file) });
    setCropTarget(null); setSuccess(''); setError('');
  };
  const leave = () => { if (dirty && !confirm('Discard your unsaved changes?')) return; router.push('/profile'); };
  const validate = () => {
    const name = form.fullName.trim(); const username = form.username.trim().toLowerCase(); const website = form.website.trim();
    if (name.length < 1 || name.length > 50) return 'Display name must be between 1 and 50 characters.';
    if (!/^[a-z0-9_.]{3,30}$/.test(username)) return 'Username must be 3 to 30 letters, numbers, underscores, or periods.';
    if (username !== original.username.trim().toLowerCase() && (availability !== 'available' || verifiedUsername !== username)) return availability === 'taken' ? 'That username is already taken.' : 'Please wait until your new username has been verified.';
    if (form.bio.length > 260) return 'Bio must be 260 characters or fewer.';
    if (form.city.trim().length > 100) return 'Location must be 100 characters or fewer.';
    if (form.dateOfBirth) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.dateOfBirth);
      const birthDate = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
      if (!match || !birthDate || birthDate.toISOString().slice(0, 10) !== form.dateOfBirth || form.dateOfBirth > new Date().toISOString().slice(0, 10)) return 'Choose a valid date of birth that is not in the future.';
    }
    if (website) { try { new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`); } catch { return 'Enter a valid website URL.'; } }
    return '';
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!token || saving || saveInFlight.current || !dirty) return; const validation = validate(); if (validation) { setError(validation); return; }
    saveInFlight.current = true;
    setSaving(true); setError(''); setSuccess('');
    try {
      let avatarUrl = initialMedia.avatar; let bannerUrl = initialMedia.cover;
      if (avatar.file) { setProgress('Uploading profile photo...'); const result = await uploadAvatar(avatar.file, token); const uploadedUrl = result.url; if (!uploadedUrl) throw new Error(result.error || 'Unable to upload profile photo. Please try again.'); avatarUrl = result.profile?.avatarUrl || result.user?.avatarUrl || String(uploadedUrl); }
      if (cover.file) { setProgress('Uploading cover photo...'); const result = await uploadBanner(cover.file, token); const uploadedUrl = result.url; if (!uploadedUrl) throw new Error(result.error || 'Unable to upload cover photo. Please try again.'); bannerUrl = result.profile?.bannerUrl || result.user?.bannerUrl || String(uploadedUrl); }
      setProgress('Saving changes...'); const website = form.website.trim();
      const payload = { fullName: form.fullName.trim(), username: form.username.trim().toLowerCase(), bio: form.bio.trim(), city: form.city.trim(), website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website, dateOfBirth: form.dateOfBirth || null };
      const saved = profileValue(await apiPut<any>('/api/profiles/me', payload, token));
      await updateUser({ ...saved, ...payload, avatar: avatarUrl, avatarUrl, bannerUrl }, { versionMedia: true });
      const next = { fullName: payload.fullName, username: payload.username, bio: payload.bio, city: payload.city, website: payload.website, dateOfBirth: payload.dateOfBirth || '' };
      setOriginal(next); setForm(next); setInitialMedia({ avatar: avatarUrl, cover: bannerUrl }); setAvatar({ file: null, preview: resolveMediaUrl(versionMediaUrl(avatarUrl)) }); setCover({ file: null, preview: resolveMediaUrl(versionMediaUrl(bannerUrl)) });
      setSuccess('Changes saved'); window.setTimeout(() => router.replace(`/profile/${payload.username}`), 600);
    } catch (reason: any) {
      const message = String(reason?.message || 'Unable to save changes. Check your connection and try again.');
      setError(/username.*(use|taken|exist)/i.test(message) ? 'That username is already taken.' : message);
    } finally { saveInFlight.current = false; setSaving(false); setProgress(''); }
  };

  if (loading || authLoading) return <main className="edit-profile-page"><div className="edit-profile-loading"><i /><i /><i /></div></main>;
  if (loadFailed) return <main className="edit-profile-page"><div className="edit-load-error" role="alert"><X size={24} /><h1>Unable to load profile</h1><p>{error}</p><div><button type="button" onClick={() => router.push('/profile')}>Back to profile</button><button className="retry" type="button" onClick={() => setLoadAttempt(value => value + 1)}>Try again</button></div></div></main>;
  return <main className="edit-profile-page">
    <PageHeader
      title="Edit profile"
      back={leave}
      className="edit-profile-header"
      actions={
        <button
          type="submit"
          form="edit-profile-form"
          disabled={!dirty || saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#F2C75C] px-3 text-xs font-semibold text-black transition hover:bg-[#d6a83f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      }
    />
    <form id="edit-profile-form" className="edit-profile-form" onSubmit={submit} noValidate>
      <section className="edit-media">
        <div className={`edit-cover ${cover.preview ? 'has-photo' : ''}`} style={cover.preview ? { backgroundImage: `url("${cover.preview.replace(/"/g, '%22')}")` } : undefined}><button type="button" aria-label="Change cover photo" disabled={saving} onClick={() => coverInput.current?.click()}><ImagePlus size={19} />Change cover</button></div>
        <div className="edit-avatar" style={avatar.preview ? { backgroundImage: `url("${avatar.preview.replace(/"/g, '%22')}")` } : undefined}>{!avatar.preview && <UserRound size={34} />}<button type="button" onClick={() => avatarInput.current?.click()} disabled={saving} aria-label="Change profile photo"><Camera size={17} /></button></div>
        <div className="media-copy"><b>Profile photo and cover</b><span>Tap either photo to choose and adjust your image.</span></div>
        <input ref={avatarInput} hidden type="file" accept={types.join(',')} onChange={event => selectImage('avatar', event)} /><input ref={coverInput} hidden type="file" accept={types.join(',')} onChange={event => selectImage('cover', event)} />
      </section>
      <section className="edit-fields" aria-label="Profile information">
        <Field label="Display name" count={`${form.fullName.length} / 50`}><input value={form.fullName} maxLength={50} autoComplete="name" onChange={event => setField('fullName', event.target.value)} /></Field>
        <Field label="Username" hint={availabilityText(availability)} status={availability}><div className="username-input"><span>@</span><input value={form.username} maxLength={30} autoComplete="username" spellCheck={false} onChange={event => setField('username', event.target.value.replace(/^@/, '').toLowerCase())} /></div></Field>
        <Field label="Bio" count={`${form.bio.length} / 260`}><textarea value={form.bio} maxLength={260} rows={3} onChange={event => setField('bio', event.target.value)} /></Field>
        <Field label="Location" optional><input value={form.city} maxLength={100} autoComplete="address-level2" placeholder="City or region" onChange={event => setField('city', event.target.value)} /></Field>
        <Field label="Website" optional><input value={form.website} inputMode="url" autoComplete="url" placeholder="https://example.com" onChange={event => setField('website', event.target.value)} /></Field>
        <Field label="Date of birth" optional><input type="date" value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={event => setField('dateOfBirth', event.target.value)} /></Field>
      </section>
      {progress && <div className="edit-feedback progress"><Loader2 className="spin" size={15} />{progress}</div>}{error && <div className="edit-feedback error" role="alert"><X size={15} />{error}</div>}{success && <div className="edit-feedback success" role="status"><Check size={15} />{success}</div>}
    </form>
    {cropTarget && <ImageCropEditor file={cropTarget.file} aspect={cropTarget.kind === 'cover' ? 3 : 1} circular={cropTarget.kind === 'avatar'} onCancel={() => setCropTarget(null)} onApply={applyCrop}/>}
  </main>;
}

function Field({ label, count, hint, status, optional, children }: { label: string; count?: string; hint?: string; status?: string; optional?: boolean; children: React.ReactNode }) {
  return <label className="edit-field"><span>{label}{optional && <small>Optional</small>}{count && <small>{count}</small>}</span>{children}{hint && <em className={status}>{hint}</em>}</label>;
}
function availabilityText(value: Availability) { return value === 'checking' ? 'Checking availability...' : value === 'available' ? 'Username is available.' : value === 'taken' ? 'Username is already taken.' : value === 'invalid' ? 'Use 3-30 letters, numbers, underscores, or periods.' : value === 'error' ? 'Availability check failed.' : ''; }