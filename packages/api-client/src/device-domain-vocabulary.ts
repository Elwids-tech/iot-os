import type { components } from "./device-domain.generated"

type SharedVocabulary = {
  dataTypes: readonly components["schemas"]["DataType"][]
  propertyScopes: readonly components["schemas"]["PropertyScope"][]
  eventModes: readonly components["schemas"]["EventMode"][]
  eventSeverities: readonly components["schemas"]["EventSeverity"][]
  eventStates: readonly components["schemas"]["EventState"][]
  commandModes: readonly components["schemas"]["CommandMode"][]
  commandRisks: readonly components["schemas"]["CommandRisk"][]
  commandFieldDirections: readonly components["schemas"]["CommandFieldDirection"][]
  commandOfflinePolicies: readonly components["schemas"]["CommandOfflinePolicy"][]
  commandStatuses: readonly components["schemas"]["CommandStatus"][]
  bindingPurposes: readonly components["schemas"]["BindingPurpose"][]
  bindingDirections: readonly components["schemas"]["BindingDirection"][]
  pathScopes: readonly components["schemas"]["PathScope"][]
  missingPolicies: readonly components["schemas"]["MissingPolicy"][]
  timestampFormats: readonly components["schemas"]["TimestampFormat"][]
  definitionStates: readonly components["schemas"]["DefinitionState"][]
  deviceLifecycleStates: readonly components["schemas"]["DeviceLifecycleState"][]
}

export const deviceDomainVocabulary = {
  dataTypes: ["float64", "int64", "uint64", "boolean", "string", "bytes", "state"],
  propertyScopes: ["platform", "desired", "reported"],
  eventModes: ["stateless", "stateful"],
  eventSeverities: ["info", "notice", "warning", "critical"],
  eventStates: ["opened", "updated", "closed"],
  commandModes: ["one_way", "two_way"],
  commandRisks: ["low", "medium", "high"],
  commandFieldDirections: ["input", "output"],
  commandOfflinePolicies: ["reject", "queue_until_expiry"],
  commandStatuses: ["accepted", "running", "succeeded", "failed"],
  bindingPurposes: [
    "telemetry",
    "reported_properties",
    "desired_properties",
    "event",
    "command_request",
    "command_response",
  ],
  bindingDirections: ["device_to_platform", "platform_to_device"],
  pathScopes: ["payload", "record"],
  missingPolicies: ["reject_message", "omit_value", "use_default"],
  timestampFormats: ["rfc3339", "unix_seconds", "unix_milliseconds"],
  definitionStates: ["draft", "published", "retired"],
  deviceLifecycleStates: ["draft", "registered", "archived"],
} as const satisfies SharedVocabulary

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
    ? true
    : false

type Assert<Condition extends true> = Condition

export type DeviceDomainVocabularyAssertions = [
  Assert<Equal<(typeof deviceDomainVocabulary.dataTypes)[number], components["schemas"]["DataType"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.propertyScopes)[number], components["schemas"]["PropertyScope"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.eventModes)[number], components["schemas"]["EventMode"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.eventSeverities)[number], components["schemas"]["EventSeverity"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.eventStates)[number], components["schemas"]["EventState"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.commandModes)[number], components["schemas"]["CommandMode"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.commandRisks)[number], components["schemas"]["CommandRisk"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.commandFieldDirections)[number], components["schemas"]["CommandFieldDirection"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.commandOfflinePolicies)[number], components["schemas"]["CommandOfflinePolicy"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.commandStatuses)[number], components["schemas"]["CommandStatus"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.bindingPurposes)[number], components["schemas"]["BindingPurpose"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.bindingDirections)[number], components["schemas"]["BindingDirection"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.pathScopes)[number], components["schemas"]["PathScope"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.missingPolicies)[number], components["schemas"]["MissingPolicy"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.timestampFormats)[number], components["schemas"]["TimestampFormat"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.definitionStates)[number], components["schemas"]["DefinitionState"]>>,
  Assert<Equal<(typeof deviceDomainVocabulary.deviceLifecycleStates)[number], components["schemas"]["DeviceLifecycleState"]>>,
]
