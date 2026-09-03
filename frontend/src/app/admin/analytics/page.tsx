"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, BarChart3, Users, DollarSign, Activity, Target,
  ChevronDown, Download, Globe, Monitor, Clock, Zap,
  TrendingDown, UserPlus, Gift, MessageCircle, Eye,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import {
  AnalyticsChart, MetricCard, FunnelChart, CohortTable, ProgressBar
} from '@/components/analytics/AnalyticsChart';
import {
  useExecutiveDashboard, useRealtimeMetrics, useRevenueDashboard,
  useGrowthDashboard, useOperationsDashboard, useCreatorDashboard,
  useProductDashboard, useFunnel, useCohorts, useTopContent,
  useTrafficSources, usePredictions, useAutoRefresh,
  formatNumber, formatCurrency, formatPercentage,
} from '@/lib/hooks/useAnalytics';

type TabType = 'executive' | 'revenue' | 'growth' | 'product' | 'operations' | 'creator' | 'content' | 'traffic';

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('executive');
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');

  // Real-time metrics
  const realtime = useRealtimeMetrics();

  // Dashboard data
  const executive = useExecutiveDashboard();
  const revenue = useRevenueDashboard();
  const growth = useGrowthDashboard();
  const operations = useOperationsDashboard();
  const creator = useCreatorDashboard();
  const product = useProductDashboard();
  const funnel = useFunnel([
    { name: 'Visitors', eventPattern: 'page.visit' },
    { name: 'Registrations', eventPattern: 'user.register' },
    { name: 'Content Created', eventPattern: 'content.created' },
    { name: 'Engaged', eventPattern: 'reaction.like' },
  ]);
  const cohorts = useCohorts('month', 8);
  const topContent = useTopContent('reaction.like', 'weekly', 10);
  const trafficSources = useTrafficSources('weekly');
  const dauPredictions = usePredictions('dau', 'monthly');

  // Auto-refresh critical data
  useAutoRefresh(executive.refresh, 60000);
  
  // Subscribe to realtime WebSocket updates
  useEffect(() => {
    const unsub = realtime.subscribe();
    return () => unsub();
  }, [realtime.subscribe]);

  const tabs: { key: TabType; label: string; icon: any }[] = [
    { key: 'executive', label: 'Executive', icon: BarChart3 },
    { key: 'revenue', label: 'Revenue', icon: DollarSign },
    { key: 'growth', label: 'Growth', icon: TrendingUp },
    { key: 'product', label: 'Product', icon: Target },
    { key: 'operations', label: 'Operations', icon: Activity },
    { key: 'creator', label: 'Creator', icon: Users },
    { key: 'content', label: 'Content', icon: Eye },
    { key: 'traffic', label: 'Traffic', icon: Globe },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Analytics</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Analytics & Business Intelligence</h1>
          <p className="text-sm text-gray-400 mt-1">Real-time platform analytics and growth metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <div className={`w-2 h-2 rounded-full ${realtime.metrics ? 'bg-green-400' : 'bg-gray-600'}`} />
            {realtime.metrics ? 'Live' : 'Offline'}
          </div>
          <Button variant="ghost" size="sm" icon={<Download size={14} />}
            onClick={() => {
              const data = executive.data || revenue.data || growth.data;
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `analytics-${new Date().toISOString().slice(0, 10)}.json`;
              a.click(); URL.revokeObjectURL(url);
            }}>
            Export
          </Button>
        </div>
      </div>

      {/* Real-time Bar */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={14} className="text-yellow-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Real-Time Activity</h3>
        </div>
        <div className="grid grid-cols-4  gap-3">
          {[
            { label: 'Active Users', value: formatNumber(realtime.metrics?.activeUsers || 0), icon: Users, color: 'text-[#c8c8cc]' },
            { label: 'Active Streams', value: formatNumber(realtime.metrics?.activeStreams || 0), icon: Eye, color: 'text-[#d6a83f]' },
            { label: 'New Today', value: formatNumber(realtime.metrics?.newRegistrationsToday || 0), icon: UserPlus, color: 'text-green-400' },
            { label: 'Revenue Today', value: formatCurrency(realtime.metrics?.revenueToday || 0), icon: DollarSign, color: 'text-yellow-400' },
            { label: 'Gifts Today', value: formatNumber(realtime.metrics?.giftsToday || 0), icon: Gift, color: 'text-[#c8c8cc]' },
            { label: 'Messages/s', value: formatNumber(realtime.metrics?.messagesPerSecond || 0), icon: MessageCircle, color: 'text-[#c8c8cc]' },
            { label: 'Reactions', value: formatNumber(realtime.metrics?.reactionsToday || 0), icon: TrendingUp, color: 'text-orange-400' },
            { label: 'Viewers', value: formatNumber(realtime.metrics?.totalConcurrentViewers || 0), icon: Users, color: 'text-indigo-400' },
          ].map((item, i) => (
            <div key={i} className="text-center">
              <div className={`text-lg font-bold ${item.color}`}>{item.value}</div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Tab Navigation */}
      <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === tab.key
                ? 'bg-[#151517]0/20 text-[#f2c75c] border border-[#151517]0/30'
                : 'bg-white/5 text-gray-400 hover:text-gray-300 border border-transparent'
            }`}>
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ======================== EXECUTIVE DASHBOARD ======================== */}
      {activeTab === 'executive' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2  gap-3">
            <MetricCard label="Daily Active Users" value={formatNumber(executive.data?.kpis.dau || 0)} icon={<Users size={18} className="text-white" />} color="from-[#151517]0 to-[#68686c]" loading={executive.loading} />
            <MetricCard label="Weekly Active Users" value={formatNumber(executive.data?.kpis.wau || 0)} icon={<Users size={18} className="text-white" />} color="from-green-500 to-emerald-600" loading={executive.loading} />
            <MetricCard label="Monthly Active Users" value={formatNumber(executive.data?.kpis.mau || 0)} icon={<Users size={18} className="text-white" />} color="from-[#151517]0 to-[#b78929]" loading={executive.loading} />
            <MetricCard label="Platform Revenue" value={formatCurrency(executive.data?.kpis.revenue || 0)} icon={<DollarSign size={18} className="text-white" />} color="from-yellow-500 to-amber-600" loading={executive.loading} />
          </div>
          <div className="grid grid-cols-2  gap-3">
            <MetricCard label="New Users (Today)" value={formatNumber(executive.data?.kpis.newUsers || 0)} icon={<UserPlus size={18} className="text-white" />} color="from-teal-500 to-[#68686c]" loading={executive.loading} />
            <MetricCard label="Retention Rate" value={formatPercentage(executive.data?.kpis.retention || 0)} icon={<Target size={18} className="text-white" />} color="from-[#8a8a8a] to-[#c8c8cc]" loading={executive.loading} />
            <MetricCard label="Active Streams" value={formatNumber(realtime.metrics?.activeStreams || 0)} icon={<Eye size={18} className="text-white" />} color="from-[#d6a83f] to-[#b78929]" loading={realtime.loading} />
            <MetricCard label="Concurrent Viewers" value={formatNumber(realtime.metrics?.totalConcurrentViewers || 0)} icon={<Users size={18} className="text-white" />} color="from-orange-500 to-red-600" loading={realtime.loading} />
          </div>

          {/* Trends */}
          <div className="grid grid-cols-1  gap-6">
            <AnalyticsChart title="DAU Trend" data={executive.data?.trends.dau || []} icon={<Activity size={16} />} gradient="from-[#151517]0 to-[#68686c]" loading={executive.loading} />
            <AnalyticsChart title="MAU Trend" data={executive.data?.trends.mau || []} icon={<Users size={16} />} gradient="from-[#151517]0 to-[#b78929]" loading={executive.loading} />
          </div>
          <div className="grid grid-cols-1  gap-6">
            <AnalyticsChart title="Revenue Trend" data={executive.data?.trends.revenue || []} icon={<DollarSign size={16} />} gradient="from-green-500 to-emerald-600" loading={executive.loading} prefix="$" />
            <AnalyticsChart title="New Users" data={executive.data?.trends.newUsers || []} icon={<UserPlus size={16} />} gradient="from-teal-500 to-[#68686c]" loading={executive.loading} />
          </div>

          {/* Predictions */}
          {dauPredictions.data && (
            <AnalyticsChart
              title={`DAU Forecast (${dauPredictions.data.metadata?.trend || 'stable'}) - ${dauPredictions.data.confidence}% confidence`}
              data={dauPredictions.data.predictions || []}
              icon={<TrendingUp size={16} />}
              gradient="from-yellow-500 to-amber-600"
              type="line"
            />
          )}
        </div>
      )}

      {/* ======================== REVENUE DASHBOARD ======================== */}
      {activeTab === 'revenue' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2  gap-3">
            <MetricCard label="Total Revenue" value={formatCurrency(revenue.data?.summary.totalRevenue || 0)} icon={<DollarSign size={18} className="text-white" />} color="from-yellow-500 to-amber-600" loading={revenue.loading} />
            <MetricCard label="ARPU" value={formatCurrency(revenue.data?.summary.arpu || 0)} icon={<Users size={18} className="text-white" />} color="from-[#151517]0 to-[#68686c]" loading={revenue.loading} />
            <MetricCard label="Purchases" value={formatNumber(revenue.data?.summary.coinPurchases || 0)} icon={<DollarSign size={18} className="text-white" />} color="from-green-500 to-emerald-600" loading={revenue.loading} />
            <MetricCard label="Payment Success" value={formatPercentage(revenue.data?.summary.paymentSuccessRate || 0)} icon={<Activity size={18} className="text-white" />} color="from-[#151517]0 to-[#b78929]" loading={revenue.loading} />
          </div>
          <AnalyticsChart title="Revenue by Day" data={revenue.data?.revenueByDay || []} icon={<DollarSign size={16} />} gradient="from-green-500 to-emerald-600" prefix="$" loading={revenue.loading} />
          {revenue.data?.predictions && (
            <AnalyticsChart
              title={`Revenue Forecast (${revenue.data.predictions.metadata?.trend || 'stable'})`}
              data={revenue.data.predictions.predictions || []}
              icon={<TrendingUp size={16} />}
              gradient="from-yellow-500 to-amber-600"
              type="line"
            />
          )}
        </div>
      )}

      {/* ======================== GROWTH DASHBOARD ======================== */}
      {activeTab === 'growth' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2  gap-3">
            <MetricCard label="Growth Rate" value={formatPercentage(growth.data?.kpis.growthRate || 0)} icon={<TrendingUp size={18} className="text-white" />} color="from-green-500 to-emerald-600" loading={growth.loading} />
            <MetricCard label="Churn Rate" value={formatPercentage(growth.data?.kpis.churnRate || 0)} icon={<TrendingDown size={18} className="text-white" />} color="from-red-500 to-[#b78929]" loading={growth.loading} />
            <MetricCard label="Retention" value={formatPercentage(growth.data?.kpis.retentionRate || 0)} icon={<Target size={18} className="text-white" />} color="from-[#151517]0 to-[#68686c]" loading={growth.loading} />
            <MetricCard label="Total Users" value={formatNumber(growth.data?.kpis.totalUsers || 0)} icon={<Users size={18} className="text-white" />} color="from-[#151517]0 to-[#b78929]" loading={growth.loading} />
          </div>
          <div className="grid grid-cols-1  gap-6">
            <AnalyticsChart title="DAU" data={growth.data?.dau || []} icon={<Activity size={16} />} gradient="from-[#151517]0 to-[#68686c]" loading={growth.loading} />
            <AnalyticsChart title="New Users" data={growth.data?.newUsers || []} icon={<UserPlus size={16} />} gradient="from-green-500 to-emerald-600" loading={growth.loading} />
          </div>
          <CohortTable cohorts={(cohorts.data || []) as any} loading={cohorts.loading} />
        </div>
      )}

      {/* ======================== PRODUCT DASHBOARD ======================== */}
      {activeTab === 'product' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2  gap-3">
            <MetricCard label="Engagement Rate" value={formatPercentage(product.data?.engagementRate || 0)} icon={<Activity size={18} className="text-white" />} color="from-[#d6a83f] to-[#b78929]" loading={product.loading} />
            <MetricCard label="Posts" value={formatNumber(product.data?.contentBreakdown.posts || 0)} icon={<Eye size={18} className="text-white" />} color="from-[#151517]0 to-[#68686c]" loading={product.loading} />
            <MetricCard label="Videos" value={formatNumber(product.data?.contentBreakdown.videos || 0)} icon={<Eye size={18} className="text-white" />} color="from-[#151517]0 to-[#b78929]" loading={product.loading} />
            <MetricCard label="Live Streams" value={formatNumber(product.data?.contentBreakdown.liveStreams || 0)} icon={<Eye size={18} className="text-white" />} color="from-green-500 to-emerald-600" loading={product.loading} />
          </div>
          <AnalyticsChart title="Session Duration" data={product.data?.sessionDuration || []} icon={<Clock size={16} />} gradient="from-[#151517]0 to-[#68686c]" suffix=" min" loading={product.loading} />
          <FunnelChart steps={(funnel.data || []) as any} loading={funnel.loading} />
        </div>
      )}

      {/* ======================== OPERATIONS DASHBOARD ======================== */}
      {activeTab === 'operations' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2  gap-3">
            <MetricCard label="Avg API Latency" value={`${(operations.data?.averageLatency || 0).toFixed(0)}ms`} icon={<Zap size={18} className="text-white" />} color="from-yellow-500 to-amber-600" loading={operations.loading} />
            <MetricCard label="Error Rate" value={formatPercentage(operations.data?.errorRate || 0)} icon={<Activity size={18} className="text-white" />} color="from-red-500 to-[#b78929]" loading={operations.loading} />
            <MetricCard label="Cache Hit Rate" value="--" icon={<Target size={18} className="text-white" />} color="from-green-500 to-emerald-600" />
          </div>
          <AnalyticsChart title="API Latency (ms)" data={operations.data?.apiLatency || []} icon={<Zap size={16} />} gradient="from-yellow-500 to-amber-600" suffix=" ms" loading={operations.loading} />
        </div>
      )}

      {/* ======================== CREATOR DASHBOARD ======================== */}
      {activeTab === 'creator' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2  gap-3">
            <MetricCard label="Profile Views" value={formatNumber(creator.data?.profileViews || 0)} icon={<Eye size={18} className="text-white" />} color="from-[#151517]0 to-[#68686c]" loading={creator.loading} />
            <MetricCard label="Followers (Net)" value={formatNumber(creator.data?.followers.net || 0)} icon={<Users size={18} className="text-white" />} color="from-[#151517]0 to-[#b78929]" loading={creator.loading} />
            <MetricCard label="Earnings" value={formatCurrency(creator.data?.earnings || 0)} icon={<DollarSign size={18} className="text-white" />} color="from-green-500 to-emerald-600" loading={creator.loading} />
            <MetricCard label="Followers Gained" value={formatNumber(creator.data?.followers.gained || 0)} icon={<UserPlus size={18} className="text-white" />} color="from-teal-500 to-[#68686c]" loading={creator.loading} />
          </div>
          <AnalyticsChart title="Watch Time" data={creator.data?.watchTime || []} icon={<Clock size={16} />} gradient="from-[#151517]0 to-[#b78929]" suffix=" min" loading={creator.loading} />

          {/* Demographics */}
          {creator.data?.demographics && (
            <GlassCard>
              <div className="flex items-center gap-2 mb-4">
                <Globe size={16} className="text-[#c8c8cc]" />
                <h3 className="text-sm font-bold text-white">Audience Demographics</h3>
              </div>
              <div className="grid grid-cols-1  gap-6">
                <div>
                  <h4 className="text-xs text-gray-400 mb-2">Top Countries</h4>
                  <div className="space-y-2">
                    {(creator.data.demographics.countries || []).slice(0, 5).map(([country, count]: [string, number], i: number) => (
                      <ProgressBar key={i} label={country} value={count} max={creator.data.demographics.countries[0]?.[1] || 1} color="from-[#151517]0 to-[#68686c]" />
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs text-gray-400 mb-2">Devices</h4>
                  <div className="space-y-2">
                    {(creator.data.demographics.devices || []).map(([device, count]: [string, number], i: number) => (
                      <ProgressBar key={i} label={device} value={count} max={creator.data.demographics.devices[0]?.[1] || 1} color="from-[#151517]0 to-[#b78929]" />
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>
          )}
        </div>
      )}

      {/* ======================== CONTENT DASHBOARD ======================== */}
      {activeTab === 'content' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2  gap-3">
            <MetricCard label="Posts" value={formatNumber(product.data?.contentBreakdown.posts || 0)} icon={<Eye size={18} className="text-white" />} color="from-[#151517]0 to-[#68686c]" loading={product.loading} />
            <MetricCard label="Videos" value={formatNumber(product.data?.contentBreakdown.videos || 0)} icon={<Eye size={18} className="text-white" />} color="from-[#151517]0 to-[#b78929]" loading={product.loading} />
            <MetricCard label="Live Streams" value={formatNumber(product.data?.contentBreakdown.liveStreams || 0)} icon={<Eye size={18} className="text-white" />} color="from-green-500 to-emerald-600" loading={product.loading} />
            <MetricCard label="Stories" value={formatNumber(product.data?.contentBreakdown.stories || 0)} icon={<Eye size={18} className="text-white" />} color="from-orange-500 to-red-600" loading={product.loading} />
          </div>

          {/* Top Content */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-4">
              <Eye size={16} className="text-[#d6a83f]" />
              <h3 className="text-sm font-bold text-white">Top Performing Content</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-white/[0.06]">
                    <th className="text-left py-3 px-2 font-medium">#</th>
                    <th className="text-left py-3 px-2 font-medium">Type</th>
                    <th className="text-right py-3 px-2 font-medium">Views</th>
                    <th className="text-right py-3 px-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(topContent.data || []).slice(0, 10).map((c, i) => (
                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="py-3 px-2 text-gray-400">{i + 1}</td>
                      <td className="py-3 px-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-gray-300">
                          {c.targetType || 'unknown'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right text-white">{formatNumber(c.count ?? 0)}</td>
                      <td className="py-3 px-2 text-right text-green-400">{formatCurrency(c.value ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ======================== TRAFFIC DASHBOARD ======================== */}
      {activeTab === 'traffic' && (
        <div className="space-y-6">
          <GlassCard>
            <div className="flex items-center gap-2 mb-4">
              <Globe size={16} className="text-[#c8c8cc]" />
              <h3 className="text-sm font-bold text-white">Traffic Sources</h3>
            </div>
            <div className="space-y-2">
              {trafficSources.data?.sources && Object.entries(trafficSources.data.sources)
                .sort(([, a], [, b]) => b - a)
                .map(([source, count], i) => {
                  const total = trafficSources.data?.total || 1;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-white capitalize w-24 truncate">{source.replace(/_/g, ' ')}</span>
                      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-600"
                          style={{ width: `${(count / total) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400 w-16 text-right">{((count / total) * 100).toFixed(1)}%</span>
                      <span className="text-[10px] text-gray-500 w-16 text-right">{formatNumber(count)}</span>
                    </div>
                  );
                })}
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}