import { readFile, readdir } from "node:fs/promises"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceDirectory = resolve(packageDirectory, "../..")
const contractsDirectory = join(workspaceDirectory, "contracts")
const definitionsDirectory = join(contractsDirectory, "definitions")
const manifestPath = join(contractsDirectory, "fixtures/device-onboarding/manifest.json")

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await jsonFiles(path)))
    } else if (extname(entry.name) === ".json") {
      files.push(path)
    }
  }

  return files.sort()
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

function formatErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ")
}

const profileV2SchemaId =
  "https://schemas.iot-os.dev/definitions/device-profile/v2/authoring.schema.json"
const bindingV2SchemaId =
  "https://schemas.iot-os.dev/definitions/native-mqtt-binding/v2/authoring.schema.json"
const gatewayRouteV2SchemaId =
  "https://schemas.iot-os.dev/definitions/gateway-route/v2/authoring.schema.json"

function duplicateErrors(items, field, code, label) {
  const seen = new Set()
  const errors = []

  for (const item of items) {
    const value = item[field]

    if (seen.has(value)) {
      errors.push(`${code}: duplicate ${label} ${value}`)
    }

    seen.add(value)
  }

  return errors
}

function profileV2Errors(instance) {
  const version = instance.version
  const parameters = version.parameters
  const derived = version.derived_parameters
  const allParameters = [...parameters, ...derived]
  const nestedEntities = [
    ...allParameters,
    ...version.properties,
    ...version.events,
    ...version.events.flatMap((event) => event.fields),
    ...version.commands,
    ...version.commands.flatMap((command) => command.fields),
  ]
  const errors = [
    ...duplicateErrors(nestedEntities, "uuid", "DUPLICATE_DEFINITION_UUID", "definition UUID"),
    ...duplicateErrors(allParameters, "key", "DUPLICATE_PARAMETER_KEY", "parameter key"),
  ]
  const parameterIds = new Set(allParameters.map((parameter) => parameter.uuid))
  const derivedIds = new Set(derived.map((parameter) => parameter.uuid))
  const graph = new Map()

  for (const parameter of derived) {
    for (const dependency of parameter.dependencies) {
      if (!parameterIds.has(dependency)) {
        errors.push(
          `DERIVATION_DEPENDENCY_NOT_FOUND: ${parameter.uuid} references ${dependency}`,
        )
      }
    }

    const referencedIds = new Set(
      parameter.expression.source.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ) ?? [],
    )
    const declaredIds = new Set(parameter.dependencies)

    for (const referencedId of referencedIds) {
      if (!declaredIds.has(referencedId)) {
        errors.push(
          `DERIVATION_DEPENDENCY_UNDECLARED: ${parameter.uuid} expression references ${referencedId}`,
        )
      }
    }

    if (/\b(?:http|fetch|exec|eval|file|socket)\s*[.(]/i.test(parameter.expression.source)) {
      errors.push(`CEL_UNSUPPORTED_SYMBOL: ${parameter.uuid} uses a forbidden symbol`)
    }

    graph.set(
      parameter.uuid,
      parameter.dependencies.filter((dependency) => derivedIds.has(dependency)),
    )
  }

  const visiting = new Set()
  const visited = new Set()

  function visit(parameterId) {
    if (visiting.has(parameterId)) {
      errors.push(`DERIVATION_CYCLE: cycle includes ${parameterId}`)
      return
    }

    if (visited.has(parameterId)) {
      return
    }

    visiting.add(parameterId)

    for (const dependency of graph.get(parameterId) ?? []) {
      visit(dependency)
    }

    visiting.delete(parameterId)
    visited.add(parameterId)
  }

  for (const parameterId of derivedIds) {
    visit(parameterId)
  }

  return errors
}

