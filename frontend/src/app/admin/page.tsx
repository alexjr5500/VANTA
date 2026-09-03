'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  Users,
  UserCheck,
  Shield,
  Wallet,
  FileText,
  Video,
  Radio,
  Flag,
  Settings,
  TrendingUp,
  DollarSign,
  Loader2,
  Search,
  MoreHorizontal,
  Check,
  X,
  AlertTriangle,
  Ban,
  Eye,
  Clock,
  Calendar,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Activity,
  Server,
  Globe,
  Smartphone,
  Monitor,
  Database,
  UserPlus,
  Bell,
} from 'lucide-react';

// Admin tabs
const adminTabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'creators', label: 'Creators', icon: UserCheck },
  { id: 'verification', label: 'Verification', icon: Shield },
  { id: 'wallets', label: 'Wallets', icon: Wallet },
  { id: 'content', label: 'Content', icon: FileText },
  { id: 'streams', label: 'Streams', icon: Radio },
  { id: 'reports', label: 'Reports', icon: Flag },
  { id: 'moderation', label: 'Moderation', icon: Shield },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'settings', label: 'Settings', icon: Settings },
];

// Stat card
function StatCard({ icon: Icon, label, value, change, color }: {
  icon: any;
  label: string;
  value: string;
  change?: { value: string; positive: boolean };
  color: string;
}) {
  return (
    <div className="card-premium p-4">
      <div className="flex items-center justify-between mb-3">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', color)}>
          <Icon size={16} className="text-white" />
        </div>
        {change && (
          <span className={cn(
            'flex items-center gap-0.5 text-[10px] font-medium',
            change.positive ? 'text-emerald-400' : 'text-red-400'
          )}>
            {change.positive ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            {change.value}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-[10px] text-white/40 mt-1">{label}</p>
    </div>
  );
}

export default function AdminPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [statsData, usersData, reportsData] = await Promise.all([
        apiGet<any>('/api/admin/stats', token).catch(() => null),
        apiGet<any>('/api/admin/users', token).catch(() => ({ users: [] })),
        apiGet<any>('/api/admin/reports', token).catch(() => ({ reports: [] })),
      ]);
      setStats(statsData);
      setUsers(Array.isArray(usersData) ? usersData : usersData?.users ?? []);
      setReports(Array.isArray(reportsData) ? reportsData : reportsData?.reports ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load admin panel');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="skeleton h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-32 rounded-2xl" />)}
        </div>
        <div className="skeleton h-96 rounded-3xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <Loader2 size={24} className="text-red-400" />
        </div>
        <h2 className="text-lg font-medium text-white/60 mb-2">Failed to load admin panel</h2>
        <p className="text-sm text-white/30 mb-6">{error}</p>
        <button onClick={fetchData} className="btn-primary text-sm">Try Again</button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-7xl mx-auto space-y-6"
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d6a83f] to-[#c8c8cc] flex items-center justify-center shadow-lg shadow-[#d6a83f]/20">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
            <p className="text-sm text-white/40">Platform management and moderation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-full bg-emerald-500/10 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
            <Activity size={10} className="inline mr-1" />
            All Systems Active
          </span>
        </div>
      </motion.div>

      {/* Tab Bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex items-center gap-1 bg-white/[0.04] rounded-xl p-1 overflow-x-auto scrollbar-hide"
      >
        {adminTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[10px] font-medium transition-all whitespace-nowrap',
                isActive
                  ? 'bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white shadow-sm'
                  : 'text-gray-500 hover:text-white'
              )}
            >
              <Icon size={11} />
              {tab.label}
            </button>
          );
        })}
      </motion.div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-6"
        >
          {/* Stats Grid */}
          <div className="grid grid-cols-2   gap-4">
            <StatCard icon={Users} label="Total Users" value={(stats?.totalUsers ?? 0).toLocaleString()} change={{ value: '+8.2%', positive: true }} color="bg-[#c8c8cc]/10 border border-[#151517]0/20" />
            <StatCard icon={UserCheck} label="Creators" value={(stats?.totalCreators ?? 0).toLocaleString()} change={{ value: '+12.5%', positive: true }} color="bg-[#c8c8cc]/10 border border-[#151517]0/20" />
            <StatCard icon={Radio} label="Live Streams" value={(stats?.activeStreams ?? 0).toLocaleString()} change={{ value: '+5.1%', positive: true }} color="bg-red-500/10 border border-red-500/20" />
            <StatCard icon={Wallet} label="Total Volume" value={`$${(stats?.totalVolume ?? 0).toLocaleString()}`} change={{ value: '+15.3%', positive: true }} color="bg-emerald-500/10 border border-emerald-500/20" />
            <StatCard icon={Flag} label="Reports" value={(stats?.pendingReports ?? 0).toLocaleString()} change={{ value: '-3.2%', positive: true }} color="bg-amber-500/10 border border-amber-500/20" />
            <StatCard icon={Activity} label="Active Today" value={(stats?.activeToday ?? 0).toLocaleString()} color="bg-[#c8c8cc]/10 border border-[#151517]0/20" />
          </div>

          {/* Platform Health */}
          <div className="grid grid-cols-1  gap-6">
            <div className="card-premium p-6">
              <h3 className="text-base font-bold text-white mb-4">Platform Health</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <Server size={14} className="text-emerald-400" />
                    <span className="text-xs text-white/70">API Server</span>
                  </div>
                  <span className="text-[10px] text-emerald-400">99.9% uptime</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <Globe size={14} className="text-emerald-400" />
                    <span className="text-xs text-white/70">CDN</span>
                  </div>
                  <span className="text-[10px] text-emerald-400">Operational</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <Smartphone size={14} className="text-emerald-400" />
                    <span className="text-xs text-white/70">WebSocket</span>
                  </div>
                  <span className="text-[10px] text-emerald-400">Connected</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <Database size={14} className="text-emerald-400" />
                    <span className="text-xs text-white/70">Database</span>
                  </div>
                  <span className="text-[10px] text-emerald-400">Healthy</span>
                </div>
              </div>
            </div>

            <div className="card-premium p-6">
              <h3 className="text-base font-bold text-white mb-4">Recent Activity</h3>
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center">
                      {i % 2 === 0 ? <UserPlus size={12} className="text-emerald-400" /> : <Flag size={12} className="text-amber-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/70 truncate">
                        {i % 2 === 0 ? 'New user registered' : 'Content reported'}
                      </p>
                      <p className="text-[9px] text-white/30">{i}m ago</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card-premium p-6">
            <h3 className="text-base font-bold text-white mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2  gap-3">
              <button className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition text-left">
                <Users size={16} className="text-[#c8c8cc] mb-2" />
                <p className="text-xs font-medium text-white">Manage Users</p>
              </button>
              <button className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition text-left">
                <Flag size={16} className="text-amber-400 mb-2" />
                <p className="text-xs font-medium text-white">Review Reports</p>
              </button>
              <button className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition text-left">
                <Shield size={16} className="text-[#c8c8cc] mb-2" />
                <p className="text-xs font-medium text-white">Verification Queue</p>
              </button>
              <button className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition text-left">
                <Bell size={16} className="text-[#d6a83f] mb-2" />
                <p className="text-xs font-medium text-white">Send Announcement</p>
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search users..."
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 outline-none focus:border-[#d6a83f]/30 transition-all"
              />
            </div>
            <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-[10px] font-bold text-white">
              <UserPlus size={12} className="inline mr-1" />
              Add User
            </button>
          </div>

          {users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center card-premium">
              <Users size={36} className="text-white/10 mb-4" />
              <h3 className="text-white/50 font-medium text-base mb-1">No users found</h3>
              <p className="text-white/25 text-sm">User data will appear here</p>
            </div>
          ) : (
            <div className="card-premium overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left px-4 py-3 text-[10px] text-white/40 font-medium uppercase tracking-wider">User</th>
                      <th className="text-left px-4 py-3 text-[10px] text-white/40 font-medium uppercase tracking-wider">Role</th>
                      <th className="text-left px-4 py-3 text-[10px] text-white/40 font-medium uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-[10px] text-white/40 font-medium uppercase tracking-wider">Joined</th>
                      <th className="text-right px-4 py-3 text-[10px] text-white/40 font-medium uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.slice(0, 10).map((user: any, i: number) => (
                      <tr key={user.id || i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#d6a83f]/20 to-[#c8c8cc]/20 flex items-center justify-center">
                              <span className="text-xs font-bold text-white/60">
                                {(user.username || 'U').charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-white">{user.fullName || user.username}</p>
                              <p className="text-[10px] text-white/30">@{user.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'px-2 py-0.5 rounded-full text-[9px] font-medium',
                            user.role === 'admin' ? 'bg-[#c8c8cc]/10 text-[#c8c8cc] border border-[#151517]0/20' :
                            user.role === 'creator' ? 'bg-[#151517]0/10 text-[#f2c75c] border border-[#151517]0/20' :
                            'bg-white/[0.06] text-white/50'
                          )}>
                            {user.role || 'user'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'flex items-center gap-1 text-[10px]',
                            user.status === 'active' ? 'text-emerald-400' : 'text-red-400'
                          )}>
                            <span className={cn(
                              'w-1.5 h-1.5 rounded-full',
                              user.status === 'active' ? 'bg-emerald-400' : 'bg-red-400'
                            )} />
                            {user.status || 'active'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[10px] text-white/30">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/[0.05] transition">
                            <MoreHorizontal size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Pending Reports</h3>
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-[9px] font-bold text-amber-400 border border-amber-500/20">
              {reports.length} pending
            </span>
          </div>
          {reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center card-premium">
              <Flag size={36} className="text-white/10 mb-4" />
              <h3 className="text-white/50 font-medium text-base mb-1">No pending reports</h3>
              <p className="text-white/25 text-sm">All reports have been reviewed</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reports.map((report: any, i: number) => (
                <div key={report.id || i} className="card-premium p-4 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                    <AlertTriangle size={16} className="text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{report.reason || 'Report'}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">
                      Reported by @{report.reportedBy || 'unknown'} · {report.createdAt ? new Date(report.createdAt).toLocaleDateString() : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center hover:bg-emerald-500/20 transition">
                      <Check size={14} className="text-emerald-400" />
                    </button>
                    <button className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 transition">
                      <X size={14} className="text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Placeholder for other tabs */}
      {activeTab !== 'overview' && activeTab !== 'users' && activeTab !== 'reports' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col items-center justify-center py-24 text-center card-premium"
        >
          <BarChart3 size={48} className="text-white/10 mb-4" />
          <h3 className="text-lg font-bold text-white mb-1">
            {adminTabs.find(t => t.id === activeTab)?.label || 'Section'}
          </h3>
          <p className="text-sm text-white/30 max-w-sm">
            This section will display data from the backend API.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}

