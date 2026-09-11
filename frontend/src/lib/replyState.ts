/**
 * Conversation-scoped reply state.
 *
 * A reply ALWAYS belongs to the exact conversation where it was created, never to
 * the whole messaging application. This small, framework-free helper guarantees a
 * reply target can only ever be shown/submitted for its originating conversation.
 */

export interface ReplyState<TMessage> {
  conversationId: string;
  message: TMessage;
}

/** Scope a reply to the conversation it was created in. */
export function createReply<TMessage>(conversationId: string, message: TMessage): ReplyState<TMessage> {
  return { conversationId, message };
}

/**
 * Return the message only when the stored reply belongs to the currently active
 * conversation. Any other conversation (or no active conversation) yields null,
 * so a stale reply from another chat can never leak into the current one.
 */
export function activeReplyFor<TMessage>(
  reply: ReplyState<TMessage> | null,
  activeConversationId: string | null
): TMessage | null {
  if (!reply || !activeConversationId) return null;
  return reply.conversationId === activeConversationId ? reply.message : null;
}