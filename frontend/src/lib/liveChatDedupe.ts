'use client';

/**
 * liveChatDedupe
 * --------------
 * Pure, side-effect-free reconciliation for VANTA Live chat overlays.
 *
 * The Live chat receives the same message through several near-simultaneous
 * paths:
 *   1. `host_chat_history` — the server's persisted buffer is loaded once.
 *   2. `new_comment` — each newly persisted message is pushed (and, for a host,
 *      pushed AGAIN via the dedicated `user_<hostId>` room to guarantee delivery
 *      across reconnects).
 *   3. reconnection — Socket.IO re-fires history + live events that can overlap
 *      with messages already applied optimistically.
 *
 * Because the exact same server message can arrive twice, the overlay must
 * reconcile by stable identity (server message id / _id) and, for the rare
 * un-ids message, by content+author within a short window. This module encodes
 * exactly that reconciliation so we can unit-test it without a DOM.
 *
 * It is NON-destructive by design: messages that fall out of the visible
 * working set are returned via `overflow` so callers can keep them accessible
 * (opening full chat), never silently deleting user content.
 */

/** A minimal structural shape for a live chat line. */
export interface ChatLineLike {
  /** Stable message id when present (e.g. Prisma/SQL id, or `_id`). */
  id?: unknown;
  /** The message text / system text. */
  message?: unknown;
  /** Optional author id used as a fallback dedup key when `id` is absent. */
  userId?: unknown;
  /** Optional server kind (e.g. 'comment' | 'system'). */
  kind?: unknown;
  /** Server timestamp, used to keep oldest-first ordering. */
  at?: unknown;
  /**
   * A function that returns the stable server id for a line, or null if the
   * line carries no usable id. Defaults to reading `line.id`.
   */
  idOf?: (line: ChatLineLike) => unknown;
  /**
   * A function that returns a short-lived content fingerprint (author+text)
   * used to collapse server-un-ids duplicates. Defaults to combining
   * `userId` + `message`.
   */
  fingerprintOf?: (line: ChatLineLike) => string;
}

export interface ReconcileOptions {
  /** Maximum number of messages to keep in the visible working set. */
  maxVisible?: number;
  /**
   * Maximum number of messages currently made inaccessible (overflow). Pass
   * the previously returned overflow so an earlier overflow stays reachable.
   */
  maxOverflow?: number;
  /**
   * A function that returns the stable server id for a line, or null if the
   * line carries no usable id. Defaults to reading `line.id`.
   */
  idOf?: (line: ChatLineLike) => unknown;
  /**
   * A function that returns a short-lived content fingerprint (author+text)
   * used to collapse server-un-ids duplicates. Defaults to combining
   * `userId` + `message`.
   */
  fingerprintOf?: (line: ChatLineLike) => string;
}

export interface ReconcileResult {
  /** The visible working set, oldest-first, deduplicated, capped. */
  visible: ChatLineLike[];
  /**
   * Messages that collapsed out of the visible set. Kept (not deleted) so the
   * caller can surface them through a "full chat" view.
   */
  overflow: ChatLineLike[];
}

const defId = (line: ChatLineLike) => (line as { id?: unknown }).id;
const defFingerprint = (line: ChatLineLike) =>
  [line.userId, line.message].map((v) => (v === undefined ? '' : String(v))).join('\u0000');

function stableId(line: ChatLineLike, idOf?: (l: ChatLineLike) => unknown): string | null {
  const raw = idOf ? idOf(line) : defId(line);
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s.length ? s : null;
}

function sortKey(line: ChatLineLike): number {
  const t = line.at;
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    const n = Date.parse(t);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

/**
 * Reconcile an incoming batch of live chat messages into a deduplicated,
 * ordered, capped working set.
 *
 * Ordering: newest-first `next` arrivals are re-sorted oldest-first by `at`
 * when timestamps exist; otherwise they stay appended in arrival order.
 */
export function reconcileLiveChat(
  current: ChatLineLike[],
  next: ChatLineLike[],
  options: ReconcileOptions = {},
): ReconcileResult {
  const { maxVisible = 80, maxOverflow = 500 } = options;
  const idOf = options.idOf ?? defId;
  const fingerprintOf = options.fingerprintOf ?? defFingerprint;

  // Track identity across the union so the same message arriving via history +
  // live push (or a duplicate `user_<hostId>` push) lands exactly once.
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const merged: ChatLineLike[] = [];

  const consider = (line: ChatLineLike) => {
    const id = stableId(line, idOf);
    if (id) {
      if (seenIds.has(id)) return;
      seenIds.add(id);
    } else {
      const fp = fingerprintOf(line);
      if (seenFingerprints.has(fp)) return;
      seenFingerprints.add(fp);
    }
    merged.push(line);
  };

  // Existing working set first, then the new arrivals.
  current.forEach(consider);
  next.forEach(consider);

  // Keep server-ordered messages ascending when `at` is meaningful.
  merged.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka !== 0 && kb !== 0) return ka - kb;
    return 0;
  });

  // Cap overflow first (only relevant when combined with a previous overflow).
  const overflowAll = merged.slice(0, Math.max(0, merged.length - maxVisible));
  const overflow = overflowAll.slice(Math.max(0, overflowAll.length - maxOverflow));
  const visible = merged.slice(Math.max(0, merged.length - maxVisible));
  return { visible, overflow };
}