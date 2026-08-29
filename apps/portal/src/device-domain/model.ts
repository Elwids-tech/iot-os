import type {
  DefinitionCompileRequest,
  DefinitionFixtureRequest,
  DeviceDraftDocument,
  DeviceProfileDocument,
  GatewayDocument,
  GatewayRouteDocument,
  NativeMqttBindingDocument,
} from "@iot-os/api-client"

export type ProfileVersion = DeviceProfileDocument["version"]
export type ProfileParameter = ProfileVersion["parameters"][number]
export type DerivedParameter = ProfileVersion["derived_parameters"][number]
export type ProfileProperty = ProfileVersion["properties"][number]
export type ProfileEvent = ProfileVersion["events"][number]
export type EventField = ProfileEvent["fields"][number]
export type ProfileCommand = ProfileVersion["commands"][number]
export type CommandField = ProfileCommand["fields"][number]
export type ValueSchema = ProfileParameter["value_schema"]
export type Presentation = NonNullable<ProfileParameter["presentation"]>

export type BindingVersion = NativeMqttBindingDocument["version"]
export type BindingChannel = BindingVersion["channels"][number]
export type ParameterMapping = BindingVersion["parameter_mappings"][number]
export type PropertyMapping = BindingVersion["property_mappings"][number]
export type EventMapping = BindingVersion["event_mappings"][number]
export type CommandMapping = BindingVersion["command_mappings"][number]
export type CalibrationOperation = ParameterMapping["calibration"][number]
export type InboundScope = GatewayRouteDocument["route"]["inbound_scopes"][number]
export type CompileFixture = DefinitionCompileRequest["fixtures"][number]

export const dataTypes = [
  "float64",
  "int64",
  "uint64",
  "boolean",
  "string",
  "bytes",
  "state",
] as const
export const inputWidgets = [
  "slider",
  "number_input",
  "switch",
  "select",
  "segmented_control",
  "text_input",
] as const
export const displayWidgets = ["gauge", "value_card", "chart", "status_badge"] as const
export const missingPolicies = ["reject_message", "omit_value", "use_default"] as const
export const invalidPolicies = [
  "reject_message",
  "omit_value",
  "use_default",
  "clamp",
  "accept_with_bad_quality",
] as const
export const calibrationOperations = [
  "multiply",
  "divide",
  "add",
  "subtract",
  "power",
  "clamp",
  "round",
  "cel",
] as const

export function newUuid(): string {
  return crypto.randomUUID()
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}

export function slugKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 100)
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const result = [...items]
  ;[result[index], result[target]] = [result[target], result[index]]
  return result
}

export function replaceItem<T extends { uuid: string }>(items: T[], item: T): T[] {
  return items.map((candidate) => (candidate.uuid === item.uuid ? item : candidate))
}

export function defaultValueSchema(dataType: (typeof dataTypes)[number] = "float64"): ValueSchema {
  return {
    data_type: dataType,
    unit_code: null,
    constraints: {
      exclusive_minimum: false,
      exclusive_maximum: false,
    },
  }
}

export function defaultPresentation(order: number): Presentation {
  return {
    order,
    precision: 1,
    input: { widget: "number_input", placeholder: null },
    display: { widget: "value_card" },
  }
}

export function presentationForType(
  presentation: Presentation | undefined,
  dataType: (typeof dataTypes)[number],
): Presentation {
  const current = presentation ?? defaultPresentation(10)
  const numeric = ["float64", "int64", "uint64"].includes(dataType)
  const boolean = dataType === "boolean"

  return {
    ...current,
    ...(numeric ? {} : { precision: undefined }),
    input: {
      ...current.input,
      widget: numeric ? "number_input" : boolean ? "switch" : "text_input",
    },
    display: {
      widget: boolean || dataType === "state" ? "status_badge" : "value_card",
    },
  }
}

export function valueSchemaForType(
  schema: ValueSchema,
  dataType: (typeof dataTypes)[number],
): ValueSchema {
  const numeric = ["float64", "int64", "uint64"].includes(dataType)
  const textual = ["string", "bytes", "state"].includes(dataType)
  const constraints = schema.constraints

  return {
    data_type: dataType,
    unit_code: numeric ? schema.unit_code : null,
    constraints: numeric
      ? {
          minimum: constraints.minimum,
          maximum: constraints.maximum,
          exclusive_minimum: constraints.exclusive_minimum,
          exclusive_maximum: constraints.exclusive_maximum,
          multiple_of: constraints.multiple_of,
        }
      : textual
        ? {
            min_length: constraints.min_length,
            max_length: constraints.max_length,
            pattern: constraints.pattern,
            allowed_values: constraints.allowed_values,
            exclusive_minimum: false,
            exclusive_maximum: false,
          }
        : { exclusive_minimum: false, exclusive_maximum: false },
  }
}

