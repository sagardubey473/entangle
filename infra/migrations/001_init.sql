-- ============================================================================
-- Entangle — Aurora PostgreSQL schema (migration 001)
--
-- Topology, requests, append-only event ledger, engine-maintained routing
-- summary, metrics snapshots, and the runtime-tunable simulation controls.
--
-- The live, perishable entangled-pair inventory lives in DynamoDB, NOT here.
-- Aurora holds the durable, relational, query-rich side of the control plane.
-- ============================================================================

-- Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS nodes (
  node_id      text PRIMARY KEY,
  name         text NOT NULL,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('endpoint', 'repeater')),
  tier         text NOT NULL CHECK (tier IN ('testbed', 'extension')),
  memory_slots integer NOT NULL DEFAULT 4,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS links (
  link_id          text PRIMARY KEY,
  node_a           text NOT NULL REFERENCES nodes(node_id),
  node_b           text NOT NULL REFERENCES nodes(node_id),
  distance_km      double precision NOT NULL,
  base_fidelity    double precision NOT NULL,
  gen_rate         double precision NOT NULL,
  decoherence_rate double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  request_id         text PRIMARY KEY,
  src_node           text NOT NULL REFERENCES nodes(node_id),
  dst_node           text NOT NULL REFERENCES nodes(node_id),
  min_fidelity       double precision NOT NULL,
  deadline_ms        bigint NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'FULFILLED', 'FAILED')),
  created_at         bigint NOT NULL,            -- epoch ms (virtual clock)
  fulfilled_at       bigint,
  path               jsonb,
  delivered_fidelity double precision
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status, created_at);

-- Append-only ledger. Never UPDATE or DELETE rows here.
CREATE TABLE IF NOT EXISTS events (
  event_id   text PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  type       text NOT NULL,
  pair_id    text,
  request_id text,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);

-- Engine-maintained routing summary, consumed by the recursive-CTE route query.
-- One row per directed edge (the engine maintains both directions).
CREATE TABLE IF NOT EXISTS live_links (
  from_node        text NOT NULL,
  to_node          text NOT NULL,
  best_pair_id     text,
  current_fidelity double precision NOT NULL DEFAULT 0,
  available_count  integer NOT NULL DEFAULT 0,
  updated_at       bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (from_node, to_node)
);

CREATE TABLE IF NOT EXISTS metrics_snapshots (
  ts                    timestamptz PRIMARY KEY,
  generated_total       bigint NOT NULL DEFAULT 0,
  fulfilled_total       bigint NOT NULL DEFAULT 0,
  failed_total          bigint NOT NULL DEFAULT 0,
  avg_delivered_fidelity double precision NOT NULL DEFAULT 0,
  live_pair_count       integer NOT NULL DEFAULT 0,
  utilization           double precision NOT NULL DEFAULT 0
);

-- Runtime-tunable simulation controls — a single row the web app can update and
-- the engine reads each tick. (The spec allows Aurora row or DynamoDB item; we
-- use a row here so it sits alongside the rest of the durable control state.)
CREATE TABLE IF NOT EXISTS sim_controls (
  id                       text PRIMARY KEY DEFAULT 'controls',
  ticks_per_sec            integer NOT NULL DEFAULT 10,
  gen_multiplier           double precision NOT NULL DEFAULT 1.0,
  decoherence_multiplier   double precision NOT NULL DEFAULT 1.0,
  fidelity_floor           double precision NOT NULL DEFAULT 0.5,
  paused                   boolean NOT NULL DEFAULT false,
  -- Transient signal: the web sets this; the engine consumes it (expires every
  -- pair on the link to force a visible reroute) and clears it back to NULL.
  inject_failure_link_id   text,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Idempotent for clusters created before this column existed.
ALTER TABLE sim_controls ADD COLUMN IF NOT EXISTS inject_failure_link_id text;

INSERT INTO sim_controls (id) VALUES ('controls')
ON CONFLICT (id) DO NOTHING;
