import { NextResponse } from "next/server";
import { assembleState, isAwsConfigured } from "@/lib/state";
import { demoSim } from "@/lib/demo";

// Always fetch fresh; this endpoint is polled ~every 400ms.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/state — the single read the UI polls.
 *
 * Uses the live AWS databases when configured; otherwise (or if a live read
 * fails) falls back to the in-process demo simulator so the corridor always
 * renders and breathes. The `X-Entangle-Source` header reports which path served
 * the response.
 */
export async function GET() {
  if (isAwsConfigured()) {
    try {
      const state = await assembleState();
      return NextResponse.json(state, { headers: { "X-Entangle-Source": "aws" } });
    } catch (err) {
      console.error("/api/state: live read failed, falling back to demo:", err);
    }
  }
  return NextResponse.json(demoSim.getState(), {
    headers: { "X-Entangle-Source": "demo" },
  });
}
