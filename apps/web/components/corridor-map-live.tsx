"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionRequest, NetworkEvent } from "@entangle/shared";
import {
  QuantumCorridorMap,
  type NetworkLink,
  type MapAnim,
} from "@/components/ui/quantum-corridor-map";
import { MAP_NODES } from "@/lib/nodes";

const EDGES: [string, string][] = [
  ["bnl", "sbu"], ["sbu", "commack"], ["commack", "westbury"], ["westbury", "nyc"],
  ["nyc", "columbia"], ["commack", "yale"], ["yale", "hartford"], ["hartford", "boston"],
  ["nyc", "princeton"], ["princeton", "philly"], ["philly", "baltimore"], ["baltimore", "dc"],
];

const MAX_CONCURRENT_ANIMS = 6;
const ANIM_LIFETIME_MS = 900;
// Most meaningful first; births are throttled because they're frequent.
const PRIORITY: Record<string, number> = {
  LINK_FAILURE: 0,
  FULFILLED: 1,
  SWAPPED: 2,
  EXPIRED: 3,
  GENERATED: 4,
};

function splitLink(linkId: unknown): [string, string] | null {
  if (typeof linkId !== "string") return null;
  const [a, b] = linkId.split("--");
  return a && b ? [a, b] : null;
}

/** Translate a new event into a transient map animation, or null. */
function eventToAnim(e: NetworkEvent): MapAnim | null {
  const p = e.payload ?? {};
  switch (e.type) {
    case "GENERATED": {
      const lk = splitLink(p.link_id);
      return lk ? { id: e.event_id, kind: "birth", from: lk[0], to: lk[1] } : null;
    }
    case "EXPIRED": {
      const lk = splitLink(p.link_id);
      return lk ? { id: e.event_id, kind: "expire", from: lk[0], to: lk[1] } : null;
    }
    case "LINK_FAILURE": {
      const lk = splitLink(p.link_id);
      return lk ? { id: e.event_id, kind: "failure", from: lk[0], to: lk[1] } : null;
    }
    case "SWAPPED": {
      return typeof p.at === "string" ? { id: e.event_id, kind: "swap", at: p.at } : null;
    }
    default:
      return null; // FULFILLED handled via activePath; RESERVED/CONSUMED/CONTROL ignored
  }
}

export function CorridorMapLive() {
  const [reduced, setReduced] = useState(false);
  const [links, setLinks] = useState<NetworkLink[]>([]);
  const [activePath, setActivePath] = useState<string[]>([]);
  const [delivered, setDelivered] = useState<number | undefined>(undefined);
  const [anims, setAnims] = useState<MapAnim[]>([]);

  const seenEvents = useRef<Set<string>>(new Set());
  const seededEvents = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        setLinks((data.links as NetworkLink[]) ?? EDGES.map(([from, to]) => ({ from, to, fidelity: 0.9 })));
        const path: string[] = data.activePath ?? [];
        setActivePath(path);
        // The route's true delivered fidelity comes from its fulfilled request,
        // not from the (post-consumption) live link snapshot.
        const reqs: ConnectionRequest[] = data.activeRequests ?? [];
        const key = path.join(">");
        const match = reqs.find(
          (r) => r.status === "FULFILLED" && r.path && r.path.join(">") === key,
        );
        setDelivered(match?.delivered_fidelity ?? undefined);

        const events: NetworkEvent[] = data.recentEvents ?? [];
        // First poll: seed seen ids so we don't animate ~40 historical events.
        if (!seededEvents.current) {
          events.forEach((e) => seenEvents.current.add(e.event_id));
          seededEvents.current = true;
          return;
        }
        // events arrive newest-first; collect genuinely new ones.
        const fresh: NetworkEvent[] = [];
        for (const e of events) {
          if (!seenEvents.current.has(e.event_id)) {
            seenEvents.current.add(e.event_id);
            fresh.push(e);
          }
        }
        if (seenEvents.current.size > 400) {
          // Trim memory: keep only the most recent ids in view.
          seenEvents.current = new Set(events.map((e) => e.event_id));
        }
        // Prioritize the meaningful moments; cap how many we add per poll.
        const directives = fresh
          .sort((a, b) => (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9))
          .map(eventToAnim)
          .filter((d): d is MapAnim => d !== null)
          .slice(0, 3);

        if (directives.length) {
          setAnims((prev) => [...prev, ...directives].slice(-MAX_CONCURRENT_ANIMS));
          for (const d of directives) {
            const t = setTimeout(() => {
              setAnims((prev) => prev.filter((a) => a.id !== d.id));
            }, ANIM_LIFETIME_MS);
            timers.current.push(t);
          }
        }
      } catch {
        setLinks(EDGES.map(([from, to]) => ({ from, to, fidelity: 0.85 })));
      }
    };
    void tick();
    const id = setInterval(tick, 400);
    const captured = timers.current;
    return () => {
      alive = false;
      clearInterval(id);
      captured.forEach(clearTimeout);
    };
  }, []);

  return (
    <QuantumCorridorMap
      nodes={MAP_NODES}
      links={links}
      activePath={activePath}
      deliveredFidelity={delivered}
      animations={reduced ? [] : anims}
      labelMode="endpoints"
      reducedMotion={reduced}
      className="h-full"
    />
  );
}
