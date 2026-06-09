import { NextResponse } from "next/server";
import type { ProofBody } from "@entangle/shared";
import { isAwsConfigured } from "@/lib/state";
import { demoSim } from "@/lib/demo";
import { runProof } from "@/lib/proof";

export const dynamic = "force-dynamic";

/**
 * POST /api/proof — the no-cloning demonstration. Fire N concurrent reservation
 * attempts at one AVAILABLE pair; exactly one succeeds.
 * Body: { attempts: number, pair_id?: string }
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Partial<ProofBody>;
  const attempts = typeof b.attempts === "number" ? Math.min(50, Math.max(2, Math.floor(b.attempts))) : 10;
  const pairId = typeof b.pair_id === "string" ? b.pair_id : undefined;

  try {
    const result = isAwsConfigured()
      ? await runProof(attempts, pairId)
      : demoSim.proof(attempts, pairId);
    return NextResponse.json(result, {
      headers: { "X-Entangle-Source": isAwsConfigured() ? "aws" : "demo" },
    });
  } catch (err) {
    console.error("/api/proof: failed:", err);
    return NextResponse.json({ error: "Proof run failed." }, { status: 500 });
  }
}
