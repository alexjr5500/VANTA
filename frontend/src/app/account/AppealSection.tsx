'use client';

// Shared appeal-status panel + submission form for the suspended/banned
// screens. The parent supplies the credential (restricted session token or
// banned appeal token) and receives the resulting appeal through onSubmitted.
import { useState } from 'react';
import { FileText, Loader2, Send, CheckCircle2 } from 'lucide-react';
import { APPEAL_CATEGORY_OPTIONS, APPEAL_STATUS_COPY, timeAgoShort } from '@/lib/appealUi';
import { submitAppeal } from '@/lib/appealApi';
import type { AppealRecord } from '@/lib/adminApi';
import { InlineStatus } from './AccountNotice';

export function AppealStatusPanel({ appeal }: { appeal: AppealRecord }) {
  const copy = APPEAL_STATUS_COPY[appeal.status];
  return (
    <div className="mt-3 rounded-2xl bg-black/40 p-4 text-sm" role="status">
      <p className="font-semibold text-amber-200">{copy?.label || appeal.status}</p>
      <p className="mt-1 text-white/60">
        {appeal.status === 'APPROVED' && appeal.accountRestored
          ? 'Your appeal was approved and your account was restored. Sign in again to continue.'
          : copy?.detail}
      </p>
      <p className="mt-2 text-xs text-white/40">
        {appeal.status === 'PENDING' || appeal.status === 'UNDER_REVIEW'
          ? `Submitted ${timeAgoShort(appeal.createdAt)} · ${appeal.category.replace(/_/g, ' ').toLowerCase()}`
          : `Decided ${appeal.reviewedAt ? timeAgoShort(appeal.reviewedAt) : 'recently'}`}
      </p>
    </div>
  );
}

export function AppealForm({
  credential,
  hasPreviousAppeal,
  onSubmitted,
  submitLabel,
}: {
  credential: string;
  hasPreviousAppeal: boolean;
  onSubmitted: (appeal: AppealRecord, alreadyPending: boolean) => void;
  submitLabel: string;
}) {
  const [category, setCategory] = useState<string>('ACCOUNT_RESTRICTION');
  const [explanation, setExplanation] = useState('');
  const [supportingInfo, setSupportingInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async () => {
    if (submitting) return;
    setFormError('');
    if (explanation.trim().length < 20) {
      setFormError('Please explain why the decision should be reviewed (at least 20 characters).');
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitAppeal(credential, {
        category,
        explanation: explanation.trim(),
        supportingInfo: supportingInfo.trim() || undefined,
      });
      setExplanation('');
      setSupportingInfo('');
      onSubmitted(result.appeal, false);
    } catch (caught: any) {
      const code = caught?.data?.code;
      if (code === 'APPEAL_ALREADY_PENDING' && caught?.data?.details) {
        onSubmitted(caught.data.details, true);
      } else {
        setFormError(caught?.message || 'Could not submit your appeal. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <label className="block text-xs font-semibold uppercase tracking-wider text-white/45" htmlFor="appeal-category">
        What is this appeal about?
      </label>
      <select
        id="appeal-category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-[#d6a83f]/60"
      >
        {APPEAL_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <label className="block text-xs font-semibold uppercase tracking-wider text-white/45" htmlFor="appeal-explanation">
        Why should this decision be reviewed? <span className="text-red-300">*</span>
      </label>
      <textarea
        id="appeal-explanation"
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="Explain what happened and why you believe the action was made in error…"
        className="w-full resize-y rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#d6a83f]/60"
      />
      <label className="block text-xs font-semibold uppercase tracking-wider text-white/45" htmlFor="appeal-support">
        Supporting information <span className="font-normal normal-case text-white/35">(optional)</span>
      </label>
      <textarea
        id="appeal-support"
        value={supportingInfo}
        onChange={(e) => setSupportingInfo(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Anything else a moderator should know…"
        className="w-full resize-y rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#d6a83f]/60"
      />
      {formError ? <p role="alert" className="text-sm text-red-300">{formError}</p> : null}
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d6a83f] px-5 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
        {hasPreviousAppeal ? 'Submit a new appeal' : submitLabel}
      </button>
    </div>
  );
}

export function AppealSection({
  credential,
  latestAppeal,
  sectionLabel,
  onSubmitted,
}: {
  credential: string;
  latestAppeal: import('@/lib/adminApi').AppealRecord | null;
  sectionLabel: string;
  onSubmitted: (appeal: import('@/lib/adminApi').AppealRecord, alreadyPending: boolean) => void;
}) {
  const [notice, setNotice] = useState('');
  const openAppeal =
    latestAppeal && (latestAppeal.status === 'PENDING' || latestAppeal.status === 'UNDER_REVIEW')
      ? latestAppeal
      : null;

  const handleSubmitted = (appeal: import('@/lib/adminApi').AppealRecord, alreadyPending: boolean) => {
    setNotice(alreadyPending ? 'You already have an appeal awaiting review.' : 'Your appeal was submitted for review.');
    onSubmitted(appeal, alreadyPending);
  };

  return (
    <section aria-label={sectionLabel} className="mt-4 w-full rounded-3xl border border-white/10 bg-[#151312] p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-base font-bold text-white">
        <FileText size={17} className="text-[#d6a83f]" aria-hidden /> Appeal this decision
      </h2>
      {notice ? (
        <InlineStatus tone="success">
          <span className="inline-flex items-start gap-2">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden /> {notice}
          </span>
        </InlineStatus>
      ) : null}
      {openAppeal ? (
        <>
          <AppealStatusPanel appeal={openAppeal} />
          <p className="mt-4 text-sm text-white/50">
            You already have an appeal awaiting review. You can submit a new one after it is decided.
          </p>
        </>
      ) : (
        <>
          {latestAppeal ? <AppealStatusPanel appeal={latestAppeal} /> : null}
          <AppealForm
            credential={credential}
            hasPreviousAppeal={Boolean(latestAppeal)}
            onSubmitted={handleSubmitted}
            submitLabel="Submit appeal"
          />
        </>
      )}
    </section>
  );
}
