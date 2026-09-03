"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Hash, Image, Lightbulb, Languages, Shield, Copy, Check } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { apiGet } from '@/lib/apiClient';

export default function AIPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { const d = await apiGet('/api/creator/ai/tools'); setData(d); }
      catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  return (
    <div className="w-full space-y-6">

      <GlassCard>
        <div className="text-center py-8">
          <Sparkles size={32} className="mx-auto mb-3 text-[#d6a83f]" />
          <p className="text-sm text-gray-400">AI tools are being configured.</p>
          <p className="text-xs text-gray-600 mt-1">Generate content ideas and optimize your posts.</p>
        </div>
      </GlassCard>
    </div>
  );
}