function bindingV2Errors(instance, profile) {
  const version = instance.version
  const profileVersion = profile?.version
  const errors = [
    ...duplicateErrors(version.channels, "uuid", "DUPLICATE_CHANNEL_UUID", "channel UUID"),
    ...duplicateErrors(version.channels, "key", "DUPLICATE_CHANNEL_KEY", "channel key"),
    ...duplicateErrors(
      [
        ...version.parameter_mappings,
        ...version.property_mappings,
        ...version.event_mappings,
        ...version.command_mappings,
      ],
      "uuid",
      "DUPLICATE_MAPPING_UUID",
      "mapping UUID",
    ),
  ]
  const channels = new Map(version.channels.map((channel) => [channel.key, channel]))

  if (!profileVersion) {
    return errors
  }

  if (instance.binding.profile_uuid !== profile.profile.uuid) {
    errors.push("PROFILE_IDENTITY_MISMATCH: Binding profile UUID does not match Profile")
  }

  if (version.profile_version_uuid !== profileVersion.uuid) {
    errors.push("PROFILE_VERSION_MISMATCH: Binding Profile Version UUID does not match Profile")
  }

  const parameters = new Map(
    profileVersion.parameters.map((parameter) => [parameter.uuid, parameter]),
  )
  const properties = new Map(
    profileVersion.properties.map((property) => [property.uuid, property]),
  )
  const events = new Map(profileVersion.events.map((event) => [event.uuid, event]))
  const commands = new Map(profileVersion.commands.map((command) => [command.uuid, command]))
  const numericTypes = new Set(["float64", "int64", "uint64"])

  function checkChannel(channelKey, expectedDirection, expectedPurpose) {
    const channel = channels.get(channelKey)

    if (!channel) {
      errors.push(`CHANNEL_NOT_FOUND: mapping references ${channelKey}`)
      return
    }

    if (expectedDirection && channel.direction !== expectedDirection) {
      errors.push(`CHANNEL_DIRECTION_MISMATCH: ${channelKey} has ${channel.direction}`)
    }

    if (expectedPurpose && channel.purpose !== expectedPurpose) {
      errors.push(`CHANNEL_PURPOSE_MISMATCH: ${channelKey} has ${channel.purpose}`)
    }
  }

  function checkTypes(mapping, target, operations) {
    if (!target) {
      return
    }

    const wireType = mapping.wire_data_type
    const targetType = target.value_schema.data_type

    if (operations.length > 0 && (!numericTypes.has(wireType) || !numericTypes.has(targetType))) {
      errors.push(
        `TYPE_MISMATCH: numeric operations cannot map ${wireType} to ${targetType}`,
      )
      return
    }

    if (
      operations.length === 0 &&
      wireType !== targetType &&
      !(targetType === "float64" && numericTypes.has(wireType))
    ) {
      errors.push(`TYPE_MISMATCH: cannot map ${wireType} to ${targetType}`)
    }
  }

  const mappedParameterIds = new Set()

  for (const mapping of version.parameter_mappings) {
    checkChannel(mapping.channel, "device_to_platform", "telemetry")
    const target = parameters.get(mapping.target_parameter_uuid)

    if (mappedParameterIds.has(mapping.target_parameter_uuid)) {
      errors.push(
        `DUPLICATE_PARAMETER_MAPPING_TARGET: ${mapping.target_parameter_uuid}`,
      )
    }

    mappedParameterIds.add(mapping.target_parameter_uuid)

    if (!target) {
      errors.push(
        `MAPPING_TARGET_NOT_FOUND: parameter ${mapping.target_parameter_uuid} does not exist`,
      )
    }

    checkTypes(mapping, target, mapping.calibration)
  }

  for (const parameterId of parameters.keys()) {
    if (!mappedParameterIds.has(parameterId)) {
      errors.push(`PARAMETER_MAPPING_MISSING: ${parameterId}`)
    }
  }

  for (const mapping of version.property_mappings) {
    checkChannel(mapping.channel, mapping.direction)
    const target = properties.get(mapping.target_property_uuid)

    if (!target) {
      errors.push(
        `MAPPING_TARGET_NOT_FOUND: property ${mapping.target_property_uuid} does not exist`,
      )
    }

    checkTypes(mapping, target, mapping.operations)
  }

  for (const mapping of version.event_mappings) {
    checkChannel(mapping.channel, "device_to_platform", "event")
    const event = events.get(mapping.target_event_uuid)

    if (!event) {
      errors.push(`MAPPING_TARGET_NOT_FOUND: event ${mapping.target_event_uuid} does not exist`)
      continue
    }

    const fields = new Map(event.fields.map((field) => [field.uuid, field]))

    for (const fieldMapping of mapping.field_mappings) {
      const target = fields.get(fieldMapping.target_event_field_uuid)

      if (!target) {
        errors.push(
          `MAPPING_TARGET_NOT_FOUND: event field ${fieldMapping.target_event_field_uuid} does not exist`,
        )
      }

      checkTypes(fieldMapping, target, fieldMapping.operations)
    }
  }

  const mappedCommandIds = new Set()

  for (const mapping of version.command_mappings) {
    checkChannel(mapping.request_channel, "platform_to_device", "command_request")

    if (mapping.response_channel) {
      checkChannel(mapping.response_channel, "device_to_platform", "command_response")
    }

    const command = commands.get(mapping.target_command_uuid)

    if (!command) {
      errors.push(
        `MAPPING_TARGET_NOT_FOUND: command ${mapping.target_command_uuid} does not exist`,
      )
      continue
    }

    mappedCommandIds.add(command.uuid)

    if (command.mode === "two_way" && (!mapping.response_channel || !mapping.response)) {
      errors.push(`COMMAND_RESPONSE_MAPPING_MISSING: ${command.uuid}`)
    }

    if (command.mode === "one_way" && (mapping.response_channel || mapping.response)) {
      errors.push(`COMMAND_RESPONSE_MAPPING_UNEXPECTED: ${command.uuid}`)
    }

    const fields = new Map(command.fields.map((field) => [field.uuid, field]))
    const mappedFieldIds = new Set()

    for (const fieldMapping of mapping.field_mappings) {
      const target = fields.get(fieldMapping.target_command_field_uuid)

      if (!target) {
        errors.push(
          `MAPPING_TARGET_NOT_FOUND: command field ${fieldMapping.target_command_field_uuid} does not exist`,
        )
      }

      mappedFieldIds.add(fieldMapping.target_command_field_uuid)

      if (target && target.direction !== fieldMapping.direction) {
        errors.push(
          `COMMAND_FIELD_DIRECTION_MISMATCH: ${target.uuid} is ${target.direction}`,
        )
      }

      checkTypes(fieldMapping, target, fieldMapping.operations)
    }

    for (const field of command.fields) {
      if (field.required && !mappedFieldIds.has(field.uuid)) {
        errors.push(`COMMAND_FIELD_MAPPING_MISSING: ${field.uuid}`)
      }
    }
  }

  for (const commandId of commands.keys()) {
    if (!mappedCommandIds.has(commandId)) {
      errors.push(`COMMAND_MAPPING_MISSING: ${commandId}`)
    }
  }

  return errors
}

