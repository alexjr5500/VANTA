'use client';

import React, { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface TrendPoint {
  label: string;
  value: number;
}

/**
 * Dependency-free SVG trend chart for console surfaces.
 *
 * VANTA has no charting library, and adding one for two consoles is not
 * justified. This component renders real, caller-supplied series only — it
 * never invents data. It provides:
 *  - readable axes with formatted values,
 *  - an accessible text summary (role="img" + aria-label) and a visually
 *    hidden data table for screen readers,
 *  - an honest empty state when the series is empty or all zeros,
 *  - responsive resizing via a scaled viewBox,
 *  - reduced-motion respect (no animation classes under the media query).
 */
export default function TrendChart({
  data,
  height = 180,
  formatValue = (n: number) => String(n),
  ariaLabel,
  variant = 'area',
  className,
}: {
  data: TrendPoint[];
  height?: number;
  formatValue?: (n: number) => string;
  ariaLabel?: string;
  variant?: 'area' | 'bar';
  className?: string;
}) {
  const id = useId().replace(/[:]/g, '');
  const W = 720;
  const H = height;
  const PAD = { top: 12, right: 12, bottom: 26, left: 46 };

  const hasData = useMemo(
    () => Array.isArray(data) && data.length > 0 && data.some((d) => Number(d.value) > 0),
    [data],
  );

  const { max, points, path, area } = useMemo(() => {
    const vals = (data || []).map((d) => Math.max(0, Number(d.value) || 0));
    const max = Math.max(...vals, 1);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const step = data.length > 1 ? innerW / (data.length - 1) : 0;
    const points = vals.map((v, i) => ({
      x: PAD.left + (data.length > 1 ? i * step : innerW / 2),
      y: PAD.top + innerH - (v / max) * innerH,
      v,
    }));
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = points.length
      ? `${path} L${points[points.length - 1].x.toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${points[0].x.toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`
      : '';
    return { max, points, path, area };
  }, [data, H]);

  if (!hasData) {
    return (
      <div className={cn('flex flex-col items-center justify-center rounded-[var(--vc-radius)] border border-dashed border-console-border py-10 text-center', className)} style={{ minHeight: height }}>
        <p className="text-xs text-console-text-3">No data for this period.</p>
      </div>
    );
  }

  const summary = ariaLabel ||
    `Trend chart. ${data.length} points, from ${formatValue(data[0]?.value || 0)} to ${formatValue(data[data.length - 1]?.value || 0)}, peak ${formatValue(max)}.`;

  const yTicks = [0, 0.5, 1].map((f) => ({ f, v: max * f }));
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <figure className={cn('min-w-0', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto', maxHeight: H * 1.5 }}
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
      >
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--vc-chart-line)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--vc-chart-line)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* grid + y axis labels */}
        {yTicks.map(({ f, v }) => {
          const y = PAD.top + (H - PAD.top - PAD.bottom) * (1 - f);
          return (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--vc-chart-grid)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--vc-text-3)">{formatValue(Math.round(v))}</text>
            </g>
          );
        })}
        {variant === 'area' ? (
          <>
            <path d={area} fill={`url(#fill-${id})`} />
            <path d={path} fill="none" stroke="var(--vc-chart-line)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--vc-chart-line)">
                <title>{`${data[i]?.label}: ${formatValue(p.v)}`}</title>
              </circle>
            ))}
          </>
        ) : (
          points.map((p, i) => {
            const barW = Math.max(2, Math.min(28, (W - PAD.left - PAD.right) / Math.max(data.length, 1) - 6));
            return (
              <rect key={i} x={p.x - barW / 2} y={p.y} width={barW} height={Math.max(1, H - PAD.bottom - p.y)} rx="2" fill="var(--vc-chart-line)" opacity="0.85">
                <title>{`${data[i]?.label}: ${formatValue(p.v)}`}</title>
              </rect>
            );
          })
        )}
        {/* x axis labels (subsampled) */}
        {data.map((d, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text key={i} x={points[i]?.x ?? 0} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--vc-text-3)">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      {/* Screen-reader-friendly data table mirroring the series */}
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead><tr><th scope="col">Point</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}><th scope="row">{d.label}</th><td>{formatValue(d.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
