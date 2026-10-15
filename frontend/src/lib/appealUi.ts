// Time formatting for account notice timestamps.
export function timeAgoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Shared appeal category options for the suspended/banned screens.
export const APPEAL_CATEGORY_OPTIONS = [
  { value: 'ACCOUNT_RESTRICTION', label: 'My restriction' },
  { value: 'CONTENT', label: 'A content decision' },
  { value: 'BEHAVIOR', label: 'A behavior decision' },
  { value: 'IMPERSONATION', label: 'An identity decision' },
  { value: 'OTHER', label: 'Something else' },
] as const;

// Human copy for each appeal lifecycle state.
export const APPEAL_STATUS_COPY: Record<string, { label: string; detail: string }> = {
  PENDING: { label: 'Pending review', detail: 'Your appeal is waiting for a VANTA moderator.' },
  UNDER_REVIEW: { label: 'Under review', detail: 'A VANTA moderator is reviewing your appeal.' },
  APPROVED: { label: 'Approved', detail: 'Your appeal was approved.' },
  REJECTED: { label: 'Rejected', detail: 'Your appeal was reviewed and the restriction was upheld.' },
};
