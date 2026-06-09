"use client";

import { Activity, CheckCircle2, Gauge, Layers, Radio } from "lucide-react";
import { CountUp } from "@/components/count-up";
import type { Headline } from "@/lib/derive";

function Tile({
  icon,
  label,
  value,
  decimals = 0,
  suffix = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
        <CountUp value={value} decimals={decimals} />
        {suffix && <span className="ml-0.5 text-base font-medium text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

export function StatTiles({ h }: { h: Headline }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile icon={<Layers className="h-4 w-4" />} label="Live pairs" value={h.livePairs} />
      <Tile icon={<Radio className="h-4 w-4" />} label="Gen rate" value={h.genRate} decimals={1} suffix="/s" />
      <Tile icon={<CheckCircle2 className="h-4 w-4" />} label="Success rate" value={h.successRate} decimals={0} suffix="%" />
      <Tile icon={<Gauge className="h-4 w-4" />} label="Avg fidelity" value={h.avgFidelity} decimals={3} />
      <Tile icon={<Activity className="h-4 w-4" />} label="Utilization" value={h.utilization} decimals={0} suffix="%" />
    </div>
  );
}
