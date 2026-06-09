/**
 * Entangle simulation engine — main loop.
 *
 * A self-scheduling fixed-timestep loop running at controls.ticks_per_sec.
 * Physics uses the real elapsed dt so changing the tick rate changes resolution,
 * not the timescale. Side-effects to Aurora (events, live_links, metrics) are
 * flushed on their own cadences to avoid hammering the Data API.
 *
 * Phase 2: generate + decay + expire only. No routing yet.
 */

import { repo } from "@entangle/db";
import { EntangleEngine } from "./engine.js";
import { cadences, initialControls, MAX_TICK_DT_MS } from "./config.js";

let running = true;

async function main(): Promise<void> {
  console.log("Entangle engine starting (Phase 2: generate / decay / expire)…");

  // Load live controls from Aurora; fall back to env defaults if unreachable.
  let controls = initialControls;
  try {
    controls = await repo.getControls();
    console.log("Loaded controls from Aurora:", controls);
  } catch (err) {
    console.warn("Could not load controls from Aurora; using env defaults.", err);
  }

  const engine = new EntangleEngine(controls);

  let lastNow = Date.now();
  let lastEvents = 0;
  let lastLiveLinks = 0;
  let lastRouting = 0;
  let lastMetrics = 0;
  let lastControls = 0;

  async function tick(): Promise<void> {
    const now = Date.now();
    const dt = Math.min(MAX_TICK_DT_MS, now - lastNow);
    lastNow = now;

    try {
      if (!engine.controls.paused) {
        const minted = await engine.generate(now, dt);
        const expired = await engine.expire(now);
        if (minted || expired) {
          process.stdout.write(
            `\r[${new Date(now).toISOString()}] live=${engine.livePairCount} ` +
              `(+${minted} −${expired})        `,
          );
        }
      }

      // Cadenced side-effects.
      if (now - lastLiveLinks >= cadences.liveLinks) {
        await repo.flushLiveLinks(engine.computeLiveLinks(now));
        lastLiveLinks = now;
      }
      if (!engine.controls.paused && now - lastRouting >= cadences.routing) {
        await engine.routeRequests(now);
        lastRouting = now;
      }
      if (now - lastEvents >= cadences.events) {
        await engine.flushEvents();
        lastEvents = now;
      }
      if (now - lastMetrics >= cadences.metrics) {
        await repo.insertMetrics(engine.buildMetrics(now));
        lastMetrics = now;
      }
      if (now - lastControls >= cadences.controls) {
        try {
          engine.controls = await repo.getControls();
          const failLink = await repo.consumeInjectFailure();
          if (failLink) {
            const dropped = await engine.injectFailure(failLink, now);
            console.log(`\ninjected failure on ${failLink}: dropped ${dropped} pairs`);
          }
        } catch (err) {
          console.error("\ncontrols refresh failed:", err);
        }
        lastControls = now;
      }
    } catch (err) {
      console.error("\ntick error (continuing):", err);
    }

    if (running) {
      const interval = Math.max(20, 1000 / Math.max(1, engine.controls.ticks_per_sec));
      setTimeout(() => void tick(), interval);
    }
  }

  void tick();
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\nReceived ${signal}, shutting down…`);
  running = false;
  // Give the in-flight tick a moment to settle.
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  console.error("Engine crashed:", err);
  process.exit(1);
});
