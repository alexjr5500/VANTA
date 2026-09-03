// ============================================================================
// VANTA Analytics React Hook
// Provides real-time and historical analytics data to components
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  analyticsApi,
  FunnelStep, CohortAnalysis, PredictiveForecast,
  TopContentItem, TrafficSources,
} from '../analyticsApi';

interface AnalyticsState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

type RefreshCallback = () => Promise<void>;

function useAnalyticsData<T>(fetcher: () => Promise<T>): AnalyticsState<T> & { refresh: RefreshCallback } {
  const [state, setState] = useState<AnalyticsState<T>>({ data: null, loading: true, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetch = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      setState({ data, loading: false, error: null });
    } catch (err: any) {
      setState(prev => ({ ...prev, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { ...state, refresh: fetch };
}

// ============================================================================
// HOOKS
// ============================================================================

export function useRealtimeMetrics(): AnalyticsState<any> & { subscribe: () => () => void; metrics: any | null } {
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    // Initial fetch
    analyticsApi.getRealtimeMetrics()
      .then(setMetrics)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));

    return () => {};
  }, []);

  useEffect(() => {
    const unsub = subscribe();
    return () => { unsub(); };
  }, [subscribe]);

  return { data: metrics, metrics, loading, error, subscribe };
}

export function useExecutiveDashboard(): AnalyticsState<any> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getDashboardExecutive());
}

export function useRevenueDashboard(): AnalyticsState<any> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getDashboardRevenue());
}

export function useGrowthDashboard(): AnalyticsState<any> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getDashboardGrowth());
}

export function useOperationsDashboard(): AnalyticsState<any> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getDashboardOperations());
}

export function useCreatorDashboard(): AnalyticsState<any> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getDashboardCreator());
}

export function useProductDashboard(): AnalyticsState<any> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getDashboardProduct());
}

export function useFunnel(steps?: { name: string; eventPattern: string }[]): AnalyticsState<FunnelStep[]> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getFunnelSteps());
}

export function useCohorts(period?: string, periodsCount?: number): AnalyticsState<CohortAnalysis[]> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getCohortAnalysis());
}

export function useTopContent(metric?: string, period?: string, limit?: number): AnalyticsState<TopContentItem[]> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getTopContent());
}

export function useTrafficSources(period?: string): AnalyticsState<TrafficSources> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getTrafficSources());
}

export function usePredictions(metric: string, period?: string): AnalyticsState<PredictiveForecast> & { refresh: RefreshCallback } {
  return useAnalyticsData(() => analyticsApi.getPredictiveForecast());
}

// ============================================================================
// AUTO-REFRESH HOOK
// ============================================================================

export function useAutoRefresh(refresh: RefreshCallback, intervalMs: number = 30000): void {
  useEffect(() => {
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);
}

// ============================================================================
// UTILITY: Format numbers for display
// ============================================================================

export function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export function formatCurrency(n: number): string {
  return '$' + formatNumber(n);
}

export function formatPercentage(n: number): string {
  return n.toFixed(1) + '%';
}

export function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hrs}h ${mins}m`;
  }
  return `${Math.round(minutes)}m`;
}