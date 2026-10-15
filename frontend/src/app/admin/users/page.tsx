'use client';

// ============================================================================
// ADMIN COMMAND CENTER - USER MANAGEMENT (VANTA / Management / Users)
// ----------------------------------------------------------------------------
// Reads GET /api/admin/users/manage (server-side exact-first username search,
// paginated, filterable) and performs the real, role-protected moderation
// actions the backend already exposes:
//   - suspend (with reason + optional end date) / restore
//   - ban / lift ban / delete
//   - selective verification-plan management (Blue 1/3/6 months, Gold 1 year)
//     with assignment, reassignment, and confirmed removal
//   - appeal review (list, mark under review, approve/reject with notes and
//     optional account restoration)
// Every consequential action runs through a confirmation dialog first, and
// the success message reflects the confirmed backend response.
// ============================================================================

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import {
  getUsers, suspendUser, banUser, restoreUser, unbanUser, deleteUser,
  getVerificationState, assignVerification, removeVerification,
  getAppealsForUser, markAppealUnderReview, decideAppeal,
  type UserRecord, type UserPage, type AdminVerificationState,
  type AppealRecord,
} from '@/lib/adminApi';
import {
  Users, Search, Shield, Ban, RotateCcw,
  ChevronLeft, ChevronRight, RefreshCw, Trash2,
  History, X, ExternalLink, MoreHorizontal, BadgeCheck, CircleSlash, Loader2,
} from 'lucide-react';
import ConsolePanel from '@/components/console/Panel';
import StatusBadge, { statusToneFor, type StatusTone } from '@/components/console/StatusBadge';
import ConfirmDialog from '@/components/console/ConfirmDialog';
import VerificationBadge from '@/components/ui/VerificationBadge';
import {
  ConsoleErrorState, ConsoleEmptyState, SkeletonRows,
} from '@/components/console/States';
import { fmtDate, timeAgo } from '@/components/console/format';

// ============================================================================
// OPTION SETS
// ============================================================================

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'BANNED', label: 'Banned' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
  { value: 'LOCKED', label: 'Locked' },
];

const ROLE_OPTIONS = ['ALL', 'USER', 'CREATOR', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

const VERIFIED_OPTIONS = [
  { value: 'ALL', label: 'Verified & unverified' },
  { value: 'true', label: 'Verified only' },
  { value: 'false', label: 'Unverified only' },
  { value: 'BLUE', label: 'Blue verified' },
  { value: 'GOLD', label: 'Gold verified' },
];

const PAGE_SIZE = 25;

const roleClass: Record<string, string> = {
  SUPER_ADMIN: 'text-console-gold',
  CEO: 'text-console-gold',
  FINANCE_MANAGER: 'text-console-gold',
  ADMIN: 'text-console-text',
  ADMINISTRATOR: 'text-console-text',
  MODERATOR: 'text-console-info',
  SUPPORT_AGENT: 'text-console-info',
  CONTENT_REVIEWER: 'text-console-info',
  CREATOR: 'text-console-info',
  USER: 'text-console-text-2',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  BANNED: 'Banned',
  DEACTIVATED: 'Deactivated',
  LOCKED: 'Locked',
};

const APPEAL_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

type ConfirmKind = 'suspend' | 'ban' | 'restore' | 'unban' | 'delete';

const CONFIRM_COPY: Record<ConfirmKind, { title: string; message: string; confirm: string }> = {
  suspend: {
    title: 'Suspend account',
    message:
      'The user keeps their account and data and can still sign in to read the suspension notice and appeal, but cannot post, like, comment, message, or perform other restricted actions until the suspension is lifted.',
    confirm: 'Suspend account',
  },
  ban: {
    title: 'Ban account',
    message:
      'The user will be blocked from the normal application while the ban is active. They can still submit an appeal from the dedicated banned-account screen.',
    confirm: 'Ban account',
  },
  restore: {
    title: 'Restore account',
    message: 'Lifts the current restriction and returns the account to active status.',
    confirm: 'Restore account',
  },
  unban: {
    title: 'Lift ban',
    message: 'Removes the ban and returns the account to active status.',
    confirm: 'Lift ban',
  },
  delete: {
    title: 'Delete account',
    message: 'This permanently removes the account and its associated data. This cannot be undone.',
    confirm: 'Delete permanently',
  },
};

const inputClass =
  'w-full rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 px-3 py-2 text-xs text-console-text outline-none placeholder:text-console-text-3 focus:border-console-gold/60';

// ============================================================================
// SHARED PRIMITIVES
// ============================================================================

/** User cell identity — avatar when present, otherwise initial on a neutral tile. */
function UserIdentity({ user, size = 'md' }: { user: UserRecord; size?: 'md' | 'sm' }) {
  const box = size === 'md' ? 'h-8 w-8 text-xs' : 'h-7 w-7 text-[11px]';
  const [broken, setBroken] = useState(false);
  if (user.avatar && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatar}
        alt=""
        onError={() => setBroken(true)}
        className={cn('shrink-0 rounded-full object-cover ring-1 ring-white/10', box)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-white/[0.06] font-semibold uppercase text-console-text-2 ring-1 ring-white/10',
        box,
      )}
    >
      {(user.fullName || user.username || '?').slice(0, 1)}
    </span>
  );
}

