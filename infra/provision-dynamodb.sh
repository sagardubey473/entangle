#!/usr/bin/env bash
# ============================================================================
# Provision the DynamoDB `EntangledPairs` table — the live, perishable inventory
# of entangled pairs.
#
#   - On-demand (PAY_PER_REQUEST) billing.
#   - GSI1 (endpoints)  : query all pairs between two nodes.
#   - GSI2 (gsi_status) : query all AVAILABLE pairs (fine at demo scale).
#   - TTL on `expires_at` (epoch SECONDS) auto-deletes pairs once they decay.
#
# Idempotent: skips creation if the table already exists.
#
# Usage:  AWS_REGION=us-east-1 DYNAMODB_TABLE=EntangledPairs ./provision-dynamodb.sh
# ============================================================================
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
TABLE="${DYNAMODB_TABLE:-EntangledPairs}"

echo "==> Region: $REGION   Table: $TABLE"

if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Table '$TABLE' already exists; skipping create."
else
  echo "==> Creating table '$TABLE'..."
  aws dynamodb create-table \
    --region "$REGION" \
    --table-name "$TABLE" \
    --billing-mode PAY_PER_REQUEST \
    --attribute-definitions \
        AttributeName=pair_id,AttributeType=S \
        AttributeName=endpoints,AttributeType=S \
        AttributeName=gsi_status,AttributeType=S \
    --key-schema \
        AttributeName=pair_id,KeyType=HASH \
    --global-secondary-indexes '[
      {
        "IndexName": "GSI1_endpoints",
        "KeySchema": [{"AttributeName": "endpoints", "KeyType": "HASH"}],
        "Projection": {"ProjectionType": "ALL"}
      },
      {
        "IndexName": "GSI2_status",
        "KeySchema": [{"AttributeName": "gsi_status", "KeyType": "HASH"}],
        "Projection": {"ProjectionType": "ALL"}
      }
    ]' >/dev/null

  echo "==> Waiting for table to become ACTIVE..."
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
fi

echo "==> Enabling TTL on 'expires_at'..."
# update-time-to-live errors if TTL is already enabled; tolerate that.
aws dynamodb update-time-to-live \
  --region "$REGION" \
  --table-name "$TABLE" \
  --time-to-live-specification "Enabled=true,AttributeName=expires_at" \
  >/dev/null 2>&1 || echo "    (TTL already enabled — ok)"

echo "==> DynamoDB provisioning complete."
