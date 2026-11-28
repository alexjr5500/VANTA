'use client';
import { useEffect, useState } from 'react';

const KEY = 'vanta_chat_data_saver';
const EVENT = 'vanta-chat-data-saver';
export function readChatDataSaver(): boolean {
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
}
export function writeChatDataSaver(enabled: boolean) {
  localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new Event(EVENT));
}
export function useChatDataSaver() {
  // Until hydration, avoid eager loading media.
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const refresh = () => setEnabled(readChatDataSaver());
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(EVENT, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  return enabled;
}
