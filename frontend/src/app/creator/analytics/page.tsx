"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Eye, Clock, Heart, MessageCircle, Share2, DollarSign, Activity } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { apiGet } from '@/lib/apiClient';

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { const d = await apiGet('/api/creator/analytics'); setData(d); }
      catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  return (
    <div className="w-full space-y-6">
      <GlassCard>
        <p className="text-sm text-gray-500">Analytics data will appear here once you have sufficient activity. Start creating content and streaming to see your metrics.</p>
      </GlassCard>
    </div>
  );
}