'use client';

import { AtSign, BadgeCheck, Check, Globe2, UsersRound, UserRoundCheck, X } from 'lucide-react';
import type { ReplyAudience } from '@/lib/replyAudience';

type Props = {
  audience: ReplyAudience;
  onSelect: (next: ReplyAudience) => void;
  onClose: () => void;
};

const choices = [
  { value: 'EVERYONE', label: 'Everyone', Icon: Globe2 },
  { value: 'VERIFIED', label: 'Verified accounts', Icon: BadgeCheck },
  { value: 'FOLLOWING', label: 'Accounts you follow', Icon: UserRoundCheck },
  { value: 'MENTIONED', label: 'Only accounts you mention', Icon: AtSign },
  { value: 'EXTENDED', label: 'Accounts you follow and who they follow', Icon: UsersRound },
] as const;

export default function ReplyAudienceSheet({ audience, onSelect, onClose }: Props) {
  return (
    <div data-vanta-overlay className="absolute inset-0 z-[110] flex items-end" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }}>
      <button type="button" tabIndex={-1} aria-label="Dismiss reply audience" className="absolute inset-0 bg-[#10151b]/65" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reply-audience-title"
        aria-describedby="reply-audience-description"
        className="relative z-10 flex max-h-[90%] w-full flex-col overflow-hidden rounded-t-[28px] border-t border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] shadow-2xl"
      >
        <div className="mx-auto mt-3.5 h-1.5 w-12 shrink-0 rounded-full bg-white/25" aria-hidden="true" />
        <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-2 pt-4">
          <div>
            <h2 id="reply-audience-title" className="text-2xl font-bold">Who can reply?</h2>
            <p id="reply-audience-description" className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Pick who can reply to this post. Anyone you mention can always reply.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reply audience"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface)]"
          ><X size={20} /></button>
        </div>
        <div role="radiogroup" aria-label="Who can reply" className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {choices.map(({ value, label, Icon }) => {
            const selected = audience === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(value)}
                className="flex min-h-[68px] w-full items-center gap-4 rounded-xl px-3 text-left transition hover:bg-[var(--surface)]"
              >
                <Icon size={24} className="shrink-0 text-[var(--text-primary)]" />
                <span className="min-w-0 flex-1 text-[15px]">{label}</span>
                <span className={selected ? 'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[#c9a227] bg-[#c9a227] text-[#1f2630]' : 'h-6 w-6 shrink-0 rounded-full border-2 border-[var(--text-muted)]'} aria-hidden="true">
                  {selected && <Check size={15} strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
