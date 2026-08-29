import type {
  DefinitionFixture,
  DeviceProfileAuthoring,
  NativeMqttBindingAuthoring,
} from "@iot-os/api-client"

export type DefinitionIdentity = {
  profileUuid: string
  profileVersionUuid: string
  rootComponentUuid: string
  environmentComponentUuid: string
  temperatureTelemetryUuid: string
  humidityTelemetryUuid: string
  thermostatComponentUuid: string
  thermostatCommandUuid: string
  thermostatInputUuid: string
  thermostatOutputUuid: string
  bindingUuid: string
  bindingVersionUuid: string
  telemetryChannelUuid: string
  commandRequestChannelUuid: string
  commandResponseChannelUuid: string
  temperatureMappingUuid: string
  humidityMappingUuid: string
  commandMappingUuid: string
}

export type DefinitionFormState = {
  identity: DefinitionIdentity
  profileName: string
  profileKey: string
  profileDescription: string
  bindingName: string
  bindingKey: string
  bindingDescription: string
  notes: string
  telemetryTopic: string
  deviceIdPath: string
  timestampPath: string
  temperaturePath: string
  temperatureMinimum: number
  temperatureMaximum: number
  humidityPath: string
  humidityMinimum: number
  humidityMaximum: number
  thermostatEnabled: boolean
  commandRequestTopic: string
  commandResponseTopic: string
  commandTimeoutSeconds: number
  targetTemperatureMinimum: number
  targetTemperatureMaximum: number
  samplePayload: string
}

export type BuiltDefinition = {
  profile: DeviceProfileAuthoring
  binding: NativeMqttBindingAuthoring
  fixtures: DefinitionFixture[]
}

function uuid(): string {
  return crypto.randomUUID()
}

export function createDefinitionIdentity(): DefinitionIdentity {
  return {
    profileUuid: uuid(),
    profileVersionUuid: uuid(),
    rootComponentUuid: uuid(),
    environmentComponentUuid: uuid(),
    temperatureTelemetryUuid: uuid(),
    humidityTelemetryUuid: uuid(),
    thermostatComponentUuid: uuid(),
    thermostatCommandUuid: uuid(),
    thermostatInputUuid: uuid(),
    thermostatOutputUuid: uuid(),
    bindingUuid: uuid(),
    bindingVersionUuid: uuid(),
    telemetryChannelUuid: uuid(),
    commandRequestChannelUuid: uuid(),
    commandResponseChannelUuid: uuid(),
    temperatureMappingUuid: uuid(),
    humidityMappingUuid: uuid(),
    commandMappingUuid: uuid(),
  }
}

export function createDefaultDefinitionForm(): DefinitionFormState {
  return {
    identity: createDefinitionIdentity(),
    profileName: "Environment Sensor and Thermostat",
    profileKey: "environment_thermostat",
    profileDescription: "Temperature and humidity telemetry with two-way thermostat control.",
    bindingName: "Native MQTT firmware v1",
    bindingKey: "native_mqtt_v1",
    bindingDescription: "Firmware-owned MQTT JSON mapping.",
    notes: "Tenant-authored onboarding draft.",
    telemetryTopic: "devices/{device_id}/telemetry",
    deviceIdPath: "$.device_id",
    timestampPath: "$.timestamp",
    temperaturePath: "$.temperature",
    temperatureMinimum: -40,
    temperatureMaximum: 125,
    humidityPath: "$.humidity",
    humidityMinimum: 0,
    humidityMaximum: 100,
    thermostatEnabled: true,
    commandRequestTopic: "devices/{device_id}/commands/set_temperature/request",
    commandResponseTopic: "devices/{device_id}/commands/set_temperature/response",
    commandTimeoutSeconds: 30,
    targetTemperatureMinimum: 5,
    targetTemperatureMaximum: 35,
    samplePayload: JSON.stringify(
      {
        device_id: "sensor-001",
        timestamp: "2026-08-28T18:00:00Z",
        temperature: 22.4,
        humidity: 47.8,
      },
      null,
      2,
    ),
  }
}

function parseSamplePayload(samplePayload: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(samplePayload)

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("The telemetry sample must be one JSON object.")
  }

  return parsed as Record<string, unknown>
}