function gatewayRouteV2Errors(instance, binding, gateway) {
  const route = instance.route
  const errors = []

  if (gateway && route.gateway_uuid !== gateway.gateway.uuid) {
    errors.push("GATEWAY_IDENTITY_MISMATCH: route Gateway UUID does not match Gateway")
  }

  if (!binding) {
    return errors
  }

  if (route.binding_version_uuid !== binding.version.uuid) {
    errors.push("BINDING_VERSION_MISMATCH: route Binding Version UUID does not match Binding")
  }

  if (route.profile_version_uuid !== binding.version.profile_version_uuid) {
    errors.push("PROFILE_VERSION_MISMATCH: route Profile Version UUID does not match Binding")
  }

  const channels = new Map(binding.version.channels.map((channel) => [channel.key, channel]))
  const inboundChannels = new Set()

  for (const scope of route.inbound_scopes) {
    if (inboundChannels.has(scope.channel)) {
      errors.push(`DUPLICATE_ROUTE_CHANNEL: ${scope.channel}`)
    }

    inboundChannels.add(scope.channel)
    const channel = channels.get(scope.channel)

    if (!channel) {
      errors.push(`CHANNEL_NOT_FOUND: route references ${scope.channel}`)
    } else if (channel.direction !== "device_to_platform") {
      errors.push(`CHANNEL_DIRECTION_MISMATCH: route scope ${scope.channel} is outbound`)
    }
  }

  const availableVariables = new Set([
    "gateway_id",
    "route_path",
    ...Object.keys(route.topic_variables),
  ])

  for (const channel of channels.values()) {
    const variables = channel.topic_template.matchAll(/\{([a-z][a-z0-9_]*)\}/g)

    for (const match of variables) {
      if (!availableVariables.has(match[1])) {
        errors.push(`TOPIC_VARIABLE_NOT_FOUND: ${channel.key} requires ${match[1]}`)
      }
    }
  }

  return errors
}

async function semanticErrorsFor(fixtureCase, instance) {
  const context = fixtureCase.context ?? {}
  const profile = context.profile
    ? await readJson(join(contractsDirectory, context.profile))
    : null
  const binding = context.binding
    ? await readJson(join(contractsDirectory, context.binding))
    : null
  const gateway = context.gateway
    ? await readJson(join(contractsDirectory, context.gateway))
    : null

  if (fixtureCase.schema_id === profileV2SchemaId) {
    return profileV2Errors(instance)
  }

  if (fixtureCase.schema_id === bindingV2SchemaId) {
    return bindingV2Errors(instance, profile)
  }

  if (fixtureCase.schema_id === gatewayRouteV2SchemaId) {
    return gatewayRouteV2Errors(instance, binding, gateway)
  }

  return []
}

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
})

