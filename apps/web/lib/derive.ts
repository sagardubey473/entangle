/** Derive chart-ready series and headline stats from raw metrics snapshots. */

import type { MetricsSnapshot } from "@entangle/shared";

export interface ChartPoint {
  t: number; // seconds since first sample
  genRate: number; // pairs generated per second
  successRate: number; // % of resolved requests fulfilled
  avgFidelity: number;
  livePairs: number;
  utilization: number; // %
}

export function deriveSeries(metrics: MetricsSnapshot[]): ChartPoint[] {
  if (metrics.length === 0) return [];
  const t0 = metrics[0]!.ts;
  const points: ChartPoint[] = [];
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i]!;
    const prev = metrics[i - 1];
    let genRate = 0;
    if (prev) {
      const dtSec = Math.max(0.001, (m.ts - prev.ts) / 1000);
      genRate = Math.max(0, (m.generated_total - prev.generated_total) / dtSec);
    }
    const resolved = m.fulfilled_total + m.failed_total;
    const successRate = resolved > 0 ? (100 * m.fulfilled_total) / resolved : 0;
    points.push({
      t: Math.round((m.ts - t0) / 1000),
      genRate: Number(genRate.toFixed(1)),
      successRate: Number(successRate.toFixed(1)),
      avgFidelity: Number((m.avg_delivered_fidelity || 0).toFixed(3)),
      livePairs: m.live_pair_count,
      utilization: Number((m.utilization * 100).toFixed(1)),
    });
  }
  return points;
}

export interface Headline {
  livePairs: number;
  genRate: number;
  successRate: number;
  avgFidelity: number;
  utilization: number;
  generatedTotal: number;
  fulfilledTotal: number;
  failedTotal: number;
}

export function headline(metrics: MetricsSnapshot[], series: ChartPoint[]): Headline {
  const last = metrics[metrics.length - 1];
  const lastPt = series[series.length - 1];
  return {
    livePairs: last?.live_pair_count ?? 0,
    genRate: lastPt?.genRate ?? 0,
    successRate: lastPt?.successRate ?? 0,
    avgFidelity: last?.avg_delivered_fidelity ?? 0,
    utilization: lastPt?.utilization ?? 0,
    generatedTotal: last?.generated_total ?? 0,
    fulfilledTotal: last?.fulfilled_total ?? 0,
    failedTotal: last?.failed_total ?? 0,
  };
}
