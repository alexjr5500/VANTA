/**
 * A double tick in VANTA means a recipient has genuinely read the message.
 * Data returned to the sender has already had privacy-disabled read receipts
 * removed by the backend. Never infer reading from delivery or send success.
 */
export interface ReceiptSource {
  reads?: ReadonlyArray<{ userId?: string | null }> | null;
  read?: unknown;
  isRead?: unknown;
}

export function hasVisibleReadReceipt(source: ReceiptSource, currentUserId?: string): boolean {
  // Prefer server-filtered receipt rows over any loose legacy "read" field.
  if (Array.isArray(source.reads)) {
    if (!currentUserId) return false;
    return source.reads.some(receipt =>
      typeof receipt.userId === 'string' &&
      receipt.userId.length > 0 &&
      receipt.userId !== currentUserId
    );
  }
  return source.read === true || source.isRead === true;
}

export interface OutgoingMessageStatus {
  isOwn: boolean;
  pending?: boolean;
  failed?: boolean;
  read?: boolean;
}

export type OutgoingReceiptState = 'none' | 'pending' | 'failed' | 'sent' | 'read';

export function outgoingReceiptState(message: OutgoingMessageStatus): OutgoingReceiptState {
  if (!message.isOwn) return 'none';
  if (message.failed) return 'failed';
  if (message.pending) return 'pending';
  return message.read === true ? 'read' : 'sent';
}

export function shouldRefreshReadReceipts(
  event: { conversationId?: string; readerId?: string } | null | undefined,
  activeConversationId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  return Boolean(
    activeConversationId &&
    currentUserId &&
    event?.conversationId === activeConversationId &&
    event?.readerId &&
    event.readerId !== currentUserId
  );
}
