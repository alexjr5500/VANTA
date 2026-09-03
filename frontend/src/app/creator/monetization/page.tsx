"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Gift, Crown, Shield, CheckCircle, XCircle, CreditCard, Download, FileText } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { apiGet } from '@/lib/apiClient';

export default function MonetizationPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { const d = await apiGet('/api/creator/monetization'); setData(d); }
      catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const m = data || { giftsEnabled: false, subscriptionsEnabled: false, adsEnabled: false, vantaCoinBalance: 0, pendingWithdrawal: 0, totalWithdrawn: 0, availableForWithdrawal: 0, taxDocuments: [] };

  return (
    <div className="w-full space-y-6">
      <div className="grid grid-cols-1  gap-3">
        {[
          { label: 'Gifts', enabled: m.giftsEnabled },
          { label: 'Subscriptions', enabled: m.subscriptionsEnabled },
          { label: 'Ads', enabled: m.adsEnabled },
        ].map(item => (
          <GlassCard key={item.label}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white">{item.label}</span>
              {item.enabled ? <CheckCircle size={16} className="text-green-400" /> : <XCircle size={16} className="text-gray-500" />}
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <CreditCard size={16} className="text-[#d6a83f]" />
          <h3 className="text-sm font-bold text-white">Balance</h3>
        </div>
        <div className="grid grid-cols-2  gap-4">
          <div><p className="text-[10px] text-gray-500">VANTA Balance</p><p className="text-lg font-bold text-white">{(m.vantaCoinBalance ?? 0).toLocaleString()}</p></div>
          <div><p className="text-[10px] text-gray-500">Available</p><p className="text-lg font-bold text-green-400">${m.availableForWithdrawal?.toFixed(2)}</p></div>
          <div><p className="text-[10px] text-gray-500">Pending</p><p className="text-lg font-bold text-yellow-400">${m.pendingWithdrawal?.toFixed(2)}</p></div>
          <div><p className="text-[10px] text-gray-500">Total Withdrawn</p><p className="text-lg font-bold text-[#c8c8cc]">${m.totalWithdrawn?.toFixed(2)}</p></div>
        </div>
      </GlassCard>
    </div>
  );
}