// ============================================================================
// CallSessionService unit tests — server-side call state, race safety and
// cold-start answer authorization.
// ============================================================================

import { CallSessionService } from "../services/call-session.service";
import { prisma } from "../prisma";

jest.mock("../prisma", () => ({
  prisma: {
    callSession: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const service = new CallSessionService();

const ring = (overrides: Record<string, unknown> = {}) => ({
  id: "cs1",
  callId: "call-1",
  conversationId: "conv-1",
  callerId: "alice",
  calleeId: "bob",
  type: "VOICE",
  status: "RINGING",
  offerSdp: "v=0...offer",
  iceCandidates: JSON.stringify(['{"candidate":"cand1"}']),
  answeredBy: null,
  answeredAt: null,
  endedBy: null,
  endedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});

describe("CallSessionService", () => {
  beforeEach(() => jest.clearAllMocks());

  test("startCall persists a RINGING session with an expiry", async () => {
    (prisma.callSession.upsert as jest.Mock).mockResolvedValue(ring());
    const session = await service.startCall({
      callId: "call-1",
      conversationId: "conv-1",
      callerId: "alice",
      calleeId: "bob",
      type: "voice",
      offerSdp: "v=0...offer",
    });
    expect(session.status).toBe("RINGING");
    const options = (prisma.callSession.upsert as jest.Mock).mock.calls[0][0];
    expect(options.create.calleeId).toBe("bob");
    expect(options.create.offerSdp).toBe("v=0...offer");
  });

  test("getCallForAnswer authorizes only the callee", async () => {
    (prisma.callSession.findUnique as jest.Mock).mockResolvedValue(ring());
    const forbidden = await service.getCallForAnswer("call-1", "mallory");
    expect(forbidden.ok).toBe(false);
    expect(forbidden.reason).toBe("FORBIDDEN");

    const allowed = await service.getCallForAnswer("call-1", "bob");
    expect(allowed.ok).toBe(true);
    expect(allowed.session.offerSdp).toBe("v=0...offer");
    expect(allowed.session.iceCandidates).toEqual(['{"candidate":"cand1"}']);
  });

  test("getCallForAnswer fails gracefully for expired calls (no ghost calls)", async () => {
    (prisma.callSession.findUnique as jest.Mock).mockResolvedValue(
      ring({ status: "RINGING", expiresAt: new Date(Date.now() - 1000) })
    );
    (prisma.callSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const result = await service.getCallForAnswer("call-1", "bob");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("CALL_EXPIRED");
    expect(prisma.callSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXPIRED" } })
    );
  });

  test("transition is atomic: only a RINGING call can be answered", async () => {
    (prisma.callSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.callSession.findUnique as jest.Mock).mockResolvedValue(ring({ status: "ANSWERED", answeredBy: "bob" }));

    const first = await service.transition("call-1", ["RINGING"], "ANSWERED", { answeredBy: "bob" });
    expect(first.changed).toBe(true);

    // Second device races: the row is no longer RINGING, so nothing changes.
    (prisma.callSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const second = await service.transition("call-1", ["RINGING"], "ANSWERED", { answeredBy: "bob" });
    expect(second.changed).toBe(false);
  });

  test("bufferCallerCandidate only while RINGING and only for the callee", async () => {
    (prisma.callSession.findUnique as jest.Mock).mockResolvedValue(ring());
    await service.bufferCallerCandidate("call-1", "bob", '{"candidate":"cand2"}');
    expect(prisma.callSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { iceCandidates: expect.any(String) } })
    );

    (prisma.callSession.update as jest.Mock).mockClear();
    (prisma.callSession.findUnique as jest.Mock).mockResolvedValue(ring({ status: "ANSWERED" }));
    await service.bufferCallerCandidate("call-1", "bob", '{"candidate":"cand3"}');
    expect(prisma.callSession.update).not.toHaveBeenCalled();
  });
});