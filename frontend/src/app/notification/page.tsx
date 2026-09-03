import { redirect } from 'next/navigation';

export default function LegacyNotificationPage() {
  redirect('/notifications');
}