// ============================================================================
// Realtime presence registry (in-process).
// ============================================================================
// Tracks which user has at least one live Socket.IO connection on THIS backend
// instance. The push service uses it to decide whether a user is "foreground"
// (their in-app realtime UI will surface the event, so a duplicate OS push is
// suppressed for ordinary notifications). Kept in its own module so both the
// socket layer and the push layer can use it without circular imports.

const connectedUsers = new Map<string, Set<string>>();

export const presenceRegistry = {
  addConnection(userId: string, socketId: string): number {
    const sockets = connectedUsers.get(userId) || new Set<string>();
    sockets.add(socketId);
    connectedUsers.set(userId, sockets);
    return sockets.size;
  },

  removeConnection(userId: string, socketId: string): number {
    const sockets = connectedUsers.get(userId);
    if (!sockets) return 0;
    sockets.delete(socketId);
    if (sockets.size === 0) connectedUsers.delete(userId);
    return sockets.size;
  },

  isConnected(userId: string): boolean {
    return connectedUsers.get(userId)?.size ? true : false;
  },

  hasTarget(userId: string): boolean {
    return connectedUsers.has(userId);
  },

  count(userId: string): number {
    return connectedUsers.get(userId)?.size ?? 0;
  },

  size(): number {
    return connectedUsers.size;
  },
};