export function createParameter(order: number): ProfileParameter {
  return {
    uuid: newUuid(),
    key: "",
    label: "",
    description: null,
    value_schema: defaultValueSchema(),
    presentation: defaultPresentation(order),
  }
}

export function createDerivedParameter(order: number): DerivedParameter {
  return {
    ...createParameter(order),
    expression: { language: "cel", source: "" },
    dependencies: [],
  }
}

export function createProperty(order: number): ProfileProperty {
  return {
    ...createParameter(order),
    scope: "reported",
  }
}

export function createEventField(order: number): EventField {
  return createParameter(order)
}

export function createEvent(): ProfileEvent {
  return {
    uuid: newUuid(),
    key: "",
    label: "",
    description: null,
    mode: "stateless",
    default_severity: "notice",
    dedupe_window_seconds: null,
    fields: [],
  }
}

export function createCommandField(order: number): CommandField {
  return {
    ...createParameter(order),
    direction: "input",
    required: true,
  }
}

export function createCommand(): ProfileCommand {
  return {
    uuid: newUuid(),
    key: "",
    label: "",
    description: null,
    mode: "one_way",
    risk: "low",
    confirmation_text: null,
    timeout_seconds: 30,
    offline_policy: "reject",
    idempotent: true,
    max_attempts: 3,
    fields: [],
  }
}

export function createProfile(): DeviceProfileDocument {
  return {
    schema: "iot.device-profile.authoring.v1",
    profile: {
      uuid: newUuid(),
      key: "",
      name: "",
      description: null,
    },
    version: {
      uuid: newUuid(),
      version: 1,
      notes: null,
      parameters: [],
      derived_parameters: [],
      properties: [],
      events: [],
      commands: [],
    },
  }
}

export function createChannel(
  key = "telemetry",
  purpose: BindingChannel["purpose"] = "telemetry",
  direction: BindingChannel["direction"] = "device_to_platform",
  topicTemplate = "gateways/{gateway_id}/telemetry",
): BindingChannel {
  return {
    uuid: newUuid(),
    key,
    label: key
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    purpose,
    direction,
    topic_template: topicTemplate,
    qos: 1,
    retain: false,
    content_type: "application/json",
    record_path: "$",
    max_records: 1,
    envelope: {},
  }
}

export function createBinding(profile: DeviceProfileDocument): NativeMqttBindingDocument {
  return {
    schema: "iot.native-mqtt-binding.authoring.v1",
    binding: {
      uuid: newUuid(),
      profile_uuid: profile.profile.uuid,
      key: "",
      name: "",
      description: null,
      transport: "native_mqtt_json",
    },
    version: {
      uuid: newUuid(),
      profile_version_uuid: profile.version.uuid,
      version: 1,
      notes: null,
      channels: [createChannel()],
      parameter_mappings: [],
      property_mappings: [],
      event_mappings: [],
      command_mappings: [],
    },
  }
}

export function createCalibrationOperation(
  op: (typeof calibrationOperations)[number] = "divide",
): CalibrationOperation {
  switch (op) {
    case "power":
      return { op, exponent: 1 }
    case "clamp":
      return { op, minimum: 0, maximum: 100 }
    case "round":
      return { op, precision: 1 }
    case "cel":
      return { op, expression: "value" }
    default:
      return { op, value: op === "divide" ? 10 : 1 }
  }
}

function defaultMappingPolicy() {
  return {
    on_missing: "reject_message" as const,
    on_invalid: "reject_message" as const,
  }
}

export function createParameterMapping(
  parameter: ProfileParameter,
  channel = "telemetry",
): ParameterMapping {
  return {
    uuid: newUuid(),
    channel,
    target_parameter_uuid: parameter.uuid,
    source: { scope: "route", json_path: `$.${parameter.key || "value"}` },
    wire_data_type: parameter.value_schema.data_type,
    calibration: [],
    ...defaultMappingPolicy(),
  }
}

export function createPropertyMapping(
  property: ProfileProperty,
  channel: string,
): PropertyMapping {
  return {
    uuid: newUuid(),
    channel,
    target_property_uuid: property.uuid,
    direction: property.scope === "desired" ? "platform_to_device" : "device_to_platform",
    source: { scope: "route", json_path: `$.${property.key || "value"}` },
    wire_data_type: property.value_schema.data_type,
    operations: [],
    ...defaultMappingPolicy(),
  }
}