addFormats(ajv)

const schemaPaths = await jsonFiles(definitionsDirectory)
const schemas = await Promise.all(schemaPaths.map(readJson))

for (const [index, schema] of schemas.entries()) {
  if (!schema.$id) {
    throw new Error(`${relative(workspaceDirectory, schemaPaths[index])} has no $id`)
  }

  if (!ajv.validateSchema(schema)) {
    throw new Error(
      `${relative(workspaceDirectory, schemaPaths[index])} is not a valid schema: ${formatErrors(ajv.errors)}`,
    )
  }

  ajv.addSchema(schema)
}

for (const schema of schemas) {
  if (!ajv.getSchema(schema.$id)) {
    throw new Error(`Could not compile schema ${schema.$id}`)
  }
}

function schemaById(id) {
  const schema = schemas.find((candidate) => candidate.$id === id)

  if (!schema) {
    throw new Error(`Required schema ${id} was not loaded`)
  }

  return schema
}

function requireFields(definition, fields, label) {
  const required = new Set(definition.required ?? [])

  for (const field of fields) {
    if (!required.has(field)) {
      throw new Error(`${label} must require ${field}`)
    }
  }
}

const commonV2 = schemaById("https://schemas.iot-os.dev/definitions/common/v2/schema.json")
const profileV2 = schemaById(profileV2SchemaId)
const bindingV2 = schemaById(bindingV2SchemaId)
const canonicalTelemetryV2 = schemaById(
  "https://schemas.iot-os.dev/definitions/canonical-telemetry/v2/schema.json",
)

requireFields(commonV2.$defs.ValueSchema, ["data_type", "constraints"], "v2 ValueSchema")

if ("required" in commonV2.$defs.ValueSchema.properties) {
  throw new Error("v2 ValueSchema must not expose contextual Command required metadata")
}

if ("critical" in commonV2.$defs.ValueSchema.properties) {
  throw new Error("v2 ValueSchema must not expose the unused critical flag")
}

requireFields(profileV2.$defs.Parameter, ["uuid"], "v2 measured Parameter")
requireFields(profileV2.$defs.DerivedParameter, ["uuid", "dependencies"], "v2 derived Parameter")
requireFields(profileV2.$defs.CommandField, ["required"], "v2 Command field")
requireFields(
  bindingV2.$defs.ParameterMapping,
  ["target_parameter_uuid", "calibration", "on_missing", "on_invalid"],
  "v2 parameter mapping",
)
requireFields(
  canonicalTelemetryV2,
  [
    "gateway_uuid",
    "device_uuid",
    "parameter_uuid",
    "profile_version_uuid",
    "message_id",
    "runtime_bundle_hash",
  ],
  "v2 canonical telemetry",
)

const manifest = await readJson(manifestPath)
let failures = 0

for (const fixtureCase of manifest.cases) {
  const validate = ajv.getSchema(fixtureCase.schema_id)

  if (!validate) {
    throw new Error(`${fixtureCase.name}: unknown schema ${fixtureCase.schema_id}`)
  }

  const instancePath = join(contractsDirectory, fixtureCase.instance)
  const instance = await readJson(instancePath)
  const schemaValid = validate(instance)
  const semanticErrors = schemaValid ? await semanticErrorsFor(fixtureCase, instance) : []
  const actual = schemaValid && semanticErrors.length === 0

  for (const expectedCode of fixtureCase.expected_semantic_codes ?? []) {
    if (!semanticErrors.some((error) => error.startsWith(`${expectedCode}:`))) {
      failures += 1
      process.stderr.write(
        `${fixtureCase.name}: expected semantic diagnostic ${expectedCode}; received ${semanticErrors.join("; ") || "none"}\n`,
      )
    }
  }

  if (actual !== fixtureCase.valid) {
    failures += 1
    process.stderr.write(
      `${fixtureCase.name}: expected valid=${fixtureCase.valid}, received valid=${actual}; ${formatErrors(validate.errors)}; ${semanticErrors.join("; ")}\n`,
    )
  }
}

if (failures > 0) {
  process.exitCode = 1
} else {
  process.stdout.write(
    `Validated ${schemas.length} schemas and ${manifest.cases.length} fixture cases.\n`,
  )
}
