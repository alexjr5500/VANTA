"use client";

import { useCallback, useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Crown, Flame, Gift, Heart, Loader2, Search, Star, X, SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import GiftIcon from '@/components/ui/GiftIcon';
import Avatar from '@/components/ui/Avatar';
import GiftPicker from '@/components/social/GiftPicker';
import { useToast } from '@/components/ui/Toast';
import GiftArtwork from '@/components/gifts/GiftArtwork';
import BuyCoinsModal from '@/components/wallet/BuyCoinsModal';
import { normalizeGiftCatalog, giftVisualQuality, type GiftCatalogItem } from '@/lib/giftCatalog';

// Types
type GiftItem = GiftCatalogItem & { slug: string; category: string; description: string };

interface GiftRecipient {
  id: string;
  username: string;
  fullName: string;
  avatar?: string;
}

// Gift categories
const CATEGORIES = [
  { id: 'all', label: 'All Gifts', icon: Gift },
  { id: 'popular', label: 'Popular', icon: Heart },
  { id: 'premium', label: 'Premium', icon: Crown },
  { id: 'luxury', label: 'Luxury', icon: Star },
  { id: 'limited', label: 'Limited', icon: Flame },
];

export default function GiftStorePage() {
  const router = useRouter();
  const { token, user } = useAuth();
  const toast = useToast();
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPurchase, setShowPurchase] = useState(false);
  const [sendingGift, setSendingGift] = useState<GiftItem | null>(null);
  const [recipient, setRecipient] = useState<GiftRecipient | null>(null);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<GiftRecipient[]>([]);
  const [searchingRecipients, setSearchingRecipients] = useState(false);
  const [featuredOnly, setFeaturedOnly] = useState(false);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      setLoadError(null);
      const [giftData, walletData] = await Promise.all([
        apiGet<any[]>('/api/monetization/gifts', token, { skipCache: true }),
        apiGet<any>('/api/monetization/wallet', token, { skipCache: true }),
      ]);
      setGifts(normalizeGiftCatalog(giftData) as GiftItem[]);
      const loadedBalance = Number(walletData?.coinBalance);
      if (!Number.isSafeInteger(loadedBalance) || loadedBalance < 0) throw new Error('The Balance service returned invalid account data.');
      setBalance(loadedBalance);
    } catch (error: any) {
      const message = error?.message || 'The gift catalog could not be loaded.';
      setLoadError(message);
      toast.error('Gift Store unavailable', message);
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!token || !sendingGift || recipient || recipientQuery.trim().length < 2) {
      setRecipientResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearchingRecipients(true);
      try {
        const result = await apiGet<any>(`/api/search?q=${encodeURIComponent(recipientQuery.trim())}&type=users`, token);
        const rows = Array.isArray(result) ? result : result?.results?.users ?? result?.data?.users ?? result?.users ?? [];
        setRecipientResults(rows.filter((item: GiftRecipient) => item.id !== user?.id));
      } catch (error: any) {
        toast.error('Search unavailable', error.message || 'Could not find creators right now.');
        setRecipientResults([]);
      } finally {
        setSearchingRecipients(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [recipientQuery, recipient, sendingGift, token, toast, user?.id]);

  const filteredGifts = useMemo(() => {
    let result = gifts;
    if (activeCategory !== 'all') {
      result = result.filter(g => {
        if (activeCategory === 'limited') return g.isLimited;
        if (activeCategory === 'popular') return g.isPopular || g.isTrending || g.category?.toLowerCase() === 'popular';
        return g.category?.toLowerCase() === activeCategory;
      });
    }
    if (featuredOnly) result = result.filter(g => g.isFeatured || g.isLegendary);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(g => g.name.toLowerCase().includes(q) || g.slug.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [gifts, activeCategory, searchQuery, featuredOnly]);

  const getCategoryCount = useCallback((catId: string) => {
    if (catId === 'all') return gifts.length;
    if (catId === 'limited') return gifts.filter(g => g.isLimited).length;
    if (catId === 'popular') return gifts.filter(g => g.isPopular || g.isTrending || g.category === 'popular').length;
    return gifts.filter(g => g.category?.toLowerCase() === catId).length;
  }, [gifts]);

  const visibleCategories = useMemo(() => CATEGORIES.filter(category => category.id === 'all' || getCategoryCount(category.id) > 0), [getCategoryCount]);

  if (loading || loadError) {
    return (
      <div className="w-full min-w-0">
        <header className="sticky top-0 z-30 relative -mx-4 flex h-14 w-[calc(100%+2rem)] shrink-0 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--header-surface)] px-4 backdrop-blur-xl">
          <button type="button" onClick={() => router.back()} aria-label="Go back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"><ArrowLeft size={20} /></button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text-primary)]">Gift Store</h1>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button type="button" aria-pressed={featuredOnly} onClick={() => setFeaturedOnly(value => !value)} aria-label={featuredOnly ? 'Showing featured gifts' : 'Filter featured gifts'} className={`grid h-9 w-9 place-items-center rounded-lg transition ${featuredOnly ? 'bg-[var(--vanta-gold)]/15 text-[var(--vanta-gold)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'}`}>
              <SlidersHorizontal size={16} />
            </button>
            {balance !== null && (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--surface-secondary)] px-2.5 text-xs font-semibold text-[var(--text-primary)] tabular-nums">
                <VantaCoinIcon size={14} className="shrink-0 text-[var(--vanta-gold)]" />
                {balance.toLocaleString()}
              </span>
            )}
            <button type="button" onClick={() => setShowPurchase(true)} className="flex h-9 items-center justify-center gap-1 rounded-lg bg-[var(--vanta-gold)] px-3 text-xs font-semibold text-black active:scale-[.98]">
              <VantaCoinIcon size={13} className="text-black" /> Buy
            </button>
          </div>
        </header>
        <div className="mt-4 flex min-h-[55dvh] w-full min-w-0 flex-col items-center justify-center px-5 text-center">
          {loading ? (
            <>
              <Loader2 size={32} className="mx-auto animate-spin text-[var(--text-secondary)]" />
              <p className="mt-3 text-sm text-[var(--text-secondary)]">Loading gift store...</p>
            </>
          ) : (
            <>
              <Gift size={28} className="mb-3 text-[var(--text-muted)]" />
              <h1 className="text-base font-semibold text-[var(--text-primary)]">Gift Store could not load</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-[var(--text-secondary)]">{loadError}</p>
              <button type="button" onClick={() => void fetchData()} className="mt-5 min-h-11 rounded-lg bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90">Try again</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-5rem)] w-full min-w-0 bg-[var(--background)] pb-[calc(5rem+env(safe-area-inset-bottom))] text-[var(--text-primary)]">
      {sendingGift && !recipient && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 backdrop-blur-md  " onClick={() => setSendingGift(null)}>
          <section role="dialog" aria-modal="true" aria-label="Choose a gift recipient" className="w-full max-w-[480px] rounded-t-xl border border-[var(--border)] bg-[var(--background-secondary)] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20" /><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-[var(--text-primary)]">Choose a recipient</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">Send {sendingGift.name} to a creator or friend.</p></div><button aria-label="Close" onClick={() => setSendingGift(null)} className="grid h-10 w-10 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><X size={18} /></button></div>
            <div className="relative mt-5"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/><input autoFocus value={recipientQuery} onChange={event => setRecipientQuery(event.target.value)} placeholder="Search by name or username" className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] pl-9 pr-10 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"/>{searchingRecipients && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-secondary)]"/>}</div>
            <div className="mt-3 max-h-[42dvh] space-y-1 overflow-y-auto overscroll-contain">
              {recipientResults.map(person => <button key={person.id} onClick={() => setRecipient(person)} className="flex min-h-14 w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-[var(--surface-hover)]"><Avatar src={person.avatar} alt={person.username} size="sm"/><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--text-primary)]">{person.fullName || person.username}</p><p className="truncate text-xs text-[var(--text-muted)]">@{person.username}</p></div></button>)}
              {recipientQuery.trim().length >= 2 && !searchingRecipients && recipientResults.length === 0 && <p className="py-8 text-center text-sm text-[var(--text-muted)]">No matching recipients found.</p>}
              {recipientQuery.trim().length < 2 && <p className="py-8 text-center text-sm text-[var(--text-muted)]">Enter at least two characters to search.</p>}
            </div>
          </section>
        </div>
      )}

      {sendingGift && recipient && token && balance !== null && <GiftPicker gifts={gifts} balance={balance} recipient={recipient} token={token} initialGift={sendingGift} onClose={() => { setSendingGift(null); setRecipient(null); setRecipientQuery(''); }} onSent={(remainingBalance, _amount, gift) => { setBalance(remainingBalance); toast.success('Gift sent', `${gift.name} was delivered to @${recipient.username}.`); }} />}

      <BuyCoinsModal
        open={showPurchase}
        onClose={() => setShowPurchase(false)}
        onSuccess={() => {
          setShowPurchase(false);
          if (token) {
            void apiGet<any>('/api/monetization/wallet', token, { skipCache: true }).then(data => {
              const refreshedBalance = Number(data?.coinBalance);
              if (Number.isSafeInteger(refreshedBalance) && refreshedBalance >= 0) setBalance(refreshedBalance);
            });
          }
        }}
      />

      <div className="w-full min-w-0">
        <header className="sticky top-0 z-30 relative -mx-4 flex h-14 w-[calc(100%+2rem)] shrink-0 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--header-surface)] px-4 backdrop-blur-xl">
          <button type="button" onClick={() => router.back()} aria-label="Go back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"><ArrowLeft size={20} /></button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text-primary)]">Gift Store</h1>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {balance !== null && (
              <span className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-bold text-[var(--text-primary)] tabular-nums">
                <VantaCoinIcon size={14} className="shrink-0 text-[var(--vanta-gold)]" />
                {balance.toLocaleString()}
              </span>
            )}
          </div>
        </header>
        <div className="mt-3 w-full min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-[var(--vanta-gold-bright)]">Virtual gifts</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">Support your favorite creators.</p></div><button type="button" onClick={() => setShowPurchase(true)} className="min-h-11 shrink-0 rounded-lg border border-[#b89446]/35 px-3 text-xs font-medium text-[var(--vanta-gold-bright)]">Buy coins</button></div>
        {/* Search and Categories */}
        <div className="flex flex-col gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="text"
              placeholder="Search gifts..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-11 pr-10 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Categories */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {visibleCategories.map((cat) => {
              const count = getCategoryCount(cat.id);
              const isActive = activeCategory === cat.id;
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  type="button"
                  aria-pressed={isActive}
                  className={`flex min-h-11 flex-shrink-0 items-center gap-1.5 border-b-2 px-2 py-2 text-xs font-medium whitespace-nowrap ${
                    isActive
                      ? 'border-[var(--vanta-gold)] text-[var(--vanta-gold-bright)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon size={14} />
                  {cat.label}
                  <span className="text-[10px] opacity-60">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Gift Grid */}
        {filteredGifts.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-12 text-center">
            <GiftIcon size={28} className="mx-auto mb-3 text-[var(--text-muted)]" />
            <h3 className="text-sm font-medium text-[var(--text-primary)]">{gifts.length ? 'No gifts found' : 'No gifts available right now'}</h3>
            <p className="mx-auto mt-1.5 max-w-xs text-xs leading-5 text-[var(--text-secondary)]">{gifts.length ? 'Try a different category or search term.' : 'The live gift catalog is currently empty.'}</p>
          </div>

        ) : (
          <>
            {activeCategory === 'luxury' && (
              <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3 text-sm font-semibold text-[var(--vanta-gold)]">
                <Star size={14} /> Luxury collection
              </div>
            )}

            {/* Reference-led collectible cards; backend prices stay authoritative. */}
            <div className="grid w-full min-w-0 grid-cols-3 gap-2 min-[380px]:grid-cols-4 sm:grid-cols-5 sm:gap-2.5 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-10">
              {filteredGifts.map((gift) => (
                <button
                  key={gift.id}
                  onClick={() => { setRecipient(null); setRecipientQuery(''); setSendingGift(gift); }}
                  aria-label={`Send ${gift.name} for ${gift.price.toLocaleString()} coins`}
                  className="group relative flex min-w-0 flex-col items-center gap-1.5 overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-1 pb-2 pt-1 text-center transition-colors hover:border-[var(--vanta-gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--vanta-gold-bright)]"
                >
                  <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden">
                    <GiftArtwork slug={gift.slug} name={gift.name} artworkType={gift.artworkType} assetUrl={gift.thumbnailUrl || gift.image} size={112} responsive blendReferenceBackground animate={false} quality={giftVisualQuality(gift)} />
                    {(gift.isLegendary || gift.isLimited) && (
                      <span
                        title={gift.isLegendary ? 'Exclusive' : 'Limited'}
                        aria-hidden="true"
                        className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-full bg-[var(--surface-active)]"
                      >
                        {gift.isLegendary ? <Star size={9} className="text-[var(--vanta-gold)]" /> : <Flame size={9} className="text-[var(--text-secondary)]" />}
                      </span>
                    )}
                  </div>
                  <h3 className="flex min-h-[2.2em] w-full items-center justify-center break-words text-[11px] font-medium leading-tight text-[var(--text-primary)] sm:text-xs">{gift.name}</h3>
                  <span className="flex min-w-0 flex-wrap items-center justify-center gap-1 text-[11px] font-medium tabular-nums">
                    <VantaCoinIcon size={13} decorative />
                    <span className="truncate text-[var(--text-primary)]">{gift.price.toLocaleString()}</span>
                  </span>
                </button>
              ))}
            </div>

          </>
        )}

        <p className="border-t border-[var(--border)] pt-4 text-center text-xs leading-5 text-[var(--text-muted)]">Recipients receive 70% of a gift&apos;s coin value in spendable VANTA Coins.</p>

        </div>
      </div>
    </div>
  );
}