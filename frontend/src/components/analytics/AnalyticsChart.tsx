// ============================================================================
// VANTA Analytics Chart Component
// Reusable chart component for displaying time-series and comparison data
// ============================================================================

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import GlassCard from '@/components/ui/GlassCard';

export interface ChartDataPoint {
  timestamp?: string;
  date?: string;
  value: number;
  label?: string;
  group?: string;
}

interface AnalyticsChartProps {
  title: string;
  data: ChartDataPoint[];
  height?: number;
  color?: string;
  gradient?: string;
  type?: 'bar' | 'line' | 'area';
  showGrid?: boolean;
  showLabels?: boolean;
  loading?: boolean;
  prefix?: string;
  suffix?: string;
  icon?: React.ReactNode;
}

const DEFAULT_GRADIENT = 'from-[#d6a83f] to-[#151517]0';
const DEFAULT_COLOR = 'bg-[#151517]0/50';

export function AnalyticsChart({
  title, data, height = 120, color = DEFAULT_COLOR, gradient = DEFAULT_GRADIENT,
  type = 'bar', showGrid = false, showLabels = true, loading = false,
  prefix = '', suffix = '', icon,
}: AnalyticsChartProps) {
  const maxVal = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);
  
  if (loading) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          {icon && <div className="text-[#d6a83f]">{icon}</div>}
          <h3 className="text-sm font-bold text-white">{title}</h3>
        </div>
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-white/10 rounded w-3/4" />
          <div className="h-3 bg-white/10 rounded w-1/2" />
          <div className="h-3 bg-white/10 rounded w-2/3" />
        </div>
      </GlassCard>
    );
  }

  if (!data || data.length === 0) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          {icon && <div className="text-[#d6a83f]">{icon}</div>}
          <h3 className="text-sm font-bold text-white">{title}</h3>
        </div>
        <div className="flex items-center justify-center h-24 text-gray-500 text-xs">No data available</div>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {icon && <div className="text-[#d6a83f]">{icon}</div>}
          <h3 className="text-sm font-bold text-white">{title}</h3>
        </div>
        {data.length > 0 && (
          <span className="text-xs text-gray-500">
            {prefix}{data[data.length - 1]?.value.toLocaleString()}{suffix}
          </span>
        )}
      </div>

      <div className={`relative flex items-end gap-0.5`} style={{ height: `${height}px` }}>
        {type === 'bar' && (
          <div className="flex items-end gap-0.5 w-full h-full">
            {data.map((point, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${(point.value / maxVal) * 100}%` }}
                transition={{ duration: 0.5, delay: i * 0.02 }}
                className={`flex-1 rounded-sm bg-gradient-to-t ${gradient} hover:opacity-80 transition-opacity cursor-pointer min-w-[2px]`}
                style={{ height: `${(point.value / maxVal) * 100}%` }}
                title={`${point.timestamp}: ${prefix}${point.value.toLocaleString()}${suffix}`}
              />
            ))}
          </div>
        )}

        {type === 'line' && (
          <svg className="w-full h-full" viewBox={`0 0 ${data.length * 10} ${height}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id={`gradient-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(236, 72, 153)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="rgb(236, 72, 153)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polyline
              fill={`url(#gradient-${title.replace(/\s/g, '')})`}
              stroke="rgb(236, 72, 153)"
              strokeWidth="2"
              points={data.map((p, i) => `${i * 10 + 5},${height - (p.value / maxVal) * height}`).join(' ')}
            />
            <polyline
              fill="none"
              stroke="rgb(236, 72, 153)"
              strokeWidth="2"
              points={data.map((p, i) => `${i * 10 + 5},${height - (p.value / maxVal) * height}`).join(' ')}
            />
          </svg>
        )}
      </div>

      {showLabels && data.length > 1 && (
        <div className="flex justify-between mt-2 text-[10px] text-gray-500">
          <span>{data[0]?.timestamp?.slice(0, 10)}</span>
          <span>{data[Math.floor(data.length / 2)]?.timestamp?.slice(0, 10)}</span>
          <span>{data[data.length - 1]?.timestamp?.slice(0, 10)}</span>
        </div>
      )}
    </GlassCard>
  );
}

// ============================================================================
// METRIC CARD
// ============================================================================

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  change?: string;
  positive?: boolean;
  color?: string;
  loading?: boolean;
}

export function MetricCard({ label, value, icon, change, positive, color = 'from-[#151517]0 to-[#68686c]', loading }: MetricCardProps) {
  if (loading) {
    return (
      <div className="glass rounded-[20px] p-5 border border-white/[0.06] animate-pulse">
        <div className="w-10 h-10 rounded-xl bg-white/10 mb-3" />
        <div className="h-6 bg-white/10 rounded w-20 mb-2" />
        <div className="h-3 bg-white/10 rounded w-16" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-[20px] p-5 border border-white/[0.06]"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${color} mb-3`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <div className="flex items-center gap-2 mt-1">
        <p className="text-xs text-gray-400">{label}</p>
        {change && (
          <span className={`text-[10px] font-medium ${positive ? 'text-green-400' : 'text-red-400'}`}>
            {positive ? '+' : ''}{change}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// FUNNEL CHART
// ============================================================================

interface FunnelChartProps {
  steps: { name: string; count: number; percentage: number; dropOff: number }[];
  loading?: boolean;
}

export function FunnelChart({ steps, loading }: FunnelChartProps) {
  if (loading) {
    return (
      <GlassCard>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-10 bg-white/10 rounded-xl" />
          ))}
        </div>
      </GlassCard>
    );
  }

  if (!steps?.length) {
    return (
      <GlassCard>
        <div className="flex items-center justify-center h-32 text-gray-500 text-xs">No funnel data</div>
      </GlassCard>
    );
  }

  const maxCount = Math.max(...steps.map(s => s.count));

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-bold text-white">Conversion Funnel</h3>
      </div>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-300">{step.name}</span>
              <span className="text-xs text-gray-400">
                {step.count.toLocaleString()} ({step.percentage.toFixed(1)}%)
              </span>
            </div>
            <div className="relative h-8 rounded-xl overflow-hidden bg-white/5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(step.count / maxCount) * 100}%` }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className={`h-full rounded-xl bg-gradient-to-r ${
                  i === 0 ? 'from-green-500 to-emerald-600' :
                  i === 1 ? 'from-[#151517]0 to-[#68686c]' :
                  i === 2 ? 'from-[#151517]0 to-[#b78929]' :
                  'from-[#d6a83f] to-[#b78929]'
                }`}
              />
            </div>
            {step.dropOff > 0 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-[10px] text-red-400 mt-0.5"
              >
                Drop-off: {step.dropOff.toFixed(1)}%
              </motion.p>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ============================================================================
// COHORT TABLE
// ============================================================================

interface CohortTableProps {
  cohorts: { cohort: string; retention: number[]; size: number }[];
  loading?: boolean;
}

export function CohortTable({ cohorts, loading }: CohortTableProps) {
  if (loading) {
    return (
      <GlassCard>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-white/10 rounded w-1/3 mb-4" />
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-6 bg-white/10 rounded" />
          ))}
        </div>
      </GlassCard>
    );
  }

  if (!cohorts?.length) {
    return (
      <GlassCard>
        <div className="flex items-center justify-center h-32 text-gray-500 text-xs">No cohort data</div>
      </GlassCard>
    );
  }

  const maxPeriods = Math.max(...cohorts.map(c => c.retention.length));

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-bold text-white">Cohort Retention</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-white/[0.06]">
              <th className="text-left py-2 px-2 font-medium">Cohort</th>
              <th className="text-right py-2 px-2 font-medium">Size</th>
              {Array.from({ length: maxPeriods }, (_, i) => (
                <th key={i} className="text-right py-2 px-2 font-medium">P{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort, i) => (
              <tr key={i} className="border-b border-white/[0.04]">
                <td className="py-2 px-2 text-white">{cohort.cohort}</td>
                <td className="py-2 px-2 text-right text-gray-400">{cohort.size.toLocaleString()}</td>
                {Array.from({ length: maxPeriods }, (_, p) => (
                  <td key={p} className="py-2 px-2 text-right">
                    <span className={`font-medium ${
                      cohort.retention[p] >= 60 ? 'text-green-400' :
                      cohort.retention[p] >= 30 ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {cohort.retention[p]?.toFixed(0) || '-'}%
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

// ============================================================================
// PROGRESS BAR
// ============================================================================

interface ProgressBarProps {
  label: string;
  value: number;
  max?: number;
  color?: string;
  showValue?: boolean;
}

export function ProgressBar({ label, value, max = 100, color = 'from-[#d6a83f] to-[#151517]0', showValue = true }: ProgressBarProps) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-white w-28 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`h-full rounded-full bg-gradient-to-r ${color}`}
        />
      </div>
      {showValue && <span className="text-xs text-gray-400 w-12 text-right">{pct.toFixed(0)}%</span>}
    </div>
  );
}