export function createEventMapping(event: ProfileEvent, channel: string): EventMapping {
  return {
    uuid: newUuid(),
    channel,
    target_event_uuid: event.uuid,
    field_mappings: event.fields.map((field) => ({
      target_event_field_uuid: field.uuid,
      source: { scope: "route" as const, json_path: `$.${field.key || "value"}` },
      wire_data_type: field.value_schema.data_type,
      operations: [],
      ...defaultMappingPolicy(),
    })),
  }
}

export function createCommandMapping(
  command: ProfileCommand,
  requestChannel: string,
  responseChannel?: string,
): CommandMapping {
  return {
    uuid: newUuid(),
    target_command_uuid: command.uuid,
    request_channel: requestChannel,
    ...(responseChannel ? { response_channel: responseChannel } : {}),
    request_template: {},
    request_envelope: {
      command_id_path: "$.command_id",
      requested_at_path: "$.requested_at",
      route_path_path: "$.route_path",
    },
    ...(responseChannel
      ? {
          response: {
            correlation: { scope: "message" as const, json_path: "$.command_id" },
            status: {
              path: { scope: "message" as const, json_path: "$.status" },
              values: {
                accepted: ["accepted"],
                running: ["running"],
                succeeded: ["succeeded"],
                failed: ["failed", "rejected"],
              },
            },
          },
        }
      : {}),
    field_mappings: command.fields.map((field) => ({
      direction: field.direction,
      target_command_field_uuid: field.uuid,
      json_path: `$.${field.key || "value"}`,
      wire_data_type: field.value_schema.data_type,
      operations: [],
      ...defaultMappingPolicy(),
    })),
  }
}

function addChannelIfMissing(
  channels: BindingChannel[],
  key: string,
  purpose: BindingChannel["purpose"],
  direction: BindingChannel["direction"],
  topic: string,
): BindingChannel[] {
  return channels.some((channel) => channel.key === key)
    ? channels
    : [...channels, createChannel(key, purpose, direction, topic)]
}

export function synchronizeBinding(
  binding: NativeMqttBindingDocument,
  profile: DeviceProfileDocument,
): NativeMqttBindingDocument {
  const result = clone(binding)
  result.binding.profile_uuid = profile.profile.uuid
  result.version.profile_version_uuid = profile.version.uuid

  if (profile.version.parameters.length > 0) {
    result.version.channels = addChannelIfMissing(
      result.version.channels,
      "telemetry",
      "telemetry",
      "device_to_platform",
      "gateways/{gateway_id}/telemetry",
    )
  }

  const measured = new Set(profile.version.parameters.map((item) => item.uuid))
  result.version.parameter_mappings = [
    ...result.version.parameter_mappings.filter((mapping) => measured.has(mapping.target_parameter_uuid)),
    ...profile.version.parameters
      .filter(
        (parameter) =>
          !result.version.parameter_mappings.some(
            (mapping) => mapping.target_parameter_uuid === parameter.uuid,
          ),
      )
      .map((parameter) => createParameterMapping(parameter)),
  ]

  const transportProperties = profile.version.properties.filter((property) => property.scope !== "platform")
  for (const property of transportProperties) {
    const desired = property.scope === "desired"
    const channelKey = desired ? "desired_properties" : "reported_properties"
    result.version.channels = addChannelIfMissing(
      result.version.channels,
      channelKey,
      channelKey,
      desired ? "platform_to_device" : "device_to_platform",
      `gateways/{gateway_id}/devices/{route_path}/${desired ? "properties/desired" : "properties/reported"}`,
    )
  }
  const propertyIds = new Set(transportProperties.map((item) => item.uuid))
  result.version.property_mappings = [
    ...result.version.property_mappings.filter((mapping) => propertyIds.has(mapping.target_property_uuid)),
    ...transportProperties
      .filter(
        (property) =>
          !result.version.property_mappings.some(
            (mapping) => mapping.target_property_uuid === property.uuid,
          ),
      )
      .map((property) =>
        createPropertyMapping(
          property,
          property.scope === "desired" ? "desired_properties" : "reported_properties",
        ),
      ),
  ]

  if (profile.version.events.length > 0) {
    result.version.channels = addChannelIfMissing(
      result.version.channels,
      "events",
      "event",
      "device_to_platform",
      "gateways/{gateway_id}/devices/{route_path}/events",
    )
  }
  const eventIds = new Set(profile.version.events.map((item) => item.uuid))
  result.version.event_mappings = [
    ...result.version.event_mappings.filter((mapping) => eventIds.has(mapping.target_event_uuid)),
    ...profile.version.events
      .filter(
        (event) =>
          !result.version.event_mappings.some((mapping) => mapping.target_event_uuid === event.uuid),
      )
      .map((event) => createEventMapping(event, "events")),
  ]

  const commandIds = new Set(profile.version.commands.map((item) => item.uuid))
  result.version.command_mappings = result.version.command_mappings.filter((mapping) =>
    commandIds.has(mapping.target_command_uuid),
  )
  for (const command of profile.version.commands) {
    const requestKey = `${command.key || "command"}_request`
    const responseKey = `${command.key || "command"}_response`
    result.version.channels = addChannelIfMissing(
      result.version.channels,
      requestKey,
      "command_request",
      "platform_to_device",
      `gateways/{gateway_id}/devices/{route_path}/commands/${command.key || "command"}/request`,
    )
    if (command.mode === "two_way") {
      result.version.channels = addChannelIfMissing(
        result.version.channels,
        responseKey,
        "command_response",
        "device_to_platform",
        `gateways/{gateway_id}/devices/{route_path}/commands/${command.key || "command"}/response`,
      )
    }
    if (!result.version.command_mappings.some((mapping) => mapping.target_command_uuid === command.uuid)) {
      result.version.command_mappings.push(
        createCommandMapping(command, requestKey, command.mode === "two_way" ? responseKey : undefined),
      )
    }
  }

  return result
}

