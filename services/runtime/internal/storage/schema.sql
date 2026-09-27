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
