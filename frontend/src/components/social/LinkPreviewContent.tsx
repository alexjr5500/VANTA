'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiPost } from '@/lib/apiClient';

type Preview = { title?: string; description?: string; siteName?: string; image?: string };
type Cached = { value: Preview; expires: number };
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<Preview>>();
const MAX_CACHE = 40;
const MAX_ACTIVE = 3;
const MAX_QUEUE = 40;
let active = 0;
const queue: Array<() => void> = [];

function next() {
  while (active < MAX_ACTIVE && queue.length) {
    active++;
    queue.shift()?.();
  }
}

function load(href: string, token: string, userId: string): Promise<Preview> {
  const key = userId + '\n' + href;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return Promise.resolve(existing.value);
  cache.delete(key);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  if (queue.length >= MAX_QUEUE) return Promise.resolve({});
  const task = new Promise<Preview>(resolve => {
    queue.push(() => {
      void apiPost<Preview>('/api/link-preview', { url: href }, token)
        .then(value => {
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
          cache.set(key, { value, expires: Date.now() + (Object.keys(value).length ? 30 * 60000 : 60000) });
          resolve(value);
        }).catch(() => resolve({})).finally(() => { active--; next(); });
    });
    next();
  });
  pending.set(key, task);
  void task.finally(() => pending.delete(key));
  return task;
}

function safeImage(value?: string) {
  return typeof value === 'string' && value.length <= 525000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

// Only request visible cards. Keep the hostname fallback until metadata is
// ready, or if the destination disallows crawlers or is not safely fetchable.
export default function LinkPreviewContent({ href, children }: { href: string; children: string }) {
  const { token, user } = useAuth();
  const ref = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<{ key: string; value: Preview }>();
  const userId = user?.id;
  const key = userId + '\n' + href;
  const preview = result?.key === key ? result.value : undefined;
  useEffect(() => {
    if (!token || !userId || !ref.current) return;
    let current = true;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      void load(href, token, userId).then(value => { if (current) setResult({ key, value }); });
    };
    if (typeof IntersectionObserver === 'undefined') { start(); return () => { current = false; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }
    }, { rootMargin: '80px' });
    observer.observe(ref.current);
    return () => { current = false; observer.disconnect(); };
  }, [href, token, userId, key]);
  const rich = Boolean(preview?.title || preview?.description || preview?.image);
  return <span ref={ref} className={rich ? 'vanta-link-rich' : 'vanta-link-fallback'}>
    {rich && <>
      {safeImage(preview?.image) && <img src={preview!.image} alt="" loading="lazy" decoding="async" className="vanta-link-thumbnail" /* eslint-disable-line @next/next/no-img-element */ />}
      <span className="vanta-link-copy">
        {preview?.title && <span className="vanta-link-title">{preview.title}</span>}
        {preview?.description && <span className="vanta-link-description">{preview.description}</span>}
        <span className="vanta-link-domain">{preview?.siteName ? preview.siteName + ' · ' : ''}{children}</span>
      </span>
    </>}
    {!rich && children}
  </span>;
}
