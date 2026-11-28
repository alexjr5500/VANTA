import { prisma } from "../prisma";

// ============================================================================
// CallSessionService — server-side state for private 1-to-1 calls.
//
// Previously the backend was a pure signaling relay: an incoming call only
// existed while both users happened to be connected to Socket.IO. This service
// persists a CallSession per call so that:
//   * An incoming call for an OFFLINE callee is not lost — the WebRTC offer
//     (and buffered ICE candidates) live server-side and are fetched by the
//     push "Answer" action from a cold start.
//   * Races resolve authoritatively (cancel vs answer, answered on another
//     device) instead of producing ghost calls.
//   * The signaling handlers stay idempotent: only a RINGING call transitions,
//     so duplicate/retried events are no-ops.
// ============================================================================

const CALL_RING_TIMEOUT_MS = 90_000;

export type CallStatus =
  | "RINGING"
  | "ANSWERED"
  | "CANCELLED"
  | "DECLINED"
  | "ENDED"
  | "EXPIRED"
  | "UNREACHABLE";

interface StartCallInput {
  callId: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  type: string;
  offerSdp?: string | null;
}

export class CallSessionService {
  async getRecentHistory(userId: string) {
    // Derive the identity from authenticated request context, never a query param.
    // Signaling data and ICE candidates must not be returned in history.
    const rows = await prisma.callSession.findMany({
      where: { OR: [{ callerId: userId }, { calleeId: userId }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true, callerId: true, calleeId: true, type: true, status: true,
        createdAt: true, answeredAt: true, endedAt: true, expiresAt: true,
        caller: { select: { username: true } },
        callee: { select: { username: true } },
      },
    });
    return rows.map(row => ({
      id: row.id, direction: row.callerId === userId ? "outgoing" : "incoming",
      username: row.callerId === userId ? row.callee.username : row.caller.username,
      type: row.type,
      status: row.status === "RINGING" && row.expiresAt <= new Date() ? "EXPIRED" : row.status,
      createdAt: row.createdAt,
      durationSeconds: row.answeredAt && row.endedAt ? Math.max(0, Math.floor((row.endedAt.getTime() - row.answeredAt.getTime()) / 1000)) : null,
    }));
  }

  async startCall(input: StartCallInput) {
    if (input.callerId === input.calleeId) throw new Error("You cannot call yourself");
    const settings = await prisma.userSettings.findUnique({
      where: { userId: input.calleeId },
      select: { callPermissions: true, privacyCalls: true },
    });
    const permissionValues = [settings?.callPermissions, settings?.privacyCalls].filter(Boolean);
    if (permissionValues.some((value) => value === "nobody" || value === "noone")) throw new Error("This user is not accepting calls");
    if (permissionValues.some((value) => value === "followers" || value === "following")) {
      const followsCallee = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: input.callerId, followingId: input.calleeId } },
        select: { id: true },
      });
      if (!followsCallee) throw new Error("This user only accepts calls from followers");
    }
    const expiresAt = new Date(Date.now() + CALL_RING_TIMEOUT_MS);
    const session = await prisma.callSession.upsert({
      where: { callId: input.callId },
      update: {
        conversationId: input.conversationId,
        callerId: input.callerId,
        calleeId: input.calleeId,
        type: input.type === "video" ? "VIDEO" : "VOICE",
        status: "RINGING",
        offerSdp: input.offerSdp || undefined,
        iceCandidates: null,
        answeredBy: null,
        answeredAt: null,
        endedBy: null,
        endedAt: null,
        expiresAt,
      },
      create: {
        callId: input.callId,
        conversationId: input.conversationId,
        callerId: input.callerId,
        calleeId: input.calleeId,
        type: input.type === "video" ? "VIDEO" : "VOICE",
        status: "RINGING",
        offerSdp: input.offerSdp || undefined,
        expiresAt,
      },
    });
    return session;
  }

  async getSession(callId: string) {
    return prisma.callSession.findUnique({ where: { callId } });
  }  /**
   * Fetch the data the callee needs to answer a call from a cold start (push
   * Answer). Only valid while the call is RINGING (or the answering user's own
   * ANSWERED session while they reconnect their media). Expired/ended calls
   * fail gracefully — no ghost calls.
   */
  async getCallForAnswer(callId: string, userId: string) {
    const session = await prisma.callSession.findUnique({ where: { callId } });
    if (!session) return { ok: false as const, reason: "CALL_NOT_FOUND" };
    if (session.calleeId !== userId) return { ok: false as const, reason: "FORBIDDEN" };

    if (session.status === "RINGING" && session.expiresAt && session.expiresAt.getTime() < Date.now()) {
      await prisma.callSession.updateMany({ where: { callId }, data: { status: "EXPIRED" } });
      return { ok: false as const, reason: "CALL_EXPIRED" };
    }
    if (session.status === "RINGING" || (session.status === "ANSWERED" && session.answeredBy === userId)) {
      return {
        ok: true as const,
        session: {
          callId: session.callId,
          conversationId: session.conversationId,
          callerId: session.callerId,
          calleeId: session.calleeId,
          type: session.type,
          status: session.status,
          offerSdp: session.offerSdp || "",
          iceCandidates: parseCandidates(session.iceCandidates),
        },
      };
    }
    return { ok: false as const, reason: "CALL_UNAVAILABLE" };
  }

  /**
   * Authoritative state transition. Only a session currently in `fromStatuses`
   * transitions to `toStatus` (atomic UPDATE … WHERE), so two racing devices
   * can never double-answer or answer a cancelled call.
   */
  async transition(
    callId: string,
    fromStatuses: CallStatus[],
    toStatus: CallStatus,
    fields: { answeredBy?: string; endedBy?: string } = {}
  ): Promise<{ changed: boolean; session: any; previousStatus?: string }> {
    const data: any = { status: toStatus, updatedAt: new Date() };
    if (fields.answeredBy) {
      data.answeredBy = fields.answeredBy;
      data.answeredAt = new Date();
    }
    if (fields.endedBy) {
      data.endedBy = fields.endedBy;
      data.endedAt = new Date();
    }
    const result = await prisma.callSession.updateMany({
      where: { callId, status: { in: fromStatuses } },
      data,
    });
    const session = await prisma.callSession.findUnique({ where: { callId } });
    if (result.count === 0) {
      return { changed: false, session, previousStatus: session?.status };
    }
    return { changed: true, session, previousStatus: toStatus };
  }

  /** Buffer the caller ICE candidates while the call is RINGING so an offline callee can still connect. */
  async bufferCallerCandidate(callId: string, targetUserId: string, candidateJson: string): Promise<void> {
    const session = await prisma.callSession.findUnique({ where: { callId }, select: { status: true, calleeId: true, iceCandidates: true } });
    if (!session || session.status !== "RINGING" || targetUserId !== session.calleeId) return;
    if (!candidateJson || candidateJson.length > 20000) return;

    const candidates = parseCandidates(session.iceCandidates);
    candidates.push(candidateJson);
    // Cap the buffer at ~60 candidates (~2s of gathering) to stay well under push/DB limits.
    const trimmed = candidates.slice(-60);
    await prisma.callSession.update({ where: { callId }, data: { iceCandidates: JSON.stringify(trimmed) } });
  }
}

export const callSessionService = new CallSessionService();

const parseCandidates = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
};
