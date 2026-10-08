import type { CompiledDeviceProfileDefinition, Device } from "./index";
export type AdapterSource = {
  type: "platform" | "vendor";
  url?: string | null;
  topics: string[];
};
export type AdapterFixture = {
  topic: string;
  payload?: unknown;
  payload_base64?: string;
  expect_error?: boolean;
  expected?: { name: string; value: unknown }[];
};
export type AdapterTest = {
  valid: boolean;
  results: {
    passed: boolean;
    output?: {
      sourceDeviceId: string;
      metrics: {
        name: string;
        value: unknown;
        datatype: string;
        unit: string | null;
      }[];
    };
    error?: string;
  }[];
};
export type AdapterRevision = {
  uuid: string;
  revision: number;
  content_hash: string;
  tested_at: string | null;
  test_result: AdapterTest | null;
};
export type AdapterDraft = {
  name: string;
  artifact_uuid: string;
  code: string;
  fixtures: AdapterFixture[];
  source: AdapterSource;
  secrets?: { username?: string; password?: string; ca_certificate?: string };
};
export type DeviceAdapter = AdapterDraft & {
  uuid: string;
  draft_revision: number;
  profile_name: string;
  profile: CompiledDeviceProfileDefinition;
  status: string;
  diagnostic: string | null;
  credentials_configured: boolean;
  applied_revision_uuid: string | null;
  desired_revision_uuid: string | null;
  revision: AdapterRevision;
  revisions: AdapterRevision[];
  health: {
    source_connected?: boolean;
    upstream_connected?: boolean;
    last_message_at?: string;
    checked_at?: string;
  } | null;
  operations: {
    uuid: string;
    action: string;
    status: string;
    diagnostic: string | null;
    revision_uuid: string;
  }[];
};
export type AdapterDirectory = {
  data: Pick<
    DeviceAdapter,
    | "uuid"
    | "name"
    | "status"
    | "profile_name"
    | "source"
    | "health"
    | "diagnostic"
  >[];
  tenant: {
    uuid: string;
    status: string;
    broker_url: string | null;
    diagnostic: string | null;
  } | null;
  capabilities: {
    view: boolean;
    manage: boolean;
    connections: boolean;
    activate: boolean;
  };
};
export type AdapterProfile = {
  uuid: string;
  name: string;
  revision: number;
  definition: CompiledDeviceProfileDefinition;
};
export type AdapterCandidate = {
  uuid: string;
  source_device_id: string;
  status: string;
  last_seen_at: string;
  preview: {
    sourceDeviceId: string;
    metrics: { name: string; value: unknown; unit: string | null }[];
    retained?: boolean;
  };
  installation_uuid: string | null;
  device: Device | null;
};
export type AdapterCredential = {
  uuid: string;
  name: string;
  username: string;
  revoked_at: string | null;
};
export type AdapterKit = {
  filename?: string;
  archive_base64?: string;
  broker_url: string;
  ca_certificate: string;
  credential_uuid: string;
  username: string;
  password: string;
  publish_topics: string[];
  instructions: string;
};
export type AdapterProposal = {
  uuid: string;
  code: string;
  summary: string;
  evidence: {
    origin: string;
    note?: string;
    source_id?: string;
    location?: string;
  }[];
  content_hash: string;
  draft_revision: number;
  status: string;
};
