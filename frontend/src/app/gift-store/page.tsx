"use client";

import { useCallback, useEffect, useState, useMemo } from 'react';
import { Crown, Flame, Gift, Heart, Loader2, Search, Star, X, SlidersHorizontal } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import GiftIcon from '@/components/ui/GiftIcon';
import Avatar from '@/components/ui/Avatar';
import GiftPicker from '@/components/social/GiftPicker';
import { useToast } from '@/components/ui/Toast';
import GiftArtwork from '@/components/gifts/GiftArtwork';
import BuyCoinsModal from '@/components/wallet/BuyCoinsModal';
import { normalizeGiftCatalog, type GiftCatalogItem } from '@/lib/giftCatalog';

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

  useEffect(() => {
    if (!token) return;
    const fetchData = async () => {
      try {
        setLoadError(null);
        const [giftData, walletData] = await Promise.all([
          apiGet<any[]>('/api/monetization/gifts', token),
          apiGet<any>('/api/monetization/wallet', token),
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
    };
    fetchData();
  }, [token, toast]);

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

  if (loading) {
    return (
      <div className="flex min-h-[calc(100dvh-8rem)] items-center justify-center pb-24">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin text-[#8A8A8A] mx-auto" />
          <p className="text-sm text-gray-400 mt-3">Loading gift store...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return <div className="flex min-h-[calc(100dvh-8rem)] flex-col items-center justify-center px-5 text-center"><Gift size={28} className="mb-3 text-white/25" /><h1 className="text-base font-semibold text-white">Gift Store could not load</h1><p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-[#8A8A8A]">{loadError}</p><button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-11 rounded-lg bg-white px-5 text-sm font-semibold text-black">Try again</button></div>;
  }

  return (
    <div className="min-h-[calc(100dvh-5rem)] w-full min-w-0 overflow-x-hidden pb-[calc(5rem+env(safe-area-inset-bottom))]">
      {sendingGift && !recipient && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 backdrop-blur-md  " onClick={() => setSendingGift(null)}>
          <section role="dialog" aria-modal="true" aria-label="Choose a gift recipient" className="w-full max-w-[480px] rounded-t-xl border border-white/10 bg-[#0D0D0F]/98 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20" /><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-white">Choose a recipient</h2><p className="mt-1 text-xs text-white/45">Send {sendingGift.name} to a creator or friend.</p></div><button aria-label="Close" onClick={() => setSendingGift(null)} className="grid h-10 w-10 place-items-center rounded-lg text-white/60 hover:bg-white/10"><X size={18} /></button></div>
            <div className="relative mt-5"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35"/><input autoFocus value={recipientQuery} onChange={event => setRecipientQuery(event.target.value)} placeholder="Search by name or username" className="h-11 w-full rounded-xl border border-white/10 bg-white/[.04] pl-9 pr-10 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"/>{searchingRecipients && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/45"/>}</div>
            <div className="mt-3 max-h-[42dvh] space-y-1 overflow-y-auto overscroll-contain">
              {recipientResults.map(person => <button key={person.id} onClick={() => setRecipient(person)} className="flex min-h-14 w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-white/[.06]"><Avatar src={person.avatar} alt={person.username} size="sm"/><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{person.fullName || person.username}</p><p className="truncate text-xs text-white/40">@{person.username}</p></div></button>)}
              {recipientQuery.trim().length >= 2 && !searchingRecipients && recipientResults.length === 0 && <p className="py-8 text-center text-sm text-white/40">No matching recipients found.</p>}
              {recipientQuery.trim().length < 2 && <p className="py-8 text-center text-sm text-white/40">Enter at least two characters to search.</p>}
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
            void apiGet<any>('/api/monetization/wallet', token).then(data => {
              const refreshedBalance = Number(data?.coinBalance);
              if (Number.isSafeInteger(refreshedBalance) && refreshedBalance >= 0) setBalance(refreshedBalance);
            });
          }
        }}
      />

      <div className="w-full min-w-0 space-y-4">
        <PageHeader back title="Gift Store" eyebrow="VANTA" />

        <div className="rounded-lg border border-white/[0.08] bg-[#0D0D0F] p-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--vanta-gold)]/25 bg-[var(--vanta-gold)]/[0.06]">
                <VantaCoinIcon size={18} className="text-[var(--vanta-gold)]" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-gray-400">Available balance</p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-lg font-bold text-white">
                  {balance?.toLocaleString()}
                  <VantaCoinIcon size={14} className="inline-block shrink-0 text-[#d8d8d8]" />
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" aria-pressed={featuredOnly} onClick={() => setFeaturedOnly(value => !value)} className={`grid h-10 w-10 place-items-center rounded-lg border transition ${featuredOnly ? 'border-[var(--vanta-gold)]/35 bg-[var(--vanta-gold)]/[.08] text-[var(--vanta-gold)]' : 'border-white/10 bg-white/[.04] text-white/55 hover:text-white'}`} aria-label={featuredOnly ? 'Showing featured gifts' : 'Filter featured gifts'}><SlidersHorizontal size={15} /></button>
              <button type="button" onClick={() => setShowPurchase(true)} className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[var(--vanta-gold)] px-3.5 text-xs font-bold text-black active:scale-[.98]"><VantaCoinIcon size={14} className="text-black" />Buy</button>
            </div>
          </div>
        </div>

        {/* Search and Categories */}
        <div className="flex flex-col gap-2.5">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search gifts..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0D0D0F] pl-11 pr-10 text-sm text-white outline-none placeholder:text-gray-500 focus:border-white/20"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-gray-400 hover:bg-white/[0.06] hover:text-white"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Categories */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {visibleCategories.map((cat) => {
              const count = getCategoryCount(cat.id);
              const isActive = activeCategory === cat.id;
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex flex-shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition whitespace-nowrap ${
                    isActive
                      ? 'bg-[#F5F5F5] text-black'
                      : 'border border-white/[0.08] bg-[#101010] text-gray-400 hover:text-white'
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
          <div className="rounded-lg border border-white/[0.08] bg-[#101010] px-5 py-12 text-center">
            <GiftIcon size={28} className="mx-auto mb-3 text-white/25" />
            <h3 className="text-sm font-semibold text-white">{gifts.length ? 'No gifts found' : 'No gifts available right now'}</h3>
            <p className="mx-auto mt-1.5 max-w-xs text-xs leading-5 text-gray-400">{gifts.length ? 'Try a different category or search term.' : 'The live gift catalog is currently empty.'}</p>
          </div>

        ) : (
          <>
            {activeCategory === 'luxury' && (
              <div className="flex items-center gap-2 border-b border-white/[0.08] pb-3 text-sm font-semibold text-[var(--vanta-gold)]">
                <Star size={14} /> Luxury collection
              </div>
            )}

            {/* Gift grid — artwork is the hero. No frames, borders or card
                backgrounds; ~4 per row, adapting to the mobile shell width. */}
            <div className="grid w-full min-w-0 grid-cols-4 gap-x-1.5 gap-y-4">
              {filteredGifts.map((gift) => (
                <button
                  key={gift.id}
                  onClick={() => setSendingGift(gift)}
                  aria-label={`Send ${gift.name} for ${gift.price.toLocaleString()} coins`}
                  className="group relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 text-center transition active:scale-[.94]"
                >
                  <div className="relative flex aspect-square w-full items-center justify-center">
                    <div className="absolute inset-3 rounded-full opacity-25 blur-2xl transition-opacity group-active:opacity-40" style={{ backgroundColor: gift.glowColor || 'transparent' }} />
                    <GiftArtwork slug={gift.slug} name={gift.name} artworkType={gift.artworkType} assetUrl={gift.thumbnailUrl || gift.image} size={62} animate={false} />
                    {(gift.isLegendary || gift.isLimited) && (
                      <span
                        title={gift.isLegendary ? 'Exclusive' : 'Limited'}
                        aria-hidden="true"
                        className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-full bg-black/70 backdrop-blur-sm"
                      >
                        {gift.isLegendary ? <Star size={9} className="text-[var(--vanta-gold)]" /> : <Flame size={9} className="text-white/70" />}
                      </span>
                    )}
                  </div>
                  <h3 className="w-full truncate text-[11px] font-medium leading-tight text-white/90">{gift.name}</h3>
                  <span className="flex min-w-0 items-center justify-center gap-0.5 text-[11px] font-semibold">
                    <VantaCoinIcon size={11} className={gift.isLegendary ? 'text-[var(--vanta-gold)]' : 'text-[#c8a24a]'} />
                    <span className="truncate text-white">{gift.price.toLocaleString()}</span>
                  </span>
                </button>
              ))}
            </div>

          </>
        )}

        <p className="border-t border-white/[0.08] pt-4 text-center text-xs leading-5 text-gray-500">Recipients receive 70% of a gift&apos;s coin value, converted to earnings automatically.</p>

      </div>
    </div>
  );
}