"use client";

import { useId, useState } from "react";
import { Activity, CheckCircle2, Gauge, Info, Layers, Radio } from "lucide-react";
import { CountUp } from "@/components/count-up";
import type { Headline } from "@/lib/derive";

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="More info"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-muted transition hover:text-foreground focus:text-foreground focus:outline-none"
      >
        <Info className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-5 left-1/2 z-20 w-48 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-normal leading-snug text-muted shadow-card"
        >
          {text}
        </span>
      )}
    </span>
  );
}

function Tile({
  icon,
  label,
  subcaption,
  info,
  value,
  decimals = 0,
  suffix = "",
}: {
  icon: React.ReactNode;
  label: string;
  subcaption: string;
  info: string;
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-muted">
        {icon}
        <span className="text-xs font-medium text-foreground">{label}</span>
        <InfoTip text={info} />
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
        <CountUp value={value} decimals={decimals} />
        {suffix && <span className="ml-0.5 text-base font-medium text-muted">{suffix}</span>}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted">{subcaption}</div>
    </div>
  );
}

export function StatTiles({ h }: { h: Headline }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile
        icon={<Layers className="h-4 w-4" />}
        label="Live pairs"
        subcaption="entangled pairs currently alive on the network"
        info="Each is a perishable, non-copyable Bell pair shared between two sites; it decays continuously and is destroyed when used."
        value={h.livePairs}
      />
      <Tile
        icon={<Radio className="h-4 w-4" />}
        label="Generation rate"
        subcaption="new pairs created per second"
        info="Pairs appear stochastically on each fiber link — probabilistically, not on a schedule."
        value={h.genRate}
        decimals={1}
        suffix="/s"
      />
      <Tile
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="Success rate"
        subcaption="requests fulfilled vs. failed"
        info="A request succeeds when a route meeting its fidelity floor is found and reserved before its deadline."
        value={h.successRate}
        decimals={0}
        suffix="%"
      />
      <Tile
        icon={<Gauge className="h-4 w-4" />}
        label="Avg delivered fidelity"
        subcaption="end-to-end quality, 1.0 is perfect"
        info="End-to-end fidelity is the product of the per-hop fidelities along a fulfilled route."
        value={h.avgFidelity}
        decimals={3}
      />
      <Tile
        icon={<Activity className="h-4 w-4" />}
        label="Link provisioning"
        subcaption="how well-stocked the links are vs. target"
        info="Mean inventory depth across links against a per-link provisioning target; thin, long, or failed links pull it below 100%."
        value={h.utilization}
        decimals={0}
        suffix="%"
      />
    </div>
  );
}
