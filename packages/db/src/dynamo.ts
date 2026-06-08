/**
 * DynamoDB client for the live, perishable entangled-pair inventory.
 *
 * The single most important operation here is {@link allocatePair}: a conditional
 * UpdateItem that succeeds only if the pair is still AVAILABLE. This is how we
 * enforce the **no-cloning theorem** in software — exactly one concurrent claim
 * can ever win; every loser receives ConditionalCheckFailedException and must
 * re-plan. We never store a mutating "current fidelity"; callers compute it from
 * initial_fidelity + decay_rate + created_at using @entangle/shared.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  GSI1_ENDPOINTS,
  GSI2_STATUS,
  type EntangledPair,
  type PairStatus,
} from "@entangle/shared";
import { awsConfig, dynamoConfig } from "./env.js";

const base = new DynamoDBClient({ region: awsConfig.region });
const doc = DynamoDBDocumentClient.from(base, {
  marshallOptions: { removeUndefinedValues: true },
});

/** Thrown when a conditional claim loses a race (the pair was not AVAILABLE). */
export class PairUnavailableError extends Error {
  constructor(public readonly pairId: string) {
    super(`Pair ${pairId} is no longer AVAILABLE (lost the conditional claim).`);
    this.name = "PairUnavailableError";
  }
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: string }).name === "ConditionalCheckFailedException"
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Insert a freshly-minted pair. Fails if a pair with this id already exists. */
export async function putPair(pair: EntangledPair): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: dynamoConfig.tableName,
      Item: pair,
      ConditionExpression: "attribute_not_exists(pair_id)",
    }),
  );
}

/**
 * Atomically reserve a pair for a request. Returns true if THIS caller won the
 * claim; throws {@link PairUnavailableError} if it lost (pair no longer
 * AVAILABLE). This is the no-cloning guarantee.
 */
export async function allocatePair(
  pairId: string,
  requestId: string,
): Promise<true> {
  try {
    await doc.send(
      new UpdateCommand({
        TableName: dynamoConfig.tableName,
        Key: { pair_id: pairId },
        ConditionExpression: "#s = :available",
        UpdateExpression:
          "SET #s = :reserved, gsi_status = :reserved, reserved_by = :req",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":available": "AVAILABLE" satisfies PairStatus,
          ":reserved": "RESERVED" satisfies PairStatus,
          ":req": requestId,
        },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new PairUnavailableError(pairId);
    throw err;
  }
}

/**
 * Release a reservation back to AVAILABLE (used when a route partially reserves
 * then loses a later hop). Only releases if WE still hold it via requestId.
 */
export async function releasePair(
  pairId: string,
  requestId: string,
): Promise<void> {
  try {
    await doc.send(
      new UpdateCommand({
        TableName: dynamoConfig.tableName,
        Key: { pair_id: pairId },
        ConditionExpression: "#s = :reserved AND reserved_by = :req",
        UpdateExpression:
          "SET #s = :available, gsi_status = :available REMOVE reserved_by",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":reserved": "RESERVED" satisfies PairStatus,
          ":available": "AVAILABLE" satisfies PairStatus,
          ":req": requestId,
        },
      }),
    );
  } catch (err) {
    // If we no longer hold it, there is nothing to release — tolerate.
    if (isConditionalCheckFailed(err)) return;
    throw err;
  }
}

/** Transition a pair to a terminal status (CONSUMED or EXPIRED). */
export async function setPairStatus(
  pairId: string,
  status: Extract<PairStatus, "CONSUMED" | "EXPIRED">,
): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: dynamoConfig.tableName,
      Key: { pair_id: pairId },
      UpdateExpression: "SET #s = :status, gsi_status = :status REMOVE reserved_by",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":status": status },
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getPair(pairId: string): Promise<EntangledPair | null> {
  const res = await doc.send(
    new GetCommand({
      TableName: dynamoConfig.tableName,
      Key: { pair_id: pairId },
    }),
  );
  return (res.Item as EntangledPair | undefined) ?? null;
}

/** Query all pairs with a given status via GSI2 (paginated). */
export async function queryByStatus(
  status: PairStatus,
  limit?: number,
): Promise<EntangledPair[]> {
  const items: EntangledPair[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: dynamoConfig.tableName,
        IndexName: GSI2_STATUS,
        KeyConditionExpression: "gsi_status = :s",
        ExpressionAttributeValues: { ":s": status },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((res.Items as EntangledPair[] | undefined) ?? []));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (limit && items.length >= limit) return items.slice(0, limit);
  } while (lastKey);
  return items;
}

/** Query all pairs between two nodes (any status) via GSI1. */
export async function queryByEndpoints(
  endpoints: string,
): Promise<EntangledPair[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: dynamoConfig.tableName,
      IndexName: GSI1_ENDPOINTS,
      KeyConditionExpression: "endpoints = :e",
      ExpressionAttributeValues: { ":e": endpoints },
    }),
  );
  return (res.Items as EntangledPair[] | undefined) ?? [];
}

/** All AVAILABLE pairs — the engine's working set for expiry + routing. */
export function queryAvailablePairs(): Promise<EntangledPair[]> {
  return queryByStatus("AVAILABLE");
}
