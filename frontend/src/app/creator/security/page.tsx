"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Key, Smartphone, Laptop, Globe, Clock, CheckCircle, XCircle, Eye, EyeOff, AlertTriangle, RefreshCw } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { apiGet } from '@/lib/apiClient';

export default function SecurityPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try { const d = await apiGet('/api/creator/security'); setData(d); }
      catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const sec = data || {
    twoFactorEnabled: false, loginHistory: [], activeDevices: [],
    apiKeys: [], recoveryCodes: [], privacyControls: {
      showOnlineStatus: true, showActivityStatus: true, allowMessages: 'everyone',
      allowBrandDeals: true, allowCollaborations: true, dataShareForAnalytics: true,
    },
  };

  return (
    <div className="w-full space-y-6">
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-[#d6a83f]" />
            <h3 className="text-sm font-bold text-white">Two-Factor Authentication</h3>
          </div>
          {sec.twoFactorEnabled ? (
            <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/15 px-3 py-1 rounded-full"><CheckCircle size={12} /> Enabled</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-500 bg-white/10 px-3 py-1 rounded-full"><XCircle size={12} /> Disabled</span>
          )}
        </div>
        <p className="text-sm text-gray-400">Add an extra layer of security to your account.</p>
      </GlassCard>

      {sec.loginHistory?.length > 0 && (
        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-[#d6a83f]" />
            <h3 className="text-sm font-bold text-white">Login History</h3>
          </div>
          {sec.loginHistory.slice(0, 5).map((h: any) => (
            <div key={h.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
              <div><p className="text-sm text-white">{h.device}</p><p className="text-xs text-gray-500">{h.location} • {h.ip}</p></div>
              <span className="text-xs text-gray-500">{new Date(h.timestamp).toLocaleString()}</span>
            </div>
          ))}
        </GlassCard>
      )}

      {sec.activeDevices?.length > 0 && (
        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <Laptop size={16} className="text-[#d6a83f]" />
            <h3 className="text-sm font-bold text-white">Active Devices</h3>
          </div>
          {sec.activeDevices.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
              <div className="flex items-center gap-2">
                {d.device?.includes('Phone') || d.device?.includes('iPhone') ? <Smartphone size={14} className="text-gray-400" /> : <Laptop size={14} className="text-gray-400" />}
                <div><p className="text-sm text-white">{d.name}</p><p className="text-xs text-gray-500">{d.device}</p></div>
              </div>
              {d.isCurrent && <span className="text-[10px] text-green-400 bg-green-500/15 px-2 py-0.5 rounded-full">Current</span>}
            </div>
          ))}
        </GlassCard>
      )}
    </div>
  );
}