-- Index builds on large hypertables exceed the pool's 5 s statement timeout.
SET statement_timeout = 0;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'device_runtime') THEN
  CREATE SCHEMA device_runtime;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS device_runtime.rule_heads (
 rule_uuid uuid PRIMARY KEY, organization_uuid uuid NOT NULL, generation bigint NOT NULL DEFAULT 0,
 operation_uuid uuid, outcome jsonb
);
CREATE TABLE IF NOT EXISTS device_runtime.rule_executions (
 operation_uuid uuid PRIMARY KEY, rule_uuid uuid NOT NULL, organization_uuid uuid NOT NULL,
 device_uuid uuid NOT NULL, definition jsonb NOT NULL, definition_hash text NOT NULL,
 state jsonb NOT NULL, enabled boolean NOT NULL DEFAULT true, stopped_reason text,
 started_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rule_execution_enabled ON device_runtime.rule_executions(rule_uuid) WHERE enabled;
CREATE INDEX IF NOT EXISTS rule_execution_device ON device_runtime.rule_executions(device_uuid) WHERE enabled;
CREATE TABLE IF NOT EXISTS device_runtime.rule_checkpoint (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), stream_created timestamptz NOT NULL,
 sequence bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS device_runtime.rule_inputs (
 event_uuid uuid PRIMARY KEY, consumed_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS device_runtime.rule_transitions (
 id text PRIMARY KEY, operation_uuid uuid NOT NULL, transition jsonb NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS device_runtime.devices (
 device_uuid uuid PRIMARY KEY, organization_uuid uuid NOT NULL, generation bigint NOT NULL,
 definition jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE device_runtime.devices ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;
ALTER TABLE device_runtime.devices ADD COLUMN IF NOT EXISTS outcome jsonb;
CREATE TABLE IF NOT EXISTS device_runtime.observations (
 event_uuid uuid NOT NULL, organization_uuid uuid NOT NULL, device_uuid uuid NOT NULL,
 configuration_uuid uuid NOT NULL, parameter_uuid uuid NOT NULL,
 received_at timestamptz NOT NULL, observed_at timestamptz NOT NULL, reading jsonb NOT NULL,
 PRIMARY KEY (event_uuid, parameter_uuid, received_at)
);
SELECT create_hypertable('device_runtime.observations', 'received_at', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day');
CREATE INDEX IF NOT EXISTS observations_lookup ON device_runtime.observations (organization_uuid,device_uuid,parameter_uuid,received_at DESC);
CREATE INDEX IF NOT EXISTS observations_history_cursor ON device_runtime.observations (organization_uuid,device_uuid,parameter_uuid,received_at DESC,event_uuid DESC);
-- Reporting (charts, state timelines, counter increase) uses observed time; raw records keep receipt order.
CREATE INDEX IF NOT EXISTS observations_observed ON device_runtime.observations (organization_uuid,device_uuid,parameter_uuid,observed_at DESC);
-- Compress chunks after a week so long retention fits small disks. Segments
-- follow the reporting access path; ordering by observed time lets reports skip
-- compressed batches. Retention cleanup deletes compressed data by predicate.
DO $$ BEGIN
 IF NOT (SELECT compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_schema='device_runtime' AND hypertable_name='observations') THEN
  ALTER TABLE device_runtime.observations SET (timescaledb.compress, timescaledb.compress_segmentby = 'organization_uuid,device_uuid,parameter_uuid', timescaledb.compress_orderby = 'observed_at DESC, received_at DESC, event_uuid');
 END IF;
END $$;
SELECT add_compression_policy('device_runtime.observations', compress_after => INTERVAL '7 days', if_not_exists => true);
CREATE TABLE IF NOT EXISTS device_runtime.latest (
 organization_uuid uuid NOT NULL, device_uuid uuid NOT NULL, configuration_uuid uuid NOT NULL, parameter_uuid uuid NOT NULL,
 received_at timestamptz NOT NULL, reading jsonb NOT NULL,
 PRIMARY KEY(device_uuid,configuration_uuid,parameter_uuid)
);
CREATE TABLE IF NOT EXISTS device_runtime.diagnostics (
 event_uuid uuid NOT NULL, organization_uuid uuid NOT NULL, device_uuid uuid NOT NULL,
 parameter_uuid uuid NOT NULL, received_at timestamptz NOT NULL, reading jsonb NOT NULL,
 PRIMARY KEY(event_uuid,parameter_uuid)
);
CREATE TABLE IF NOT EXISTS device_runtime.commands (
 command_uuid uuid PRIMARY KEY, organization_uuid uuid NOT NULL, device_uuid uuid NOT NULL,
 parameter_uuid uuid NOT NULL, configuration_uuid uuid NOT NULL, request jsonb NOT NULL,
 status text NOT NULL, sent_at timestamptz, expires_at timestamptz NOT NULL,
 diagnostic text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commands_outstanding ON device_runtime.commands(device_uuid,parameter_uuid) WHERE status IN ('dispatching','sent');
CREATE TABLE IF NOT EXISTS device_runtime.outbox (
 uuid uuid PRIMARY KEY, event jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX IF NOT EXISTS runtime_outbox_pending ON device_runtime.outbox(created_at) WHERE published_at IS NULL;

-- Separate from lifecycle events: telemetry must never enter the Laravel inbox.
-- Published rows also serve as the durable ingestion deduplication ledger.
CREATE TABLE IF NOT EXISTS device_runtime.telemetry_outbox (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 telemetry_uuid uuid NOT NULL UNIQUE,
 organization_uuid uuid NOT NULL,
 event jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz
);
CREATE INDEX IF NOT EXISTS telemetry_outbox_pending ON device_runtime.telemetry_outbox(sequence) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS telemetry_outbox_device_latest ON device_runtime.telemetry_outbox(organization_uuid, (event->>'device_uuid'), sequence DESC);

-- V2 DAG state is isolated from the original geofence evaluator.
CREATE TABLE IF NOT EXISTS device_runtime.dag_executions (
 operation_uuid uuid PRIMARY KEY, workflow_uuid uuid NOT NULL, organization_uuid uuid NOT NULL,
 definition jsonb NOT NULL, definition_hash text NOT NULL, state jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT true, stopped_reason text, started_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL, next_timer timestamptz, last_trace jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS dag_due ON device_runtime.dag_executions(next_timer) WHERE enabled;
CREATE INDEX IF NOT EXISTS dag_org ON device_runtime.dag_executions(organization_uuid) WHERE enabled;
CREATE TABLE IF NOT EXISTS device_runtime.dag_intents (
 id text PRIMARY KEY, operation_uuid uuid NOT NULL REFERENCES device_runtime.dag_executions,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS device_runtime.dag_clock (
 singleton boolean PRIMARY KEY CHECK(singleton), cutoff bigint NOT NULL, due_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS device_runtime.dag_evaluations (
 id bigserial PRIMARY KEY,
 operation_uuid uuid NOT NULL REFERENCES device_runtime.dag_executions ON DELETE CASCADE,
 workflow_uuid uuid NOT NULL, organization_uuid uuid NOT NULL,
 received_at timestamptz NOT NULL,
 trigger text NOT NULL, outcome text NOT NULL,
 source jsonb, diagnostic text,
 trace jsonb NOT NULL DEFAULT '[]', intent_ids jsonb NOT NULL DEFAULT '[]',
 trace_truncated boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS dag_evaluation_workflow ON device_runtime.dag_evaluations(workflow_uuid,id DESC);
CREATE INDEX IF NOT EXISTS dag_evaluation_retention ON device_runtime.dag_evaluations(organization_uuid,received_at);
-- Retention and ledger pruning (Store.cleanup, Store.PruneLedgers).
CREATE INDEX IF NOT EXISTS telemetry_outbox_retention ON device_runtime.telemetry_outbox(organization_uuid,created_at) WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS runtime_outbox_published ON device_runtime.outbox(published_at) WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS rule_inputs_consumed ON device_runtime.rule_inputs(consumed_at);
RESET statement_timeout;
