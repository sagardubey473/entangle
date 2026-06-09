/**
 * No-cloning proof against the live DynamoDB table.
 *
 * Fires N concurrent conditional reservation attempts at a single AVAILABLE
 * pair. Exactly one can succeed (the conditional write requires status =
 * AVAILABLE); the rest get ConditionalCheckFailedException. This is the
 * no-cloning theorem enforced by the database. The winning reservation is
 * released afterward so demo inventory isn't lost.
 */

import type { ProofResponse } from "@entangle/shared";
import { dynamo, PairUnavailableError } from "@entangle/db";

export async function runProof(attempts: number, pairId?: string): Promise<ProofResponse> {
  let targetId = pairId;
  if (!targetId) {
    const available = await dynamo.queryAvailablePairs();
    targetId = available[0]?.pair_id;
  }
  if (!targetId) {
    return {
      pair_id: "none",
      attempts,
      succeeded: 0,
      explanation: "No AVAILABLE pair to contend for right now — try again in a moment.",
    };
  }

  // Precompute distinct request ids so we can release the winner by its exact id.
  const ids = Array.from({ length: attempts }, (_, i) => `proof-${i}-${Date.now()}`);
  const results = await Promise.allSettled(
    ids.map((rid) => dynamo.allocatePair(targetId!, rid)),
  );

  const winners = results.filter((r) => r.status === "fulfilled").length;
  const losses = results.filter(
    (r) => r.status === "rejected" && r.reason instanceof PairUnavailableError,
  ).length;
  const errors = results.length - winners - losses;

  // Release the winning reservation so the pair returns to the live inventory.
  const winnerIndex = results.findIndex((r) => r.status === "fulfilled");
  if (winnerIndex >= 0) {
    await dynamo.releasePair(targetId, ids[winnerIndex]!).catch(() => {});
  }

  return {
    pair_id: targetId,
    attempts,
    succeeded: winners,
    explanation:
      `Fired ${attempts} concurrent reservation attempts at one pair; exactly ${winners} won` +
      `${losses ? `, ${losses} were rejected by the conditional write` : ""}` +
      `${errors ? `, ${errors} errored` : ""}. ` +
      "This is the no-cloning theorem enforced in software: only one claim can flip " +
      "status AVAILABLE → RESERVED; the rest fail with ConditionalCheckFailedException.",
  };
}
