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
  parameters: {
    uuid: string;
    key: string;
    name?: string;
    data_type: string;
    unit?: string;
    accepts_command: boolean;
    reports_state: boolean;
  }[];
};
