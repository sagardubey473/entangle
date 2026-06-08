#!/usr/bin/env bash
# ============================================================================
# Provision an Aurora PostgreSQL Serverless v2 cluster with the RDS Data API
# enabled. We use the Data API specifically so Vercel serverless functions can
# talk to the database over HTTPS without exhausting connection pools.
#
# Creates:
#   - a Secrets Manager secret holding the DB master credentials (required by
#     the Data API),
#   - an Aurora PostgreSQL Serverless v2 cluster with HTTP endpoint enabled,
#   - one db.serverless writer instance.
#
# Prints the values you must copy into .env:
#   AURORA_CLUSTER_ARN, AURORA_SECRET_ARN, AURORA_DATABASE
#
# Idempotent-ish: skips create steps whose resources already exist.
#
# Usage:
#   AWS_REGION=us-east-1 ./provision-aurora.sh
# ============================================================================
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
CLUSTER_ID="${AURORA_CLUSTER_ID:-entangle}"
DB_NAME="${AURORA_DATABASE:-entangle}"
MASTER_USER="${AURORA_MASTER_USER:-entangle_admin}"
SECRET_NAME="${AURORA_SECRET_NAME:-entangle-db-credentials}"
MIN_ACU="${AURORA_MIN_ACU:-0.5}"
MAX_ACU="${AURORA_MAX_ACU:-4}"
ENGINE_VERSION="${AURORA_ENGINE_VERSION:-15.4}"

echo "==> Region: $REGION   Cluster: $CLUSTER_ID   DB: $DB_NAME"

# --- 1. Master password + Secrets Manager secret ---------------------------
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Secret '$SECRET_NAME' already exists; reusing."
  MASTER_PASS="$(aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" --region "$REGION" \
    --query SecretString --output text | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')"
else
  echo "==> Generating master password + creating secret..."
  MASTER_PASS="$(aws secretsmanager get-random-password \
    --exclude-punctuation --password-length 24 --region "$REGION" \
    --query RandomPassword --output text)"
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --region "$REGION" \
    --secret-string "{\"username\":\"$MASTER_USER\",\"password\":\"$MASTER_PASS\"}" >/dev/null
fi
SECRET_ARN="$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" --query ARN --output text)"

# --- 2. Aurora Serverless v2 cluster (Data API enabled) --------------------
if aws rds describe-db-clusters --db-cluster-identifier "$CLUSTER_ID" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Cluster '$CLUSTER_ID' already exists; skipping create."
else
  echo "==> Creating Aurora PostgreSQL Serverless v2 cluster..."
  aws rds create-db-cluster \
    --region "$REGION" \
    --db-cluster-identifier "$CLUSTER_ID" \
    --engine aurora-postgresql \
    --engine-version "$ENGINE_VERSION" \
    --database-name "$DB_NAME" \
    --master-username "$MASTER_USER" \
    --master-user-password "$MASTER_PASS" \
    --serverless-v2-scaling-configuration "MinCapacity=$MIN_ACU,MaxCapacity=$MAX_ACU" \
    --enable-http-endpoint >/dev/null
fi

# --- 3. Serverless writer instance -----------------------------------------
INSTANCE_ID="${CLUSTER_ID}-writer"
if aws rds describe-db-instances --db-instance-identifier "$INSTANCE_ID" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Instance '$INSTANCE_ID' already exists; skipping create."
else
  echo "==> Creating db.serverless writer instance..."
  aws rds create-db-instance \
    --region "$REGION" \
    --db-instance-identifier "$INSTANCE_ID" \
    --db-cluster-identifier "$CLUSTER_ID" \
    --engine aurora-postgresql \
    --db-instance-class db.serverless >/dev/null
fi

echo "==> Waiting for cluster to become available (this can take several minutes)..."
aws rds wait db-instance-available --db-instance-identifier "$INSTANCE_ID" --region "$REGION"

# Ensure the Data API is on even if the cluster pre-existed.
aws rds modify-db-cluster --db-cluster-identifier "$CLUSTER_ID" --region "$REGION" \
  --enable-http-endpoint --apply-immediately >/dev/null 2>&1 || true

CLUSTER_ARN="$(aws rds describe-db-clusters --db-cluster-identifier "$CLUSTER_ID" --region "$REGION" \
  --query 'DBClusters[0].DBClusterArn' --output text)"

cat <<EOF

==> Aurora provisioning complete. Add these to your .env:

AURORA_CLUSTER_ARN=$CLUSTER_ARN
AURORA_SECRET_ARN=$SECRET_ARN
AURORA_DATABASE=$DB_NAME

Next:
  pnpm infra:migrate   # create the schema
  pnpm infra:seed      # load the East Coast corridor topology
EOF
