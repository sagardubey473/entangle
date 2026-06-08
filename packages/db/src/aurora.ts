/**
 * Aurora PostgreSQL client over the RDS Data API.
 *
 * We use the Data API (not a TCP pool) so Vercel serverless functions can run
 * many short-lived invocations without exhausting database connections. Queries
 * request `formatRecordsAs: JSON` so result rows come back as plain objects.
 */

import {
  RDSDataClient,
  ExecuteStatementCommand,
  BatchExecuteStatementCommand,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";
import { awsConfig, auroraConfig } from "./env.js";

const client = new RDSDataClient({ region: awsConfig.region });

/** Execute a write/DDL statement. Returns number of rows affected. */
export async function exec(
  sql: string,
  parameters: SqlParameter[] = [],
): Promise<number> {
  const res = await client.send(
    new ExecuteStatementCommand({
      resourceArn: auroraConfig.clusterArn,
      secretArn: auroraConfig.secretArn,
      database: auroraConfig.database,
      sql,
      parameters,
    }),
  );
  return res.numberOfRecordsUpdated ?? 0;
}

/** Execute a SELECT and return rows as typed plain objects. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  parameters: SqlParameter[] = [],
): Promise<T[]> {
  const res = await client.send(
    new ExecuteStatementCommand({
      resourceArn: auroraConfig.clusterArn,
      secretArn: auroraConfig.secretArn,
      database: auroraConfig.database,
      sql,
      parameters,
      formatRecordsAs: "JSON",
    }),
  );
  if (!res.formattedRecords) return [];
  return JSON.parse(res.formattedRecords) as T[];
}

/**
 * Execute one statement repeatedly with many parameter sets in a single call.
 * Ideal for flushing batched event/live_link writes from the engine without one
 * round-trip per row. No-op for an empty set.
 */
export async function batchExec(
  sql: string,
  parameterSets: SqlParameter[][],
): Promise<void> {
  if (parameterSets.length === 0) return;
  await client.send(
    new BatchExecuteStatementCommand({
      resourceArn: auroraConfig.clusterArn,
      secretArn: auroraConfig.secretArn,
      database: auroraConfig.database,
      sql,
      parameterSets,
    }),
  );
}

// ---------------------------------------------------------------------------
// Parameter helpers
// ---------------------------------------------------------------------------

export function str(name: string, value: string | null): SqlParameter {
  return value === null
    ? { name, value: { isNull: true } }
    : { name, value: { stringValue: value } };
}

export function num(name: string, value: number | null): SqlParameter {
  if (value === null) return { name, value: { isNull: true } };
  return Number.isInteger(value)
    ? { name, value: { longValue: value } }
    : { name, value: { doubleValue: value } };
}

export function bool(name: string, value: boolean): SqlParameter {
  return { name, value: { booleanValue: value } };
}

/** A jsonb parameter — pass any JSON-serializable value; cast with `::jsonb` in SQL. */
export function json(name: string, value: unknown): SqlParameter {
  return value === null || value === undefined
    ? { name, value: { isNull: true } }
    : { name, value: { stringValue: JSON.stringify(value) }, typeHint: "JSON" };
}
