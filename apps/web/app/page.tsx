import { Zap } from "lucide-react";
import { ControlPlane } from "@/components/control-plane";

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-accent">
          <Zap className="h-5 w-5" aria-hidden />
          <span className="text-sm font-semibold uppercase tracking-wide">Entangle</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Quantum network control plane
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Air-traffic control for a network where every connection is perishable,
          can&apos;t be copied, and vanishes the instant it&apos;s used.
          <span className="block text-xs">
            The quantum layer is simulated on a slowed timescale — the
            orchestration is the real artifact.
          </span>
        </p>
      </header>

      <ControlPlane />

      <footer className="mt-10 border-t border-border pt-4 text-xs leading-relaxed text-muted">
        Models the real Long Island / NY quantum testbed (NYSQIT / SCY-QNet —
        Stony Brook, Brookhaven, Columbia, Yale) extended down an inter-city
        spine to Washington DC. We model this testbed; we do not connect to it.
        There is no direct NYC–DC link — that connection is built by entanglement
        swapping across repeaters.
      </footer>
    </main>
  );
}
