# Entangle — Infrastructure

Runnable, documented provisioning for the two AWS databases that back the
control plane:

| Store | Role | Why |
|-------|------|-----|
| **DynamoDB** `EntangledPairs` | Live, perishable pair inventory | Single-digit-ms conditional writes enforce the no-cloning guarantee; TTL auto-expires decayed pairs. |
| **Aurora PostgreSQL Serverless v2** | Topology, requests, events, routing summary, metrics | Relational queries + a recursive CTE do the multi-hop routing in the database. Accessed via the **RDS Data API** so serverless functions never exhaust connections. |

## Prerequisites

- AWS CLI v2 configured with credentials (`aws configure` or SSO).
- `python3` on PATH (used by the Aurora script to read the generated secret).
- Permissions for DynamoDB, RDS, and Secrets Manager.

## 1. Provision DynamoDB

```bash
cd infra
AWS_REGION=us-east-1 DYNAMODB_TABLE=EntangledPairs ./provision-dynamodb.sh
```

Creates the table (on-demand), the two GSIs (`GSI1_endpoints`, `GSI2_status`),
and enables TTL on `expires_at`. Idempotent.

## 2. Provision Aurora Serverless v2 (Data API)

```bash
cd infra
AWS_REGION=us-east-1 ./provision-aurora.sh
```

Creates a Secrets Manager secret, the cluster (HTTP endpoint / Data API enabled),
and a `db.serverless` writer. **Copy the three printed values into your `.env`:**
`AURORA_CLUSTER_ARN`, `AURORA_SECRET_ARN`, `AURORA_DATABASE`.

> Cluster creation can take several minutes. The script waits for availability.

## 3. Migrate + seed

From the repo root (with `.env` populated):

```bash
pnpm infra:migrate   # create the schema (migrations/001_init.sql)
pnpm infra:seed      # load the East Coast corridor topology from @entangle/shared
```

The seed reads `NODES`/`LINKS` from `@entangle/shared`, so the database topology
and the app's in-memory topology can never drift.

## Teardown

```bash
aws dynamodb delete-table --table-name EntangledPairs --region us-east-1
aws rds delete-db-instance --db-instance-identifier entangle-writer --skip-final-snapshot --region us-east-1
aws rds delete-db-cluster  --db-cluster-identifier entangle --skip-final-snapshot --region us-east-1
aws secretsmanager delete-secret --secret-id entangle-db-credentials --force-delete-without-recovery --region us-east-1
```
