/**
 * Minimal RDS Data API helper shared by the migration runner and the seed
 * script. The web app and engine have their own richer clients; this is the
 * provisioning-time helper kept deliberately small.
 */

import "dotenv/config";
import {
  RDSDataClient,
  ExecuteStatementCommand,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in ` +
        `(run infra/provision-aurora.sh to obtain the ARNs).`,
    );
  }
  return v;
}

export const AURORA = {
  region: process.env.AWS_REGION ?? "us-east-1",
  clusterArn: () => required("AURORA_CLUSTER_ARN"),
  secretArn: () => required("AURORA_SECRET_ARN"),
  database: () => required("AURORA_DATABASE"),
};

const client = new RDSDataClient({ region: AURORA.region });

/** Execute a single SQL statement via the Data API. */
export async function exec(
  sql: string,
  parameters: SqlParameter[] = [],
): Promise<void> {
  await client.send(
    new ExecuteStatementCommand({
      resourceArn: AURORA.clusterArn(),
      secretArn: AURORA.secretArn(),
      database: AURORA.database(),
      sql,
      parameters,
    }),
  );
}

/** Build a typed Data API parameter. */
export function p(
  name: string,
  value: string | number | boolean | null,
): SqlParameter {
  if (value === null) return { name, value: { isNull: true } };
  if (typeof value === "string") return { name, value: { stringValue: value } };
  if (typeof value === "boolean") return { name, value: { booleanValue: value } };
  if (Number.isInteger(value)) return { name, value: { longValue: value } };
  return { name, value: { doubleValue: value } };
}