/** Verification cell — distinct Blue/Gold seal + label; expiry in tooltip/detail. */
function VerificationCell({ user }: { user: UserRecord }) {
  if (!user.verificationActive || !user.verificationType) {
    return <span className="text-console-text-3">None</span>;
  }
  const isBlue = user.verificationType === 'BLUE';
  return (
    <span
      className="inline-flex flex-col gap-0.5"
      title={
        user.verificationExpiresAt
          ? `Expires ${fmtDate(user.verificationExpiresAt)}`
          : 'Active badge'
      }
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <VerificationBadge type={user.verificationType} size="xs" />
        <span className={cn('font-semibold', isBlue ? 'text-[#7db8f5]' : 'text-console-gold')}>
          {isBlue ? 'Blue Verified' : 'Gold Verified'}
        </span>
      </span>
      {user.verificationExpiresAt ? (
        <span className="text-[10px] text-console-text-3">Expires {fmtDate(user.verificationExpiresAt)}</span>
      ) : null}
    </span>
  );
}

// ============================================================================
// ACCESSIBLE ROW ACTION MENU
// ============================================================================

interface MenuAction {
  key: string;
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'gold';
  onSelect: () => void;
}

function ActionMenu({ actions, label }: { actions: MenuAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown'
      ? items[(index + 1) % items.length]
      : items[(index - 1 + items.length) % items.length];
    next?.focus();
  };

  const toneClass: Record<string, string> = {
    default: 'text-console-text-2 hover:bg-white/[0.05] hover:text-console-text',
    warning: 'text-console-warning hover:bg-console-warning-soft',
    danger: 'text-console-danger hover:bg-console-danger-soft',
    gold: 'text-console-gold hover:bg-console-gold-soft',
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="vc-focus grid h-8 w-8 place-items-center rounded-lg text-console-text-3 transition-colors hover:bg-white/[0.06] hover:text-console-text"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-30 mt-1 w-56 origin-top-right overflow-hidden rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 py-1 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
        >
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium transition-colors',
                toneClass[a.tone || 'default'],
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// SHARED MODAL SHELL
// ============================================================================

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'vc-panel w-full max-h-[86vh] overflow-y-auto p-5 text-left shadow-[0_24px_64px_rgba(0,0,0,0.55)] outline-none',
          width,
        )}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-console-text">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-console-text-3">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="vc-focus shrink-0 rounded-lg p-1.5 text-console-text-3 transition-colors hover:bg-white/[0.05] hover:text-console-text"
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

// ============================================================================
// CONFIRMATION DIALOG WITH OPTIONAL REASON / END DATE
// ----------------------------------------------------------------------------
// Wraps the shared ConfirmDialog, adding a moderation-reason textarea (and,
// for suspensions, an optional end date) inside its `details` slot. The
// reason is only sent to the backend after the admin confirms.
// ============================================================================

function ConfirmWithReasonDialog({
  open,
  kind,
  busy,
  withEndDate = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  kind: ConfirmKind;
  busy: boolean;
  withEndDate?: boolean;
  error?: string;
  onConfirm: (reason: string, until: string | undefined) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setUntil('');
    }
  }, [open]);

  const copy = CONFIRM_COPY[kind];

  return (
    <ConfirmDialog
      open={open}
      title={copy.title}
      message={copy.message}
      confirmLabel={copy.confirm}
      tone={kind === 'restore' || kind === 'unban' ? 'primary' : 'danger'}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => onConfirm(reason.trim(), withEndDate && until ? until : undefined)}
      details={
        kind === 'suspend' || kind === 'ban' || error ? (
          <div className="space-y-2.5">
            {error ? (
              <p role="alert" className="text-[11px] font-medium text-console-danger">
                {error}
              </p>
            ) : null}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-console-text-3" htmlFor={`reason-${kind}`}>
                Reason <span className="normal-case text-console-text-3/70">(shown to the user when permitted)</span>
              </label>
              <textarea
                id={`reason-${kind}`}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={kind === 'suspend' ? 'e.g. Spammy comments after warnings' : 'e.g. Harassment violations'}
                className={cn(inputClass, 'mt-1 resize-y')}
              />
            </div>
            {withEndDate ? (
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-console-text-3" htmlFor="reason-until">
                  Ends on <span className="normal-case text-console-text-3/70">(optional)</span>
                </label>
                <input
                  id="reason-until"
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className={cn(inputClass, 'mt-1')}
                />
              </div>
            ) : null}
          </div>
        ) : null
      }
    />
  );
}

