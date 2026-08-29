import type { components } from "./device-domain.generated"

export const deviceDomainVocabulary = {
  dataTypes: ["float64", "int64", "uint64", "boolean", "string", "bytes", "state"],
  propertyScopes: ["platform", "desired", "reported"],
  eventModes: ["stateless", "stateful"],
  eventSeverities: ["info", "notice", "warning", "critical"],
  commandModes: ["one_way", "two_way"],
  commandRisks: ["low", "medium", "high"],
  commandFieldDirections: ["input", "output"],
  commandOfflinePolicies: ["reject", "queue_until_expiry"],
  bindingPurposes: [
    "telemetry",
    "reported_properties",
    "desired_properties",
    "event",
    "command_request",
    "command_response",
  ],
  bindingDirections: ["device_to_platform", "platform_to_device"],
  pathScopes: ["message", "record", "route"],
  onMissingPolicies: ["reject_message", "omit_value", "use_default"],
  onInvalidPolicies: [
    "reject_message",
    "omit_value",
    "use_default",
    "clamp",
    "accept_with_bad_quality",
  ],
  inputWidgets: [
    "slider",
    "number_input",
    "switch",
    "select",
    "segmented_control",
    "text_input",
  ],
  displayWidgets: ["gauge", "value_card", "chart", "status_badge"],
  qualityStatuses: ["good", "uncertain", "bad"],
  calibrationOperations: [
    "multiply",
    "divide",
    "add",
    "subtract",
    "power",
    "clamp",
    "round",
    "cel",
  ],
  timestampFormats: ["rfc3339", "unix_seconds", "unix_milliseconds"],
} as const satisfies SharedVocabulary

export type DeviceDomainVocabularyAssertions = [
  Assert<Equal<(typeof deviceDomainVocabulary.dataTypes)[number], components["schemas"]["DataType"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.propertyScopes)[number], components["schemas"]["PropertyScope"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.eventModes)[number], components["schemas"]["EventMode"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.eventSeverities)[number], components["schemas"]["EventSeverity"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.commandModes)[number], components["schemas"]["CommandMode"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.commandRisks)[number], components["schemas"]["CommandRisk"]>>,
  Assert<
    Equal<
      (typeof deviceDomainVocabulary.commandFieldDirections)[number],
      components["schemas"]["CommandFieldDirection"]
    >
  >,
  Assert<
    Equal<
      (typeof deviceDomainVocabulary.commandOfflinePolicies)[number],
      components["schemas"]["CommandOfflinePolicy"]
    >
  >,
  Assert<Equal<(typeof deviceDomainVocabulary.bindingPurposes)[number], components["schemas"]["BindingPurpose"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.bindingDirections)[number], components["schemas"]["BindingDirection"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.pathScopes)[number], components["schemas"]["PathScope"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.onMissingPolicies)[number], components["schemas"]["OnMissingPolicy"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.onInvalidPolicies)[number], components["schemas"]["OnInvalidPolicy"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.inputWidgets)[number], components["schemas"]["InputWidget"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.displayWidgets)[number], components["schemas"]["DisplayWidget"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.qualityStatuses)[number], components["schemas"]["QualityStatus"]>>,
  Assert<
    Equal<
      (typeof deviceDomainVocabulary.calibrationOperations)[number],
      components["schemas"]["CalibrationOperation"]["op"]
    >
  >,
  Assert<Equal<(typeof deviceDomainVocabulary.timestampFormats)[number], components["schemas"]["TimestampFormat"]>>,
]

type SharedVocabulary = {
  dataTypes: readonly components["schemas"]["DataType"][]
  propertyScopes: readonly components["schemas"]["PropertyScope"][]
  eventModes: readonly components["schemas"]["EventMode"][]
  eventSeverities: readonly components["schemas"]["EventSeverity"][]
  commandModes: readonly components["schemas"]["CommandMode"][]
  commandRisks: readonly components["schemas"]["CommandRisk"][]
  commandFieldDirections: readonly components["schemas"]["CommandFieldDirection"][]
  commandOfflinePolicies: readonly components["schemas"]["CommandOfflinePolicy"][]
  bindingPurposes: readonly components["schemas"]["BindingPurpose"][]
  bindingDirections: readonly components["schemas"]["BindingDirection"][]
  pathScopes: readonly components["schemas"]["PathScope"][]
  onMissingPolicies: readonly components["schemas"]["OnMissingPolicy"][]
  onInvalidPolicies: readonly components["schemas"]["OnInvalidPolicy"][]
  inputWidgets: readonly components["schemas"]["InputWidget"][]
  displayWidgets: readonly components["schemas"]["DisplayWidget"][]
  qualityStatuses: readonly components["schemas"]["QualityStatus"][]
  calibrationOperations: readonly components["schemas"]["CalibrationOperation"]["op"][]
  timestampFormats: readonly components["schemas"]["TimestampFormat"][]
}

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
    ? true
    : false

type Assert<Condition extends true> = Condition
