"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Radio, Monitor, Play, Clock, Users, MessageCircle, Gift, Eye, Activity } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { apiGet } from '@/lib/apiClient';

export default function CreatorLivePage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { await apiGet('/api/creator/live/config'); } catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  return (
    <div className="w-full space-y-6">      <GlassCard>
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-gray-500">Live stream configuration available. Set up your stream to go live.</p>
        </div>
      </GlassCard>
    </div>
  );
}