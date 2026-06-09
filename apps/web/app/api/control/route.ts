import { NextResponse } from "next/server";
import { LINK_BY_ID, type ControlBody, type SimControls } from "@entangle/shared";
import { repo } from "@entangle/db";
import { isAwsConfigured } from "@/lib/state";
import { demoSim } from "@/lib/demo";

export const dynamic = "force-dynamic";

function parse(body: unknown): ControlBody | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Body must be an object." };
  const b = body as Record<string, unknown>;
  const out: ControlBody = {};
  const numField = (k: keyof ControlBody, min: number, max: number) => {
    const v = b[k];
    if (v === undefined) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      return `${k} must be a number in [${min}, ${max}].`;
    }
    (out[k] as number) = v;
    return null;
  };
  for (const err of [
    numField("gen_multiplier", 0, 10),
    numField("decoherence_multiplier", 0, 10),
    numField("fidelity_floor", 0.1, 0.95),
    numField("ticks_per_sec", 1, 60),
  ]) {
    if (err) return { error: err };
  }
  if (b.paused !== undefined) {
    if (typeof b.paused !== "boolean") return { error: "paused must be a boolean." };
    out.paused = b.paused;
  }
  if (b.inject_failure_link_id !== undefined) {
    if (typeof b.inject_failure_link_id !== "string" || !LINK_BY_ID.has(b.inject_failure_link_id)) {
      return { error: `Unknown link id: ${String(b.inject_failure_link_id)}` };
    }
    out.inject_failure_link_id = b.inject_failure_link_id;
  }
  return out;
}

/** POST /api/control — update sim params and/or inject a link failure. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parse(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (!isAwsConfigured()) {
    const controls = demoSim.applyControl(parsed);
    return NextResponse.json(controls, { headers: { "X-Entangle-Source": "demo" } });
  }

  try {
    const { inject_failure_link_id, ...tunables } = parsed;
    if (Object.keys(tunables).length > 0) {
      await repo.updateControls(tunables as Partial<SimControls>);
    }
    if (inject_failure_link_id) {
      await repo.setInjectFailure(inject_failure_link_id);
    }
    const controls = await repo.getControls();
    return NextResponse.json(controls, { headers: { "X-Entangle-Source": "aws" } });
  } catch (err) {
    console.error("/api/control: failed:", err);
    return NextResponse.json({ error: "Failed to apply controls." }, { status: 500 });
  }
}
