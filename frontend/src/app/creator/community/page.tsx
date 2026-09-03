"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, UserCheck, UserPlus, Building2, Hash, Shield, Ban, Star } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { apiGet } from '@/lib/apiClient';

export default function CommunityPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { const d = await apiGet('/api/creator/community'); setStats(d); }
      catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const s = stats || { followers: 0, subscribers: 0, communities: 0, channels: 0, groups: 0, moderators: 0, blockedUsers: 0, vipMembers: 0 };

  return (
    <div className="w-full space-y-6">

      <div className="grid grid-cols-2  gap-3">
        {[
          { label: 'Followers', value: s.followers, icon: UserCheck, color: 'from-[#d6a83f] to-[#b78929]' },
          { label: 'Subscribers', value: s.subscribers, icon: UserPlus, color: 'from-[#151517]0 to-[#68686c]' },
          { label: 'Communities', value: s.communities, icon: Building2, color: 'from-[#151517]0 to-[#68686c]' },
          { label: 'Channels', value: s.channels, icon: Hash, color: 'from-green-500 to-emerald-600' },
        ].map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-[20px] p-4 border border-white/[0.06]">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br ${card.color} mb-2`}>
              <card.icon size={16} className="text-white" />
            </div>
            <p className="text-xl font-bold text-white">{card.value.toLocaleString()}</p>
            <p className="text-xs text-gray-400">{card.label}</p>
          </motion.div>
        ))}
      </div>

      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-[#d6a83f]" />
          <h3 className="text-sm font-bold text-white">Moderation</h3>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Moderators', value: s.moderators, icon: Shield, color: 'text-[#c8c8cc]' },
            { label: 'Blocked Users', value: s.blockedUsers, icon: Ban, color: 'text-red-400' },
            { label: 'VIP Members', value: s.vipMembers, icon: Star, color: 'text-yellow-400' },
          ].map(item => (
            <div key={item.label} className="glass rounded-2xl p-4 text-center">
              <item.icon size={20} className={`mx-auto mb-2 ${item.color}`} />
              <p className="text-lg font-bold text-white">{item.value}</p>
              <p className="text-[10px] text-gray-500">{item.label}</p>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}