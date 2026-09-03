let ioRef: any = null;

export const setSocialEventsIO = (io: any) => {
  ioRef = io;
};

export const emitSocialEvent = (event: string, payload: Record<string, unknown>) => {
  ioRef?.emit(event, payload);
};

export const emitSocialEventToUser = (userId: string, event: string, payload: Record<string, unknown>) => {
  ioRef?.to(`user_${userId}`).emit(event, payload);
};

export const emitSocialEventToRoom = (room: string, event: string, payload: Record<string, unknown>) => {
  ioRef?.to(room).emit(event, payload);
};