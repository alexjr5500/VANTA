import { redirect } from 'next/navigation';

export default function ChatConversationPage({ params }: { params: { conversationId: string } }) {
  redirect(`/chat?conversation=${encodeURIComponent(params.conversationId)}`);
}