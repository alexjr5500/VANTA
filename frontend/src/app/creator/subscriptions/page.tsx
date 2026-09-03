"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Crown, Users, TrendingUp, DollarSign, Check } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { apiGet } from '@/lib/apiClient';

export default function SubscriptionsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { const d = await apiGet('/api/creator/subscriptions'); setData(d); }
      catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  return (
    <div className="w-full space-y-6">      <GlassCard>
        <p className="text-sm text-gray-500">Subscription data will appear here. Create your first subscription tier to start.</p>
      </GlassCard>
    </div>
  );
}