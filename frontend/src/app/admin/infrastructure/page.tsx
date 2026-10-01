"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Server, Database, Clock, Activity,
  Globe, RefreshCw, CheckCircle, AlertTriangle, XCircle,
  Cpu, Network
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { getInfrastructure } from '@/lib/adminApi';
import type { ServerInfrastructure } from '@/types/admin';

const statusDot: Record<string, string> = {
  healthy: 'bg-green-400',
  degraded: 'bg-yellow-400',
  down: 'bg-red-400',
};

const statusBadge: Record<string, string> = {
  healthy: 'bg-green-500/15 text-green-400 border-green-500/20',
  degraded: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  down: 'bg-red-500/15 text-red-400 border-red-500/20',
};

export default function InfrastructurePage() {
  const [infra, setInfra] = useState<ServerInfrastructure | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
        if (!token) return;
        const data = await getInfrastructure(token);
        setInfra(data);
      } catch (err) {
        console.error('Failed to fetch infrastructure:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading || !infra) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#151517]0 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-400">Loading infrastructure...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Server size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Infrastructure</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Server Infrastructure</h1>
          <p className="text-sm text-gray-400 mt-1">Real-time monitoring of servers, services, and global regions. Uptime: {infra.uptime}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 bg-white/5 px-3 py-1.5 rounded-full">
            <RefreshCw size={12} /> Auto-refresh
          </span>
        </div>
      </div>

      {/* Resource Usage Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'CPU Load', value: `${infra.cpu.usage}%`, icon: Cpu, color: 'from-[#d9a83f] to-[#b78929]', detail: `${infra.cpu.cores} cores` },
          { label: 'Memory', value: `${infra.memory.percentage}%`, icon: Database, color: 'from-[#c8c8cc] to-[#68686c]', detail: `${infra.memory.used}GB / ${infra.memory.total}GB` },
          { label: 'Network Interfaces', value: String(infra.network.incoming), icon: Network, color: 'from-emerald-500 to-emerald-600', detail: 'active NICs' },
        ].map((res, i) => (
          <motion.div key={res.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-2xl p-5 border border-white/[0.06]">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${res.color}`}>
                <res.icon size={18} className="text-white" />
              </div>
              <span className="text-xs text-gray-500">{res.detail}</span>
            </div>
            <p className="text-2xl font-bold text-white">{res.value}</p>
            <p className="text-xs text-gray-400 mt-1">{res.label}</p>
            <div className="mt-2 w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[#d9a83f] to-[#b78929] transition-all duration-500"
                style={{ width: `${res.label === 'CPU Load' ? infra.cpu.usage : res.label === 'Memory' ? infra.memory.percentage : 100}%` }} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Runtime */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Uptime', value: infra.uptime },
          { label: 'Overall Health', value: infra.overallHealth || 'healthy' },
          { label: 'Node', value: infra.nodeVersion || '—' },
          { label: 'Platform', value: infra.platform || '—' },
        ].map((info) => (
          <div key={info.label} className="glass rounded-2xl border border-white/[0.06] p-4">
            <p className="text-lg font-bold text-white capitalize">{info.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{info.label}</p>
          </div>
        ))}
      </div>

      {/* Services */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-[#d6a83f]" />
            <h3 className="text-sm font-bold text-white">Services</h3>
          </div>
          <span className="text-xs text-gray-500">{infra.services.filter(s => s.status === 'healthy').length}/{infra.services.length} healthy</span>
        </div>
        <div className="grid grid-cols-1   gap-2">
          {infra.services.map(service => (
            <div key={service.name} className="flex items-center justify-between glass rounded-2xl p-3">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${statusDot[service.status] || 'bg-gray-500'}`} />
                <span className="text-xs text-gray-300">{service.name}</span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusBadge[service.status] || 'bg-gray-500/15 text-gray-400'}`}>
                {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
              </span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Global Regions */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Globe size={16} className="text-[#d6a83f]" />
          <h3 className="text-sm font-bold text-white">Global Regions</h3>
        </div>
        <div className="grid grid-cols-1   gap-2">
          {infra.regions.map(region => (
            <div key={region.name} className="flex items-center justify-between glass rounded-2xl p-3">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${statusDot[region.status] || 'bg-gray-500'}`} />
                <span className="text-xs text-gray-300">{region.name}</span>
              </div>
              <span className="text-xs text-gray-500">{region.latency}ms</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}