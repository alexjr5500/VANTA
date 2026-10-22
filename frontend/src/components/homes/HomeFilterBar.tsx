'use client';

import React, { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

interface HomeFilterBarProps {
  propertyTypes: string[];
  rentPeriods: string[];
  current: Record<string, string>;
}

const TYPE_LABEL: Record<string, string> = {
  APARTMENT: 'Apartment', STUDIO: 'Studio', FLAT: 'Flat',
  DETACHED_HOUSE: 'Detached House', SEMI_DETACHED_HOUSE: 'Semi-Detached House',
  DUPLEX: 'Duplex', ROOM_SHARED: 'Shared Room', OTHER: 'Other',
};

export function HomeFilterBar({ propertyTypes, rentPeriods, current }: HomeFilterBarProps) {
  const [open, setOpen] = useState(false);
  const hasFilters =
    current.city || current.area || current.propertyType || current.minRent || current.maxRent || current.bedrooms || current.bathrooms || current.furnished || current.q || (current.sort && current.sort !== 'newest');

  const buildUrl = (updates: Partial<Record<string, string>>) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(updates).forEach(([k, v]) => {
      if (v === undefined || v === '') params.delete(k);
      else params.set(k, v);
    });
    window.location.search = params.toString();
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex w-full sm:w-auto items-center gap-2 overflow-hidden">
        <Input
          placeholder="Search city, area or keyword"
          value={current.q || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => buildUrl({ q: e.target.value })}
          className="w-full sm:w-64 bg-white/[0.04] border border-white/[0.08] text-white placeholder-white/40"
        />
        <Button variant="outline" size="sm" onClick={() => buildUrl({ q: '', city: '', area: '' })} disabled={!current.q && !current.city && !current.area}>
          Clear
        </Button>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/80 hover:bg-white/[0.08] text-sm"
        >
          Filters <span className="text-[#c9a227]">{hasFilters ? '· active' : ''}</span>
        </button>
        <Button variant="outline" size="sm" onClick={() => { window.location.search = ''; }} disabled={!hasFilters}>
          Reset
        </Button>
      </div>

      {open && (
        <div className="mt-4 p-4 rounded-xl border border-white/[0.08] bg-white/[0.03] w-full max-w-md">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <FilterSelect label="Property type" name="propertyType" options={propertyTypes.map((t) => ({ value: t, label: TYPE_LABEL[t] || t }))} current={current.propertyType || ''} buildUrl={buildUrl} />
            <FilterSelect label="Bedrooms" name="bedrooms" options={['1', '2', '3', '4'].map((v) => ({ value: v, label: v === '4' ? '4+' : v }))} current={current.bedrooms || ''} buildUrl={buildUrl} />
            <FilterSelect label="Bathrooms" name="bathrooms" options={['1', '2', '3', '4'].map((v) => ({ value: v, label: v === '4' ? '4+' : v }))} current={current.bathrooms || ''} buildUrl={buildUrl} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <FilterInput label="Min rent" name="minRent" current={current.minRent || ''} buildUrl={buildUrl} />
            <FilterInput label="Max rent" name="maxRent" current={current.maxRent || ''} buildUrl={buildUrl} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <FilterSelect label="Furnished" name="furnished" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} current={current.furnished || ''} buildUrl={buildUrl} />
            <FilterSelect label="Sort by" name="sort" options={[{ value: 'newest', label: 'Newest' }, { value: 'price_asc', label: 'Price: low to high' }, { value: 'price_desc', label: 'Price: high to low' }]} current={current.sort || 'newest'} buildUrl={buildUrl} />
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => { window.location.search = ''; }}>Clear all</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, name, options, current, buildUrl }: { label: string; name: string; options: { value: string; label: string }[]; current: string; buildUrl: (u: Partial<Record<string, string>>) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-white/50">{label}</span>
      <select value={current} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => buildUrl({ [name]: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:ring-2 focus:ring-[#c9a227] outline-none">
        <option value="">Any</option>
        {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </div>
  );
}

function FilterInput({ label, name, current, buildUrl }: { label: string; name: string; current: string; buildUrl: (u: Partial<Record<string, string>>) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-white/50">{label}</span>
      <input type="number" value={current} onChange={(e: React.ChangeEvent<HTMLInputElement>) => buildUrl({ [name]: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:ring-2 focus:ring-[#c9a227] outline-none" />
    </div>
  );
}