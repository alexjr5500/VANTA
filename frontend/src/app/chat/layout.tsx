import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Chat | VANTA' },
  description: 'Talk to anyone. Build something together on VANTA.',
};

export default function ChatLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}