// ============================================================================
// VERIFICATION PLAN MANAGER
// ----------------------------------------------------------------------------
// Modal for one user: shows current badge state, then lets the admin assign
// or reassign any of the four verification plans (server-authoritative list
// from GET /api/admin/users/verification/:userId) or remove the badge with a
// confirmation step. Account moderation status is never touched here.
// ============================================================================

function VerificationManagerModal({
  user,
  token,
  onClose,
  onChanged,
  onNotice,
}: {
  user: UserRecord;
  token: string;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (msg: string) => void;
}) {
  const [state, setState] = useState<AdminVerificationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await getVerificationState(token, user.id);
      setState(result);
      setSelectedPlan(result.activePlan || '');
    } catch (caught: any) {
      setLoadError(caught?.message || 'Could not load verification state.');
    } finally {
      setLoading(false);
    }
  }, [token, user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAssign = async () => {
    if (!selectedPlan || assigning) return;
    setAssigning(true);
    try {
      const result = await assignVerification(token, user.id, selectedPlan);
      onNotice(result?.message || 'Verification plan assigned.');
      await load();
      onChanged();
    } catch (caught: any) {
      setLoadError(caught?.message || 'Could not assign the verification plan.');
    } finally {
      setAssigning(false);
    }
  };

  const handleRemove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      const result = await removeVerification(token, user.id);
      onNotice(result?.message || 'Verification badge removed.');
      setConfirmRemove(false);
      await load();
      onChanged();
    } catch (caught: any) {
      setLoadError(caught?.message || 'Could not remove the verification badge.');
    } finally {
      setRemoving(false);
    }
  };

  const badge = state?.badge;
  const badgeActive = Boolean(state?.active);
  const planCount = state?.plans?.length ?? 0;

  return (
    <>
      <ModalShell
        title="Manage verification"
        subtitle={`@${user.username}`}
        onClose={onClose}
      >
        {/* User summary */}
        <div className="flex items-center gap-3 rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-3">
          <UserIdentity user={user} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-console-text">{user.fullName || user.username}</p>
            <p className="truncate text-xs text-console-text-3">@{user.username}</p>
          </div>
          <div className="ml-auto text-right">
            {badgeActive && badge ? (
              <span className="inline-flex items-center gap-1.5">
                <VerificationBadge type={badge.badgeType} size="xs" />
                <span className={cn('text-xs font-semibold', badge.badgeType === 'BLUE' ? 'text-[#7db8f5]' : 'text-console-gold')}>
                  {badge.badgeType === 'BLUE' ? 'Blue Verified' : 'Gold Verified'}
                </span>
              </span>
            ) : (
              <span className="text-xs text-console-text-3">Not verified</span>
            )}
            {badgeActive && badge?.expiresAt ? (
              <p className="mt-0.5 text-[10px] text-console-text-3">Expires {fmtDate(badge.expiresAt)}</p>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="mt-4"><SkeletonRows rows={3} /></div>
        ) : loadError ? (
          <p role="alert" className="mt-4 rounded-[var(--vc-radius)] border border-console-danger/30 bg-console-danger-soft px-3 py-2 text-xs text-console-danger">
            {loadError}
          </p>
        ) : (
          <>
            {/* Current plan detail */}
            {badgeActive && state?.activePlan ? (
              <p className="mt-3 text-xs text-console-text-2">
                Current plan:{' '}
                <span className="font-semibold text-console-text">{state.activePlan.replace(/_/g, ' ')}</span>
              </p>
            ) : badgeActive ? (
              <p className="mt-3 text-xs text-console-text-2">
                Legacy verified identity — no scheduled plan. Assigning a plan replaces it with an expiring badge.
              </p>
            ) : null}

            {/* Plan picker */}
            <fieldset className="mt-4">
              <legend className="text-[11px] font-semibold uppercase tracking-wider text-console-text-3">
                Available plans
              </legend>
              {planCount > 0 ? (
                <div className="mt-2 space-y-1.5">
                  {state?.plans.map((plan) => (
                    <label
                      key={plan.key}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-[var(--vc-radius)] border px-3 py-2.5 transition-colors',
                        selectedPlan === plan.key
                          ? 'border-console-gold/60 bg-console-gold-soft/40'
                          : 'border-console-border bg-console-bg2 hover:border-console-border-strong',
                      )}
                    >
                      <input
                        type="radio"
                        name="verification-plan"
                        value={plan.key}
                        checked={selectedPlan === plan.key}
                        onChange={() => setSelectedPlan(plan.key)}
                        className="accent-[#d6a83f]"
                      />
                      <VerificationBadge type={plan.badgeType} size="xs" />
                      <span className="text-xs font-semibold text-console-text">
                        {plan.badgeType === 'BLUE' ? 'Blue Verified' : 'Gold Verified'}
                      </span>
                      <span className="ml-auto text-xs text-console-text-3">{plan.durationLabel}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-console-text-3">No plans available.</p>
              )}
            </fieldset>

            {/* Actions */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                disabled={!badgeActive || removing}
                className="vc-focus inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-danger/40 px-3.5 text-xs font-semibold text-console-danger transition-colors hover:bg-console-danger-soft disabled:opacity-40"
              >
                <CircleSlash size={13} aria-hidden /> Remove badge
              </button>
              <button
                type="button"
                onClick={() => void handleAssign()}
                disabled={!selectedPlan || assigning || selectedPlan === state?.activePlan}
                className="vc-focus inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] bg-console-gold px-4 text-xs font-semibold text-console-gold-fg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {assigning ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <BadgeCheck size={13} aria-hidden />}
                {state?.activePlan && selectedPlan !== state.activePlan ? 'Update badge' : 'Assign badge'}
              </button>
            </div>
          </>
        )}
      </ModalShell>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove verification badge"
        message={`Removes the active verification badge from @${user.username}. The badge disappears from all interfaces immediately. This does not change their account status.`}
        confirmLabel="Remove badge"
        busy={removing}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void handleRemove()}
      />
    </>
  );
}

