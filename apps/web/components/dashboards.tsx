"use client";

import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import type { ChartPoint } from "@/lib/derive";

const COLORS = {
  accent: "#4F46E5",
  high: "#10B981",
  mid: "#F59E0B",
  sky: "#0EA5E9",
};

function MiniChart({
  title,
  children,
}: {
  title: string;
  children: React.ReactElement;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-1 text-xs font-medium text-muted">{title}</div>
      <div className="h-24 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: "1px solid #E5E7EB",
    fontSize: 12,
    boxShadow: "0 4px 16px rgba(17,24,39,0.06)",
  },
  labelStyle: { display: "none" },
};

export function Dashboards({ series }: { series: ChartPoint[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <MiniChart title="Generation rate (pairs/s)">
        <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="g-gen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, "auto"]} />
          <Tooltip {...tooltipStyle} />
          <Area type="monotone" dataKey="genRate" stroke={COLORS.accent} strokeWidth={2} fill="url(#g-gen)" isAnimationActive={false} />
        </AreaChart>
      </MiniChart>

      <MiniChart title="Success rate (%)">
        <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <YAxis hide domain={[0, 100]} />
          <Tooltip {...tooltipStyle} />
          <Line type="monotone" dataKey="successRate" stroke={COLORS.high} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </MiniChart>

      <MiniChart title="Avg delivered fidelity">
        <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <YAxis hide domain={[0, 1]} />
          <Tooltip {...tooltipStyle} />
          <Line type="monotone" dataKey="avgFidelity" stroke={COLORS.mid} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </MiniChart>

      <MiniChart title="Live pair count">
        <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="g-live" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.sky} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLORS.sky} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, "auto"]} />
          <Tooltip {...tooltipStyle} />
          <Area type="monotone" dataKey="livePairs" stroke={COLORS.sky} strokeWidth={2} fill="url(#g-live)" isAnimationActive={false} />
        </AreaChart>
      </MiniChart>

      <MiniChart title="Repeater utilization (%)">
        <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="g-util" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.high} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLORS.high} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, 100]} />
          <Tooltip {...tooltipStyle} />
          <Area type="monotone" dataKey="utilization" stroke={COLORS.high} strokeWidth={2} fill="url(#g-util)" isAnimationActive={false} />
        </AreaChart>
      </MiniChart>
    </div>
  );
}