export function buildDefinition(form: DefinitionFormState): BuiltDefinition {
  const ids = form.identity
  const thermostatComponent = {
    uuid: ids.thermostatComponentUuid,
    key: "thermostat",
    name: "Thermostat",
    description: "Temperature set-point controller.",
    telemetry: [],
    properties: [],
    events: [],
    commands: [
      {
        uuid: ids.thermostatCommandUuid,
        key: "set_temperature",
        label: "Set thermostat temperature",
        description: "Set the target temperature and wait for a correlated Device response.",
        mode: "two_way",
        risk: "medium",
        confirmation_text: "Confirm the thermostat target temperature.",
        timeout_seconds: form.commandTimeoutSeconds,
        offline_policy: "reject",
        idempotent: true,
        max_attempts: 3,
        fields: [
          {
            uuid: ids.thermostatInputUuid,
            direction: "input",
            key: "temp_level",
            label: "Target temperature",
            description: "Requested thermostat temperature level.",
            value_schema: {
              data_type: "float64",
              unit_code: "Cel",
              required: true,
              critical: true,
              constraints: {
                minimum: form.targetTemperatureMinimum,
                maximum: form.targetTemperatureMaximum,
              },
              display: { order: 10, precision: 1 },
            },
          },
          {
            uuid: ids.thermostatOutputUuid,
            direction: "output",
            key: "applied_temp_level",
            label: "Applied temperature",
            description: "Temperature level reported as applied by the Device.",
            value_schema: {
              data_type: "float64",
              unit_code: "Cel",
              required: false,
              critical: false,
              constraints: {
                minimum: form.targetTemperatureMinimum,
                maximum: form.targetTemperatureMaximum,
              },
              display: { order: 10, precision: 1 },
            },
          },
        ],
      },
    ],
  }

  const profile = {
    schema: "iot.device-profile.authoring.v1",
    profile: {
      uuid: ids.profileUuid,
      key: form.profileKey.trim(),
      name: form.profileName.trim(),
      description: form.profileDescription.trim() || null,
    },
    version: {
      uuid: ids.profileVersionUuid,
      version: 1,
      notes: form.notes.trim() || null,
      components: [
        {
          uuid: ids.rootComponentUuid,
          key: null,
          name: "Device",
          description: null,
          telemetry: [],
          properties: [],
          events: [],
          commands: [],
        },
        {
          uuid: ids.environmentComponentUuid,
          key: "environment",
          name: "Environmental Sensor",
          description: "Temperature and humidity sensing module.",
          telemetry: [
            {
              uuid: ids.temperatureTelemetryUuid,
              key: "temperature",
              label: "Temperature",
              description: "Measured ambient temperature.",
              value_schema: {
                data_type: "float64",
                unit_code: "Cel",
                required: true,
                critical: true,
                constraints: {
                  minimum: form.temperatureMinimum,
                  maximum: form.temperatureMaximum,
                },
                display: { order: 10, precision: 1 },
              },
            },
            {
              uuid: ids.humidityTelemetryUuid,
              key: "humidity",
              label: "Relative humidity",
              description: "Measured relative humidity.",
              value_schema: {
                data_type: "float64",
                unit_code: "%",
                required: true,
                critical: true,
                constraints: {
                  minimum: form.humidityMinimum,
                  maximum: form.humidityMaximum,
                },
                display: { order: 20, precision: 1 },
              },
            },
          ],
          properties: [],
          events: [],
          commands: [],
        },
        ...(form.thermostatEnabled ? [thermostatComponent] : []),
      ],
    },
  } as DeviceProfileAuthoring

  const commandChannels = form.thermostatEnabled
    ? [
        {
          uuid: ids.commandRequestChannelUuid,
          key: "set_temperature_request",
          label: "Set temperature request",
          purpose: "command_request",
          direction: "platform_to_device",
          topic_template: form.commandRequestTopic.trim(),
          qos: 1,
          retain: false,
          content_type: "application/json",
          record_path: "$",
          max_records: 1,
          envelope: {},
        },
        {
          uuid: ids.commandResponseChannelUuid,
          key: "set_temperature_response",
          label: "Set temperature response",
          purpose: "command_response",
          direction: "device_to_platform",
          topic_template: form.commandResponseTopic.trim(),
          qos: 1,
          retain: false,
          content_type: "application/json",
          record_path: "$",
          max_records: 1,
          envelope: {
            device_id: { scope: "payload", json_path: form.deviceIdPath.trim() },
            observed_at: {
              path: { scope: "payload", json_path: form.timestampPath.trim() },
              format: "rfc3339",
            },
          },
        },
      ]
    : []

  const commandMappings = form.thermostatEnabled
    ? [
        {
          uuid: ids.commandMappingUuid,
          target: "thermostat.set_temperature",
          request_channel: "set_temperature_request",
          response_channel: "set_temperature_response",
          request_template: {},
          request_envelope: {
            command_id_path: "$.command_id",
            device_id_path: "$.device_id",
            requested_at_path: "$.timestamp",
          },
          response: {
            correlation: { scope: "payload", json_path: "$.command_id" },
            status: {
              path: { scope: "payload", json_path: "$.status" },
              values: {
                accepted: ["accepted"],
                running: ["running"],
                succeeded: ["succeeded"],
                failed: ["failed", "rejected"],
              },
            },
          },
          field_mappings: [
            {
              direction: "input",
              target: "temp_level",
              json_path: "$.temp_level",
              wire_data_type: "float64",
              missing_policy: "reject_message",
            },
            {
              direction: "output",
              target: "applied_temp_level",
              json_path: "$.applied_temp_level",
              wire_data_type: "float64",
              missing_policy: "omit_value",
            },
          ],
        },
      ]
    : []

  const binding = {
    schema: "iot.native-mqtt-binding.authoring.v1",
    binding: {
      uuid: ids.bindingUuid,
      profile_uuid: ids.profileUuid,
      key: form.bindingKey.trim(),
      name: form.bindingName.trim(),
      description: form.bindingDescription.trim() || null,
      transport: "native_mqtt_json",
    },
    version: {
      uuid: ids.bindingVersionUuid,
      profile_version_uuid: ids.profileVersionUuid,
      version: 1,
      notes: form.notes.trim() || null,
      channels: [
        {
          uuid: ids.telemetryChannelUuid,
          key: "telemetry",
          label: "Telemetry",
          purpose: "telemetry",
          direction: "device_to_platform",
          topic_template: form.telemetryTopic.trim(),
          qos: 1,
          retain: false,
          content_type: "application/json",
          record_path: "$",
          max_records: 1,
          envelope: {
            device_id: { scope: "payload", json_path: form.deviceIdPath.trim() },
            observed_at: {
              path: { scope: "payload", json_path: form.timestampPath.trim() },
              format: "rfc3339",
            },
          },
        },
        ...commandChannels,
      ],
      telemetry_mappings: [
        {
          uuid: ids.temperatureMappingUuid,
          channel: "telemetry",
          target: "environment.temperature",
          source: { scope: "record", json_path: form.temperaturePath.trim() },
          wire_data_type: "float64",
          missing_policy: "reject_message",
        },
        {
          uuid: ids.humidityMappingUuid,
          channel: "telemetry",
          target: "environment.humidity",
          source: { scope: "record", json_path: form.humidityPath.trim() },
          wire_data_type: "float64",
          missing_policy: "reject_message",
        },
      ],
      property_mappings: [],
      event_mappings: [],
      command_mappings: commandMappings,
    },
  } as NativeMqttBindingAuthoring

  return {
    profile,
    binding,
    fixtures: [
      {
        name: "Temperature and humidity telemetry",
        kind: "telemetry",
        input: parseSamplePayload(form.samplePayload),
      },
    ],
  }
}

