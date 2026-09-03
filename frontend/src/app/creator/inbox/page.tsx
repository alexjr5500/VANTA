"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Briefcase, HandshakeIcon, Tag, Ticket, Heart, Search, Check, X, Clock, AlertCircle, ArrowUpRight } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { apiGet } from '@/lib/apiClient';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-300', accepted: 'bg-green-500/15 text-green-300',
  declined: 'bg-red-500/15 text-red-300', negotiating: 'bg-[#c8c8cc]/15 text-[#c8c8cc]',
  active: 'bg-green-500/15 text-green-300', completed: 'bg-[#c8c8cc]/15 text-[#c8c8cc]',
  cancelled: 'bg-gray-500/15 text-gray-400',
  open: 'bg-yellow-500/15 text-yellow-300', in_progress: 'bg-[#c8c8cc]/15 text-[#c8c8cc]',
  resolved: 'bg-green-500/15 text-green-300', closed: 'bg-gray-500/15 text-gray-400',
};

const priorityColors: Record<string, string> = {
  low: 'bg-gray-500/15 text-gray-400', medium: 'bg-yellow-500/15 text-yellow-300', high: 'bg-red-500/15 text-red-300',
};

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState('messages');
  const [inbox, setInbox] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { const d = await apiGet('/api/creator/inbox'); setInbox(d); }
      catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const defaultInbox = { messages: [], businessRequests: [], collaborations: [], brandDeals: [], supportTickets: [], fanMail: [] };
  const inboxData = inbox || defaultInbox;

  const tabs = [
    { key: 'messages', label: 'Chat', icon: MessageCircle, count: inboxData.messages.filter((m: any) => !m.isRead).length },
    { key: 'business', label: 'Business', icon: Briefcase, count: inboxData.businessRequests.filter((r: any) => r.status === 'pending').length },
    { key: 'collabs', label: 'Collabs', icon: HandshakeIcon, count: inboxData.collaborations.filter((c: any) => c.status === 'pending').length },
    { key: 'deals', label: 'Brand Deals', icon: Tag },
    { key: 'tickets', label: 'Support', icon: Ticket, count: inboxData.supportTickets.filter((t: any) => t.status !== 'resolved' && t.status !== 'closed').length },
    { key: 'fanmail', label: 'Fan Mail', icon: Heart, count: inboxData.fanMail.filter((m: any) => !m.isRead).length },
  ];

  return (
    <div className="w-full space-y-6"><div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all whitespace-nowrap ${activeTab === tab.key ? 'bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white' : 'glass text-gray-400 hover:text-white border border-white/[0.06]'}`}>
            <tab.icon size={12} />
            {tab.label}
            {tab.count > 0 && <span className="bg-white/20 text-white text-[9px] px-1.5 py-0.5 rounded-full">{tab.count}</span>}
          </button>
        ))}
      </div>

      <GlassCard>
        <div className="text-center py-12">
          <MessageCircle size={32} className="mx-auto mb-3 text-gray-500" />
          <p className="text-sm text-gray-400">No {activeTab} yet.</p>
          <p className="text-xs text-gray-600 mt-1">Items will appear here as you receive them.</p>
        </div>
      </GlassCard>
    </div>
  );
}