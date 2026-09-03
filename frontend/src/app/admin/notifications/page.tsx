"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Bell, Search, Plus, Send, Clock, CheckCircle, XCircle,
  Globe, UserCog, Wrench, Megaphone, Smartphone, Mail,
  MessageSquare, BarChart3, Filter, MoreHorizontal
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getNotificationCampaigns } from '@/lib/adminApi';
import type { NotificationCampaign } from '@/types/admin';

const typeConfig: Record<string, { label: string; icon: any; color: string }> = {
  maintenance: { label: 'Maintenance', icon: Wrench, color: 'bg-yellow-500/15 text-yellow-300' },
  promotional: { label: 'Promotional', icon: Megaphone, color: 'bg-[#151517]0/15 text-[#f2c75c]' },
  creator: { label: 'Creator Update', icon: UserCog, color: 'bg-[#c8c8cc]/15 text-[#c8c8cc]' },
  system: { label: 'System', icon: Globe, color: 'bg-[#c8c8cc]/15 text-[#c8c8cc]' },
  all: { label: 'All', icon: Globe, color: 'bg-gray-500/15 text-gray-300' },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/15 text-gray-400' },
  scheduled: { label: 'Scheduled', color: 'bg-[#c8c8cc]/15 text-[#c8c8cc]' },
  sending: { label: 'Sending', color: 'bg-yellow-500/15 text-yellow-400' },
  sent: { label: 'Sent', color: 'bg-green-500/15 text-green-400' },
  failed: { label: 'Failed', color: 'bg-red-500/15 text-red-400' },
};

export default function NotificationsPage() {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [campaigns, setCampaigns] = useState<NotificationCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const data = await getNotificationCampaigns(token);
        setCampaigns(data);
      } catch (err) {
        console.error('Failed to fetch notification campaigns:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = typeFilter === 'all' ? campaigns : campaigns.filter(n => n.type === typeFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bell size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Notifications</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Notification Campaigns</h1>
          <p className="text-sm text-gray-400 mt-1">Create and manage push, email, and in-app notification campaigns.</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />}>New Campaign</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {['all', 'maintenance', 'promotional', 'creator', 'system'].map(type => (
          <button key={type} onClick={() => setTypeFilter(type)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all whitespace-nowrap ${
              typeFilter === type
                ? 'bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white'
                : 'glass text-gray-400 hover:text-white border border-white/[0.06]'
            }`}>
            {type === 'all' ? <Globe size={12} /> : type === 'maintenance' ? <Wrench size={12} /> : type === 'promotional' ? <Megaphone size={12} /> : type === 'creator' ? <UserCog size={12} /> : <Globe size={12} />}
            {typeConfig[type]?.label || type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Campaigns */}
      <div className="space-y-3">
        {filtered.map((campaign, i) => (
          <motion.div key={campaign.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-[20px] p-5 border border-white/[0.06] hover:border-white/[0.12] transition-all">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${typeConfig[campaign.type]?.color || ''}`}>
                    {typeConfig[campaign.type]?.label || campaign.type}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusConfig[campaign.status]?.color || ''}`}>
                    {statusConfig[campaign.status]?.label || campaign.status}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-white">{campaign.title}</h3>
                <p className="text-xs text-gray-400 mt-1">{campaign.body}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {campaign.stats && (
                  <div className="text-right">
                    <p className="text-xs text-gray-500">{campaign.stats.delivered?.toLocaleString() || 0} delivered</p>
                    <p className="text-[10px] text-gray-600">{campaign.stats.opened?.toLocaleString() || 0} opened</p>
                  </div>
                )}
                <button className="p-2 rounded-xl hover:bg-white/10 transition-colors">
                  <MoreHorizontal size={14} className="text-gray-500" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500">
              <span className="flex items-center gap-1">
                {campaign.pushEnabled && <Smartphone size={10} />}
                {campaign.emailEnabled && <Mail size={10} />}
                {campaign.inAppEnabled && <MessageSquare size={10} />}
              </span>
              <span>Target: {campaign.targetAudience?.join(', ') || 'All'}</span>
              {campaign.scheduledFor && (
                <span className="flex items-center gap-1"><Clock size={10} />{new Date(campaign.scheduledFor).toLocaleString()}</span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}