export function createGateway(): GatewayDocument {
  return {
    schema: "iot.gateway.authoring.v1",
    gateway: {
      uuid: newUuid(),
      key: "",
      name: "",
      description: null,
      mqtt_client_id: "",
    },
  }
}

export function createDevice(): DeviceDraftDocument {
  return {
    uuid: newUuid(),
    name: "",
    external_id: "",
    description: null,
    profile_version_uuid: null,
    binding_version_uuid: null,
  }
}

export function createRoute(
  gateway: GatewayDocument,
  device: DeviceDraftDocument,
  profile: DeviceProfileDocument,
  binding: NativeMqttBindingDocument,
): GatewayRouteDocument {
  return {
    schema: "iot.gateway-route.authoring.v1",
    route: {
      uuid: newUuid(),
      revision: 1,
      gateway_uuid: gateway.gateway.uuid,
      device_uuid: device.uuid ?? newUuid(),
      profile_version_uuid: profile.version.uuid,
      binding_version_uuid: binding.version.uuid,
      route_path: "",
      topic_variables: {},
      inbound_scopes: inboundScopesForBinding(binding),
      enabled: true,
    },
  }
}

export function inboundScopesForBinding(binding: NativeMqttBindingDocument): InboundScope[] {
  return binding.version.channels
    .filter((channel) => channel.direction === "device_to_platform")
    .map((channel) => ({ channel: channel.key, payload_path: "$" }))
}

export function createFixture(binding: NativeMqttBindingDocument): CompileFixture {
  const channel = binding.version.channels.find((item) => item.direction === "device_to_platform")
  return {
    name: "Telemetry sample",
    kind: channel?.purpose === "event" ? "event" : "telemetry",
    channel: channel?.key ?? "telemetry",
    topic: "",
    payload: {},
  }
}

export function compileRequest(
  organizationUuid: string,
  profile: DeviceProfileDocument,
  binding: NativeMqttBindingDocument,
  gateway: GatewayDocument,
  route: GatewayRouteDocument,
  fixtures: CompileFixture[],
): DefinitionCompileRequest {
  return {
    schema: "iot.definition-compile-request.v1",
    organization_uuid: organizationUuid,
    profile,
    binding,
    gateway,
    route,
    fixtures,
  }
}

export function fixtureRequest(
  fixtures: CompileFixture[],
  expectedInputHash?: string,
): DefinitionFixtureRequest {
  return {
    schema: "iot.definition-fixtures.v1",
    fixtures,
    ...(expectedInputHash ? { expected_input_hash: expectedInputHash } : {}),
  }
}

export function resolveTopic(
  template: string,
  organizationUuid: string,
  gateway: GatewayDocument,
  route: GatewayRouteDocument,
): string {
  const values: Record<string, string> = {
    gateway_id: gateway.gateway.mqtt_client_id,
    gateway_uuid: gateway.gateway.uuid,
    route_path: route.route.route_path,
    device_uuid: route.route.device_uuid,
    organization_uuid: organizationUuid,
    ...route.route.topic_variables,
  }
  return template.replace(/\{([a-z][a-z0-9_]*)\}/g, (match, key: string) => values[key] || match)
}

export function parseJson(value: string): unknown {
  return JSON.parse(value)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