// ============================================================================
// APPEALS REVIEW MODAL
// ----------------------------------------------------------------------------
// Per-user appeal history for admins: lists every appeal with status, content,
// and review metadata, and lets authorized admins mark appeals under review or
// approve/reject them with an internal note. Approving optionally restores the
// account; rejecting never changes account status.
// ============================================================================

function AppealsReviewModal({
  user,
  token,
  onClose,
  onNotice,
}: {
  user: UserRecord;
  token: string;
  onClose: () => void;
  onNotice: (msg: string) => void;
}) {
  const [appeals, setAppeals] = useState<AppealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decisionFor, setDecisionFor] = useState<AppealRecord | null>(null);
  const [decisionValue, setDecisionValue] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [decisionNote, setDecisionNote] = useState('');
  const [restoreAccount, setRestoreAccount] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await getAppealsForUser(token, user.id);
      setAppeals(result.appeals || []);
    } catch (caught: any) {
      setLoadError(caught?.message || 'Could not load appeals.');
    } finally {
      setLoading(false);
    }
  }, [token, user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUnderReview = async (appeal: AppealRecord) => {
    setBusyId(appeal.id);
    try {
      const result = await markAppealUnderReview(token, appeal.id);
      onNotice(result?.message || 'Appeal is now under review.');
      await load();
    } catch (caught: any) {
      setLoadError(caught?.message || 'Could not update the appeal.');
    } finally {
      setBusyId(null);
    }
  };

  const openDecision = (appeal: AppealRecord, value: 'APPROVED' | 'REJECTED') => {
    setDecisionFor(appeal);
    setDecisionValue(value);
    setDecisionNote('');
    setRestoreAccount(value === 'APPROVED');
  };

  const submitDecision = async () => {
    if (!decisionFor || deciding) return;
    setDeciding(true);
    try {
      const result = await decideAppeal(token, decisionFor.id, decisionValue, {
        note: decisionNote.trim() || undefined,
        restoreAccount: decisionValue === 'APPROVED' ? restoreAccount : false,
      });
      onNotice(result?.message || 'Appeal decision recorded.');
      setDecisionFor(null);
      await load();
    } catch (caught: any) {
      setLoadError(caught?.message || 'Could not record the decision.');
    } finally {
      setDeciding(false);
    }
  };

  const openable = (a: AppealRecord) => a.status === 'PENDING' || a.status === 'UNDER_REVIEW';

  return (
    <>
      <ModalShell
        title="Appeal history"
        subtitle={`@${user.username}`}
        onClose={onClose}
        width="max-w-2xl"
      >
        {/* Current moderation context (from the users table row) */}
        <div className="rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-3 text-xs">
          <p className="font-semibold uppercase tracking-wider text-console-text-3">Account status</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusToneFor(user.status)} label={STATUS_LABEL[user.status] || user.status} />
            {user.status === 'SUSPENDED' ? (
              <span className="text-console-text-2">
                {user.suspendedAt ? `Suspended ${timeAgo(user.suspendedAt)}` : 'Suspension active'}
                {user.suspendedUntil ? ` · ends ${fmtDate(user.suspendedUntil)}` : ' · indefinite'}
              </span>
            ) : null}
            {user.status === 'BANNED' && user.bannedAt ? (
              <span className="text-console-text-2">Banned {timeAgo(user.bannedAt)}</span>
            ) : null}
          </div>
          {user.status === 'SUSPENDED' && user.suspendedReason ? (
            <p className="mt-1.5 text-console-text-2">Reason: {user.suspendedReason}</p>
          ) : null}
          {user.status === 'BANNED' && user.bannedReason ? (
            <p className="mt-1.5 text-console-text-2">Reason: {user.bannedReason}</p>
          ) : null}
        </div>

        {loading ? (
          <div className="mt-4"><SkeletonRows rows={3} /></div>
        ) : loadError ? (
          <p role="alert" className="mt-4 rounded-[var(--vc-radius)] border border-console-danger/30 bg-console-danger-soft px-3 py-2 text-xs text-console-danger">
            {loadError}
          </p>
        ) : appeals.length === 0 ? (
          <p className="mt-4 text-xs text-console-text-3">No appeals have been submitted by this account.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {appeals.map((appeal) => (
              <li key={appeal.id} className="rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={statusToneFor(appeal.status) as StatusTone}
                    label={APPEAL_STATUS_LABEL[appeal.status] || appeal.status}
                  />
                  <span className="text-xs font-semibold uppercase tracking-wider text-console-text-3">
                    {appeal.category.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  <span className="ml-auto text-[11px] text-console-text-3">
                    Submitted {fmtDate(appeal.createdAt)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-console-text-2">
                  {appeal.explanation}
                </p>
                {appeal.supportingInfo ? (
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-console-text-3">
                    Supporting: {appeal.supportingInfo}
                  </p>
                ) : null}
                {appeal.status !== 'PENDING' && appeal.status !== 'UNDER_REVIEW' ? (
                  <div className="mt-2.5 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] text-console-text-3">
                    <p>
                      {APPEAL_STATUS_LABEL[appeal.status] || appeal.status}
                      {appeal.reviewedAt ? ` · ${fmtDate(appeal.reviewedAt)}` : ''}
                      {appeal.accountRestored ? ' · account restored' : ''}
                    </p>
                    {appeal.decisionNote ? <p className="mt-1">Note: {appeal.decisionNote}</p> : null}
                  </div>
                ) : null}
                {openable(appeal) ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUnderReview(appeal)}
                      disabled={busyId === appeal.id || appeal.status === 'UNDER_REVIEW'}
                      className="vc-focus inline-flex min-h-8 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-border-strong px-3 text-[11px] font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      <History size={12} aria-hidden /> Mark under review
                    </button>
                    <button
                      type="button"
                      onClick={() => openDecision(appeal, 'APPROVED')}
                      disabled={busyId === appeal.id}
                      className="vc-focus inline-flex min-h-8 items-center gap-1.5 rounded-[var(--vc-radius)] bg-console-gold px-3 text-[11px] font-semibold text-console-gold-fg transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      <BadgeCheck size={12} aria-hidden /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => openDecision(appeal, 'REJECTED')}
                      disabled={busyId === appeal.id}
                      className="vc-focus inline-flex min-h-8 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-danger/40 px-3 text-[11px] font-semibold text-console-danger transition-colors hover:bg-console-danger-soft disabled:opacity-40"
                    >
                      <Ban size={12} aria-hidden /> Reject
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ModalShell>

      {/* Decision dialog — approval can optionally restore the account;
          rejection never changes account status (backend enforces this). */}
      {decisionFor ? (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !deciding) setDecisionFor(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={decisionValue === 'APPROVED' ? 'Approve appeal' : 'Reject appeal'}
            className="vc-panel w-full max-w-md p-5 shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
          >
            <h3 className="text-sm font-semibold text-console-text">
              {decisionValue === 'APPROVED' ? 'Approve appeal' : 'Reject appeal'}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-console-text-2">
              {decisionValue === 'APPROVED'
                ? 'Approving records the decision. Restore the account to active status in the same step only if the restriction should be lifted now.'
                : 'Rejecting records the decision. The account stays restricted — rejection never changes account status.'}
            </p>
            {decisionValue === 'APPROVED' ? (
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-3 text-xs text-console-text-2">
                <input
                  type="checkbox"
                  checked={restoreAccount}
                  onChange={(e) => setRestoreAccount(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[#d6a83f]"
                />
                <span>
                  Restore account to active status
                  <span className="mt-0.5 block text-[11px] text-console-text-3">
                    Lifts the {decisionFor.accountStatus === 'BANNED' ? 'ban' : 'suspension'} and lets the user use VANTA again immediately.
                  </span>
                </span>
              </label>
            ) : null}
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-console-text-3" htmlFor="appeal-decision-note">
              Internal decision note <span className="normal-case font-normal">(optional)</span>
            </label>
            <textarea
              id="appeal-decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Recorded in the audit trail for other moderators…"
              className={cn(inputClass, 'mt-1 resize-y')}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDecisionFor(null)}
                disabled={deciding}
                className="vc-focus inline-flex min-h-9 items-center rounded-[var(--vc-radius)] border border-console-border-strong px-4 text-xs font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitDecision()}
                disabled={deciding}
                aria-busy={deciding || undefined}
                className={cn(
                  'vc-focus inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] px-4 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-60',
                  decisionValue === 'APPROVED'
                    ? 'bg-console-gold text-console-gold-fg'
                    : 'bg-console-danger text-white',
                )}
              >
                {deciding ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
                {decisionValue === 'APPROVED' ? 'Confirm approval' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ============================================================================
// USERS CONTENT (reads URL state; Suspense-wrapped for useSearchParams)
// ============================================================================

function UsersContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { token, user: me } = useAuth();

  // URL-synced filters so search/filter/pagination state survives navigation.
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || 'ALL';
  const role = searchParams.get('role') || 'ALL';
  const verified = searchParams.get('verified') || 'ALL';
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1);

  const [searchInput, setSearchInput] = useState(search);
  const [pageData, setPageData] = useState<UserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  // Monotonic sequence so a slow, older response can never overwrite a newer
  // one while the admin types quickly or flips filters (stale-response guard).
  const fetchSeq = useRef(0);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '' || value === 'ALL') params.delete(key);
        else params.set(key, value);
      }
      router.replace(`${pathname}${params.toString() ? `?${params}` : ''}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Debounce the free-text search so typing doesn't spam the API; filter and
  // page changes apply immediately (they only reset/keep the query params).
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const timer = setTimeout(() => {
      setParams({ search: trimmed || null, page: null });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, search, setParams]);

  const load = useCallback(async () => {
    if (!token) return;
    const seq = ++fetchSeq.current;
    setLoading(true);
    setLoadError('');
    try {
      const data = await getUsers(token, {
        search: search || undefined,
        status,
        role,
        verified,
        page,
        limit: PAGE_SIZE,
      });
      if (seq !== fetchSeq.current) return; // stale response — drop it
      setPageData(data);
    } catch (caught: any) {
      if (seq !== fetchSeq.current) return;
      setLoadError(caught?.message || 'Could not load users.');
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [token, search, status, role, verified, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------------------------------------------------------------------------
  // Consequential action plumbing (suspend/ban/restore/lift/delete with reasons)
  // ---------------------------------------------------------------------------
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; target: UserRecord } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [verifyTarget, setVerifyTarget] = useState<UserRecord | null>(null);
  const [appealsTarget, setAppealsTarget] = useState<UserRecord | null>(null);

  const openConfirm = (kind: ConfirmKind, target: UserRecord) => {
    setConfirm({ kind, target });
    setConfirmError('');
  };

  const runConfirm = async (reasonValue: string, untilValue?: string) => {
    if (!confirm || !token) return;
    const { kind, target } = confirm;
    setConfirmBusy(true);
    setConfirmError('');
    try {
      const trimmedReason = reasonValue.trim() || undefined;
      let message = '';
      if (kind === 'suspend') {
        const result = await suspendUser(token, target.id, trimmedReason, untilValue || undefined);
        message = result?.message || 'User suspended.';
      } else if (kind === 'ban') {
        const result = await banUser(token, target.id, trimmedReason);
        message = result?.message || 'User banned.';
      } else if (kind === 'restore') {
        const result = await restoreUser(token, target.id);
        message = result?.message || 'User restored.';
      } else if (kind === 'unban') {
        const result = await unbanUser(token, target.id);
        message = result?.message || 'Ban lifted.';
      } else {
        const result = await deleteUser(token, target.id);
        message = result?.message || 'User deleted.';
      }
      setNotice(`${message} (@${target.username})`);
      setConfirm(null);
      await load();
    } catch (caught: any) {
      setConfirmError(caught?.message || 'The action failed. Nothing was changed.');
    } finally {
      setConfirmBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // ROW ACTIONS (contextual per account status)
  // ---------------------------------------------------------------------------
  const actionsFor = (u: UserRecord): MenuAction[] => {
    const actions: MenuAction[] = [
      {
        key: 'verify',
        label: 'Manage verification',
        icon: <BadgeCheck size={14} aria-hidden />,
        tone: 'gold',
        onSelect: () => setVerifyTarget(u),
      },
      {
        key: 'appeals',
        label: 'Appeal history',
        icon: <History size={14} aria-hidden />,
        onSelect: () => setAppealsTarget(u),
      },
      {
        key: 'profile',
        label: 'View profile',
        icon: <ExternalLink size={14} aria-hidden />,
        onSelect: () => router.push(`/profile/${u.username}`),
      },
    ];
    if (u.status === 'ACTIVE' || u.status === 'DEACTIVATED' || u.status === 'LOCKED') {
      actions.push(
        { key: 'suspend', label: 'Suspend account', icon: <Shield size={14} aria-hidden />, tone: 'warning', onSelect: () => openConfirm('suspend', u) },
        { key: 'ban', label: 'Ban account', icon: <Ban size={14} aria-hidden />, tone: 'danger', onSelect: () => openConfirm('ban', u) },
      );
    }
    if (u.status === 'SUSPENDED') {
      actions.push(
        { key: 'restore', label: 'Restore account', icon: <RotateCcw size={14} aria-hidden />, onSelect: () => openConfirm('restore', u) },
      );
    }
    if (u.status === 'BANNED') {
      actions.push(
        { key: 'unban', label: 'Lift ban', icon: <RotateCcw size={14} aria-hidden />, onSelect: () => openConfirm('unban', u) },
      );
    }
    if (u.id !== me?.id) {
      actions.push({ key: 'delete', label: 'Delete account', icon: <Trash2 size={14} aria-hidden />, tone: 'danger', onSelect: () => openConfirm('delete', u) });
    }
    return actions;
  };



  const users = pageData?.users || [];
  const hasFilters = search !== '' || status !== 'ALL' || role !== 'ALL' || verified !== 'ALL';

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 lg:px-10">
      {/* Page header — VANTA / Management · Users */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-console-gold">
            VANTA / Management
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-console-text">Users</h1>
          <p className="mt-1 max-w-2xl text-sm text-console-text-2">
            Manage users, verification badges, account restrictions, and appeals.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="vc-focus inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-border-strong px-3.5 text-xs font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} aria-hidden />
          Refresh
        </button>
      </header>

      {/* Live region for action outcomes (polite for screen readers). */}
      <div aria-live="polite" className="mt-4">
        {notice ? (
          <p className="rounded-[var(--vc-radius)] border border-console-success/30 bg-console-success-soft px-3.5 py-2.5 text-xs font-medium text-console-success">
            {notice}
          </p>
        ) : null}
      </div>

      {/* Search + filters */}
      <ConsolePanel className="mt-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="admin-user-search" className="sr-only">
              Search by username, @handle, display name, or email
            </label>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-console-text-3" aria-hidden />
            <input
              id="admin-user-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search username, @handle, display name, or email…"
              autoComplete="off"
              spellCheck={false}
              className={cn(inputClass, 'py-2.5 pl-9 pr-16')}
              aria-describedby="admin-user-search-hint"
            />
            <span className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              {loading ? (
                <Loader2 size={13} className="animate-spin text-console-text-3" aria-label="Searching" />
              ) : null}
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  aria-label="Clear search"
                  className="vc-focus rounded p-1 text-console-text-3 transition-colors hover:text-console-text"
                >
                  <X size={13} aria-hidden />
                </button>
              ) : null}
            </span>
            <span id="admin-user-search-hint" className="sr-only">
              Exact username matches are listed first. A leading @ is ignored.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto">
            <select
              aria-label="Filter by account status"
              value={status}
              onChange={(e) => setParams({ status: e.target.value, page: null })}
              className={cn(inputClass, 'lg:w-40')}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              aria-label="Filter by role"
              value={role}
              onChange={(e) => setParams({ role: e.target.value, page: null })}
              className={cn(inputClass, 'lg:w-40')}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r === 'ALL' ? 'All roles' : r.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select
              aria-label="Filter by verification status"
              value={verified}
              onChange={(e) => setParams({ verified: e.target.value, page: null })}
              className={cn(inputClass, 'lg:w-48')}
            >
              {VERIFIED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        {hasFilters ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-console-text-3">
            <span>Filters active:</span>
            {search ? <span className="rounded-full bg-white/[0.06] px-2 py-0.5">search: “{search}”</span> : null}
            {status !== 'ALL' ? <span className="rounded-full bg-white/[0.06] px-2 py-0.5">status: {status}</span> : null}
            {role !== 'ALL' ? <span className="rounded-full bg-white/[0.06] px-2 py-0.5">role: {role}</span> : null}
            {verified !== 'ALL' ? <span className="rounded-full bg-white/[0.06] px-2 py-0.5">verification: {verified}</span> : null}
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setParams({ search: null, status: null, role: null, verified: null, page: null });
              }}
              className="vc-focus rounded px-1.5 py-0.5 font-semibold text-console-gold underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          </div>
        ) : null}
      </ConsolePanel>

      {/* Results — error / empty / loading / table */}
      <ConsolePanel className="mt-4">
        {loadError ? (
          <ConsoleErrorState message={loadError} onRetry={() => void load()} />
        ) : loading && !pageData ? (
          <SkeletonRows rows={6} />
        ) : users.length === 0 ? (
          <ConsoleEmptyState
            icon={<Users size={22} aria-hidden />}
            title={hasFilters ? 'No users match these filters' : 'No users found'}
            description={
              hasFilters
                ? search
                  ? `Nothing matched “${search}” with the current filters. Try the username without the @, or clear the filters.`
                  : 'Try adjusting the status, role, or verification filters.'
                : 'Once users register they will appear here.'
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-console-border text-[10px] uppercase tracking-wider text-console-text-3">
                    <th scope="col" className="px-3 py-2.5 font-semibold">User</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Username</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Account status</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Verification</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Joined</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-console-border/60">
                  {users.map((u) => (
                    <tr key={u.id} className="group transition-colors hover:bg-white/[0.02]">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <UserIdentity user={u} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-console-text">
                              {u.fullName || u.username}
                              {u.id === me?.id ? (
                                <span className="ml-1.5 rounded bg-console-gold-soft px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-console-gold">You</span>
                              ) : null}
                            </p>
                            <p className={cn('truncate text-[11px] font-medium', roleClass[u.role] || 'text-console-text-3')}>
                              {(u.role || 'USER').replace(/_/g, ' ')}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-mono text-[11px] text-console-text-2">@{u.username}</span>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge
                          tone={statusToneFor(u.status) as StatusTone}
                          label={STATUS_LABEL[u.status] || u.status}
                          pulse={u.status === 'ACTIVE'}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <VerificationCell user={u} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-console-text-3" title={fmtDate(u.createdAt)}>
                        {timeAgo(u.createdAt)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <ActionMenu actions={actionsFor(u)} label={`Actions for @${u.username}`} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <ul className="space-y-2 md:hidden">
              {users.map((u) => (
                <li key={u.id} className="rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <UserIdentity user={u} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-console-text">
                          {u.fullName || u.username}
                          {u.id === me?.id ? (
                            <span className="ml-1.5 rounded bg-console-gold-soft px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-console-gold">You</span>
                          ) : null}
                        </p>
                        <p className="truncate font-mono text-[11px] text-console-text-3">@{u.username}</p>
                      </div>
                    </div>
                    <ActionMenu actions={actionsFor(u)} label={`Actions for @${u.username}`} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone={statusToneFor(u.status) as StatusTone}
                      label={STATUS_LABEL[u.status] || u.status}
                    />
                    <VerificationCell user={u} />
                    <span className="ml-auto text-[11px] text-console-text-3" title={fmtDate(u.createdAt)}>
                      Joined {timeAgo(u.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Pagination — keeps the current search + filters */}
            {pageData && (pageData.pages > 1 || pageData.total > 0) ? (
              <nav
                aria-label="User list pages"
                className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-console-border pt-3"
              >
                <p className="text-[11px] text-console-text-3" aria-live="polite">
                  {pageData.total.toLocaleString()} {pageData.total === 1 ? 'user' : 'users'} · page {page} of {pageData.pages}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setParams({ page: String(Math.max(1, page - 1)) })}
                    disabled={page <= 1 || loading}
                    aria-label="Previous page"
                    className="vc-focus inline-flex min-h-8 items-center gap-1 rounded-[var(--vc-radius)] border border-console-border-strong px-2.5 text-[11px] font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text disabled:opacity-40"
                  >
                    <ChevronLeft size={13} aria-hidden /> Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setParams({ page: String(page + 1) })}
                    disabled={page >= (pageData?.pages || 1) || loading}
                    aria-label="Next page"
                    className="vc-focus inline-flex min-h-8 items-center gap-1 rounded-[var(--vc-radius)] border border-console-border-strong px-2.5 text-[11px] font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text disabled:opacity-40"
                  >
                    Next <ChevronRight size={13} aria-hidden />
                  </button>
                </div>
              </nav>
            ) : null}
          </>
        )}
      </ConsolePanel>

      {/* Consequential-action confirm (suspend/ban/restore/lift/delete) */}
      {confirm ? (
        <ConfirmWithReasonDialog
          open
          kind={confirm.kind}
          busy={confirmBusy}
          withEndDate={confirm.kind === 'suspend'}
          error={confirmError || undefined}
          onConfirm={(reasonValue, untilValue) => void runConfirm(reasonValue, untilValue)}
          onCancel={() => {
            if (confirmBusy) return;
            setConfirm(null);
            setConfirmError('');
          }}
        />
      ) : null}

      {/* Selective verification-plan management */}
      {token && verifyTarget ? (
        <VerificationManagerModal
          token={token}
          user={verifyTarget}
          onClose={() => setVerifyTarget(null)}
          onChanged={() => void load()}
          onNotice={setNotice}
        />
      ) : null}

      {/* Appeal review for this account */}
      {token && appealsTarget ? (
        <AppealsReviewModal
          token={token}
          user={appealsTarget}
          onClose={() => setAppealsTarget(null)}
          onNotice={(msg: string) => {
            setNotice(msg);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

// ============================================================================
// DEFAULT EXPORT — Suspense boundary is required for useSearchParams in Next.js
// ============================================================================

export default function UsersPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center">
          <Loader2 className="animate-spin text-white/40" aria-label="Loading" />
        </main>
      }
    >
      <UsersContent />
    </Suspense>
  );
}