type AuthoringDocuments = Pick<BuiltDefinition, "profile" | "binding">

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function formFromDefinition({
  profile,
  binding,
}: AuthoringDocuments): DefinitionFormState {
  const fallback = createDefaultDefinitionForm()
  const profileComponents = profile.version.components
  const root = profileComponents.find((component) => component.key === null)
  const environment = profileComponents.find((component) => component.key === "environment")
  const thermostat = profileComponents.find((component) => component.key === "thermostat")
  const temperature = environment?.telemetry.find((signal) => signal.key === "temperature")
  const humidity = environment?.telemetry.find((signal) => signal.key === "humidity")
  const command = thermostat?.commands.find((item) => item.key === "set_temperature")
  const inputField = command?.fields.find((field) => field.direction === "input")
  const outputField = command?.fields.find((field) => field.direction === "output")
  const telemetryChannel = binding.version.channels.find((channel) => channel.key === "telemetry")
  const requestChannel = binding.version.channels.find(
    (channel) => channel.key === "set_temperature_request",
  )
  const responseChannel = binding.version.channels.find(
    (channel) => channel.key === "set_temperature_response",
  )
  const temperatureMapping = binding.version.telemetry_mappings.find((mapping) =>
    mapping.target.endsWith("temperature"),
  )
  const humidityMapping = binding.version.telemetry_mappings.find((mapping) =>
    mapping.target.endsWith("humidity"),
  )
  const commandMapping = binding.version.command_mappings.find((mapping) =>
    mapping.target.endsWith("set_temperature"),
  )

  return {
    ...fallback,
    identity: {
      profileUuid: profile.profile.uuid ?? fallback.identity.profileUuid,
      profileVersionUuid: profile.version.uuid ?? fallback.identity.profileVersionUuid,
      rootComponentUuid: root?.uuid ?? fallback.identity.rootComponentUuid,
      environmentComponentUuid: environment?.uuid ?? fallback.identity.environmentComponentUuid,
      temperatureTelemetryUuid: temperature?.uuid ?? fallback.identity.temperatureTelemetryUuid,
      humidityTelemetryUuid: humidity?.uuid ?? fallback.identity.humidityTelemetryUuid,
      thermostatComponentUuid: thermostat?.uuid ?? fallback.identity.thermostatComponentUuid,
      thermostatCommandUuid: command?.uuid ?? fallback.identity.thermostatCommandUuid,
      thermostatInputUuid: inputField?.uuid ?? fallback.identity.thermostatInputUuid,
      thermostatOutputUuid: outputField?.uuid ?? fallback.identity.thermostatOutputUuid,
      bindingUuid: binding.binding.uuid ?? fallback.identity.bindingUuid,
      bindingVersionUuid: binding.version.uuid ?? fallback.identity.bindingVersionUuid,
      telemetryChannelUuid: telemetryChannel?.uuid ?? fallback.identity.telemetryChannelUuid,
      commandRequestChannelUuid:
        requestChannel?.uuid ?? fallback.identity.commandRequestChannelUuid,
      commandResponseChannelUuid:
        responseChannel?.uuid ?? fallback.identity.commandResponseChannelUuid,
      temperatureMappingUuid:
        temperatureMapping?.uuid ?? fallback.identity.temperatureMappingUuid,
      humidityMappingUuid: humidityMapping?.uuid ?? fallback.identity.humidityMappingUuid,
      commandMappingUuid: commandMapping?.uuid ?? fallback.identity.commandMappingUuid,
    },
    profileName: profile.profile.name,
    profileKey: profile.profile.key,
    profileDescription: profile.profile.description ?? "",
    bindingName: binding.binding.name,
    bindingKey: binding.binding.key,
    bindingDescription: binding.binding.description ?? "",
    notes: profile.version.notes ?? "",
    telemetryTopic: telemetryChannel?.topic_template ?? fallback.telemetryTopic,
    deviceIdPath:
      telemetryChannel?.envelope.device_id?.json_path ?? fallback.deviceIdPath,
    timestampPath:
      telemetryChannel?.envelope.observed_at?.path.json_path ?? fallback.timestampPath,
    temperaturePath: temperatureMapping?.source.json_path ?? fallback.temperaturePath,
    temperatureMinimum: numberOr(
      temperature?.value_schema.constraints?.minimum,
      fallback.temperatureMinimum,
    ),
    temperatureMaximum: numberOr(
      temperature?.value_schema.constraints?.maximum,
      fallback.temperatureMaximum,
    ),
    humidityPath: humidityMapping?.source.json_path ?? fallback.humidityPath,
    humidityMinimum: numberOr(
      humidity?.value_schema.constraints?.minimum,
      fallback.humidityMinimum,
    ),
    humidityMaximum: numberOr(
      humidity?.value_schema.constraints?.maximum,
      fallback.humidityMaximum,
    ),
    thermostatEnabled: Boolean(command && commandMapping),
    commandRequestTopic: requestChannel?.topic_template ?? fallback.commandRequestTopic,
    commandResponseTopic: responseChannel?.topic_template ?? fallback.commandResponseTopic,
    commandTimeoutSeconds: command?.timeout_seconds ?? fallback.commandTimeoutSeconds,
    targetTemperatureMinimum: numberOr(
      inputField?.value_schema.constraints?.minimum,
      fallback.targetTemperatureMinimum,
    ),
    targetTemperatureMaximum: numberOr(
      inputField?.value_schema.constraints?.maximum,
      fallback.targetTemperatureMaximum,
    ),
  }
}
