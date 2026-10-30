export type Binding = {
  role: string;
  device_uuid: string;
  configuration_uuid: string;
  generation: number;
  parameter_uuid: string;
  data_type: "number" | "boolean" | "string";
  unit: string;
  fresh_seconds: number;
};
export type WorkflowNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};
export type WorkflowEdge = {
  source: string;
  source_port: string;
  target: string;
  target_port: string;
};
export type Workflow = {
  schema_version: "automation-workflow.v2";
  uuid?: string;
  version_uuid?: string;
  organization_uuid?: string;
  bindings: Binding[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
export type Layout = {
  positions: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
  /** Names authors give nodes, by node ID. Presentation only: never part of the deployed definition. */
  labels?: Record<string, string>;
};
export type NodeType = {
  type: string;
  label: string;
  inputs: Record<string, string> | null;
  outputs: Record<string, string> | null;
  config_schema: Record<
    string,
    {
      type: string;
      required: boolean;
      enum?: string[];
      minimum?: number;
      maximum?: number;
    }
  >;
  stateful: boolean;
  permissions: string[] | null;
  simulation: boolean;
};
/** `GET …/dag/node-types`; `meta.stale` marks a cached catalog served while the runtime is unavailable. */
export type NodeCatalog = {
  data: NodeType[];
  meta?: { stale?: boolean; cached_at?: string };
};
/** Host-supplied evaluation result shown on a node card (e.g. a simulation step). */
export type NodeOutcome = {
  status: "matched" | "not_matched" | "triggered" | "suppressed" | "waiting" | "evaluated" | (string & {});
  label: string;
  reason?: string;
};
export type Diagnostic = {
  node_id?: string;
  field: string;
  code: string;
  message: string;
};
export type Resource = {
  device_uuid: string;
  name: string;
  configuration_uuid: string;
  generation: number;
  /** Seconds between polls when a polling adapter feeds the device. */
  poll_interval_seconds?: number | null;
  parameters: {
    uuid: string;
    key: string;
    name?: string;
    data_type: string;
    unit?: string;
    accepts_command: boolean;
    reports_state: boolean;
    reporting?: { stale_after_seconds?: number } | null;
  }[];
};
