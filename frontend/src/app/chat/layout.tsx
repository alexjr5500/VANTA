import type { Metadata } from 'next';
import ChatPasscodeGate from '@/components/messages/ChatPasscodeGate';

export const metadata: Metadata = {
  title: { absolute: 'Chat | VANTA' },
  description: 'Talk to anyone. Build something together on VANTA.',
};

export default function ChatLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ChatPasscodeGate>{children}</ChatPasscodeGate>;
}