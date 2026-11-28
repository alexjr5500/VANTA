import type { Server } from 'socket.io';

export type PresenceObservation = 'online' | 'offline' | 'unknown';

/** Best-effort cluster snapshot. A dependency failure is not evidence of absence. */
export async function observeRoomPresence(
  io: Pick<Server, 'in'>,
  userId: string,
  adapterReady: () => boolean,
  localCount: () => number,
): Promise<PresenceObservation> {
  if (localCount() > 0) return 'online';
  try {
    if (!adapterReady()) return 'unknown';
    const sockets = await io.in('user_' + userId).fetchSockets();
    if (localCount() > 0 || sockets.length > 0) return 'online';
    return adapterReady() ? 'offline' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Serialize a user's local presence transitions without retaining idle keys. */
export class PresenceTransitions {
  private readonly pending = new Map<string, Promise<void>>();
  run(userId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.pending.set(userId, current);
    const cleanup = () => {
      if (this.pending.get(userId) === current) this.pending.delete(userId);
    };
    void current.then(cleanup, cleanup);
    return current;
  }
}
