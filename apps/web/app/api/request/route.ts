import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { DEFAULT_DEADLINE_MS } from "@entangle/shared";
import { repo } from "@entangle/db";
import { isAwsConfigured } from "@/lib/state";
import { demoSim } from "@/lib/demo";
import { parseCreateRequest } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * POST /api/request — create a PENDING connection request.
 * Body: { src, dst, min_fidelity, deadline_ms? }
 *
 * The engine (AWS mode) or the demo simulator (offline) picks it up and attempts
 * to route + reserve + swap it into a fulfilled end-to-end connection.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseCreateRequest(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (!isAwsConfigured()) {
    const created = demoSim.createRequest(parsed);
    return NextResponse.json(created, { status: 201, headers: { "X-Entangle-Source": "demo" } });
  }

  try {
    const request_id = ulid();
    const created_at = Date.now();
    await repo.createRequest({
      request_id,
      src_node: parsed.src,
      dst_node: parsed.dst,
      min_fidelity: parsed.min_fidelity,
      deadline_ms: parsed.deadline_ms ?? DEFAULT_DEADLINE_MS,
      created_at,
    });
    return NextResponse.json(
      {
        request_id,
        src_node: parsed.src,
        dst_node: parsed.dst,
        min_fidelity: parsed.min_fidelity,
        deadline_ms: parsed.deadline_ms ?? DEFAULT_DEADLINE_MS,
        status: "PENDING",
        created_at,
      },
      { status: 201, headers: { "X-Entangle-Source": "aws" } },
    );
  } catch (err) {
    console.error("/api/request: failed to create:", err);
    return NextResponse.json({ error: "Failed to create request." }, { status: 500 });
  }
}
