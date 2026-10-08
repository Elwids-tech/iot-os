import type { DeviceDetail, DiscoveryCandidate, Gateway } from "./devices";
import type { DeviceProfileArtifact } from "./index";

export type DeviceOnboarding = {
  uuid: string;
  mode: "direct" | "gateway";
  source_device_id: string;
  provisioned: boolean;
  diagnostic: string | null;
  broker_url: string;
  device: DeviceDetail;
  gateway: Gateway;
  candidate: DiscoveryCandidate | null;
  artifact: DeviceProfileArtifact;
};
export type OnboardingInput = {
  request_uuid: string;
  name: string;
  artifact_uuid: string;
  mode: "direct" | "gateway";
  gateway_uuid?: string;
  source_device_id?: string;
};
export type DeviceConnectionKit = {
  filename: string;
  archive_base64: string;
  ca_certificate: string;
  config: {
    broker_url: string;
    client_id: string;
    username: string;
    password: string;
    ca_file: string;
    group_id: string;
    host_id: string;
    edge_node_id: string;
    device_id: string;
    metrics: {
      name: string;
      label: string;
      data_type: string;
      unit: string | null;
    }[];
  };
};
