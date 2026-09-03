"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bell, Heart, Gift, UserPlus, MessageCircle, Radio, Check, X } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { apiGet } from '@/lib/apiClient';

export default function CreatorNotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { const d: any = await apiGet('/api/creator/notifications'); setNotifications(d?.recentNotifications || d || []); }
      catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  return (
    <div className="w-full space-y-6">
      {notifications.length > 0 ? notifications.map((n: any, i: number) => (
        <motion.div key={n.id || i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className={`glass rounded-[20px] p-4 border ${n.isRead ? 'border-white/[0.06]' : 'border-[#151517]0/20 bg-[#151517]0/[0.02]'}`}>
          <div className="flex items-center gap-3">
            <div className="text-sm text-white">{n.message || n.body}</div>
          </div>
        </motion.div>
      )) : (
        <GlassCard>
          <div className="text-center py-8">
            <Bell size={32} className="mx-auto mb-3 text-gray-500" />
            <p className="text-sm text-gray-400">No notifications yet.</p>
          </div>
        </GlassCard>
      )}
    </div>
  );
}