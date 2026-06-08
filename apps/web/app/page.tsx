import { Activity, Radio, Zap } from "lucide-react";
import { CorridorMapLive } from "@/components/corridor-map-live";

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-accent">
            <Zap className="h-5 w-5" aria-hidden />
            <span className="text-sm font-semibold uppercase tracking-wide">Entangle</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Quantum network control plane
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Air-traffic control for a network where every connection is
            perishable, can&apos;t be copied, and vanishes the instant it&apos;s used.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted shadow-card">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fidelity-high opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-fidelity-high" />
          </span>
          Simulated quantum layer · live orchestration
        </span>
      </header>

      {/* Map + legend */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <CorridorMapLive />

        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Radio className="h-4 w-4 text-accent" aria-hidden />
              East Coast quantum corridor
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Models the real Long Island / NY testbed (NYSQIT / SCY-QNet),
              extended down a plausible inter-city spine to Washington DC. We
              model this testbed — we do not connect to it.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <h2 className="text-sm font-semibold text-foreground">Legend</h2>
            <div className="mt-3 space-y-3 text-xs text-muted">
              <div>
                <div className="mb-1 font-medium text-foreground">Link fidelity</div>
                <div className="h-2 w-full rounded-full bg-gradient-to-r from-fidelity-low via-fidelity-mid to-fidelity-high" />
                <div className="mt-1 flex justify-between">
                  <span>0.5 (floor)</span>
                  <span>1.0</span>
                </div>
              </div>
              <div className="flex items-center gap-4 pt-1">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-node-endpoint" />
                  Endpoint
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-node-repeater" />
                  Repeater
                </span>
              </div>
              <p className="pt-1 leading-relaxed">
                Arcs fade as pairs decohere; faint pulses trace high-fidelity
                links. Pulsing halos mark the testbed core.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="h-4 w-4 text-accent" aria-hidden />
              Coming online
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Request routing, the no-cloning proof, dashboards, and controls
              arrive in the next phases. The map already breathes as the live
              inventory generates and decays.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
