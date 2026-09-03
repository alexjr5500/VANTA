import { redirect } from 'next/navigation';

export default function LegacyConversationPage({
  params,
}: {
  params: { conversationId: string };
}) {
  redirect(`/chat/${encodeURIComponent(params.conversationId)}`);
}
