import { useMemo, useState } from "react"
import type {
  DefinitionPreview,
  DefinitionPublicationResult,
  DeviceDefinitionAssignmentResource,
  DeviceDraftDocument,
  DeviceProfileDocument,
  DeviceProfileResource,
  DeviceResource,
  GatewayDocument,
  GatewayResource,
  GatewayRouteDocument,
  GatewayRouteResource,
  NativeMqttBindingDocument,
  NativeMqttBindingResource,
} from "@iot-os/api-client"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@iot-os/ui/components/accordion"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@iot-os/ui/components/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@iot-os/ui/components/select"
import { Spinner } from "@iot-os/ui/components/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { Textarea } from "@iot-os/ui/components/textarea"
import {
  AlertTriangleIcon,
  BracesIcon,
  CheckCircle2Icon,
  CpuIcon,
  FileCheck2Icon,
  GitBranchIcon,
  NetworkIcon,
  PlusIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  RocketIcon,
  RouteIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react"
import { apiClient } from "../lib/api-client"
import {
  AddButton,
  BooleanField,
  JsonPreview,
  JsonTextarea,
  StableId,
  TextField,
} from "./EditorPrimitives"
import { deviceDomainError } from "./errors"
import {
  compileRequest,
  createDevice,
  createGateway,
  createRoute,
  fixtureRequest,
  inboundScopesForBinding,
  resolveTopic,
  slugKey,
  type BindingChannel,
  type CompileFixture,
  type InboundScope,
} from "./model"

const NEW_GATEWAY = "__new_gateway__"

type FixtureDraft = {
  id: string
  name: string
  kind: CompileFixture["kind"]
  channel: string
  topic: string
  payload: string
  commandInput: string
}

type OnboardingFlowProps = {
  organizationUuid: string
  profiles: DeviceProfileResource[]
  bindings: NativeMqttBindingResource[]
  gateways: GatewayResource[]
  devices: DeviceResource[]
  routes: GatewayRouteResource[]
  onRefresh: () => Promise<void>
}

function profileDocument(resource: DeviceProfileResource | null): DeviceProfileDocument | null {
  if (!resource?.version) return null
  return { schema: resource.schema, profile: resource.profile, version: resource.version }
}

function bindingDocument(resource: NativeMqttBindingResource | null): NativeMqttBindingDocument | null {
  if (!resource?.version) return null
  return { schema: resource.schema, binding: resource.binding, version: resource.version }
}

function gatewayDocument(resource: GatewayResource): GatewayDocument {
  return { schema: resource.schema, gateway: resource.gateway }
}

function exampleValue(dataType: string): unknown {
  if (dataType === "boolean") return true
  if (dataType === "string" || dataType === "state") return "sample"
  if (dataType === "bytes") return "c2FtcGxl"
  return 0
}

function setSimpleJsonPath(target: Record<string, unknown>, jsonPath: string, value: unknown) {
  if (!/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*)+$/.test(jsonPath)) return
  const segments = jsonPath.slice(2).split(".")
  let current = target
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      current[segment] = value
      return
    }
    const next = current[segment]
    if (!next || typeof next !== "object" || Array.isArray(next)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  }
}

function samplePayload(binding: NativeMqttBindingDocument, channel: BindingChannel): unknown {
  const payload: Record<string, unknown> = {}

  for (const mapping of binding.version.parameter_mappings) {
    if (mapping.channel === channel.key) {
      setSimpleJsonPath(payload, mapping.source.json_path, exampleValue(mapping.wire_data_type))
    }
  }
  for (const mapping of binding.version.property_mappings) {
    if (mapping.channel === channel.key) {
      setSimpleJsonPath(payload, mapping.source.json_path, exampleValue(mapping.wire_data_type))
    }
  }
  for (const mapping of binding.version.event_mappings) {
    if (mapping.channel !== channel.key) continue
    for (const field of mapping.field_mappings) {
      setSimpleJsonPath(payload, field.source.json_path, exampleValue(field.wire_data_type))
    }
  }
  for (const mapping of binding.version.command_mappings) {
    if (mapping.response_channel !== channel.key) continue
    if (mapping.response) {
      setSimpleJsonPath(payload, mapping.response.correlation.json_path, "command-001")
      setSimpleJsonPath(payload, mapping.response.status.path.json_path, "succeeded")
    }
    for (const field of mapping.field_mappings.filter((item) => item.direction === "output")) {
      setSimpleJsonPath(payload, field.json_path, exampleValue(field.wire_data_type))
    }
  }

  return Object.keys(payload).length > 0 ? payload : { value: 0 }
}

function fixtureKind(channel: BindingChannel): CompileFixture["kind"] {
  if (channel.purpose === "event") return "event"
  if (channel.purpose === "reported_properties" || channel.purpose === "desired_properties") return "property"
  if (channel.purpose === "command_request") return "command_request"
  if (channel.purpose === "command_response") return "command_response"
  return "telemetry"
}

function fixtureDrafts(binding: NativeMqttBindingDocument): FixtureDraft[] {
  const inbound = binding.version.channels.filter((channel) => channel.direction === "device_to_platform")
  const channels = inbound.length > 0 ? inbound : binding.version.channels.slice(0, 1)

  return channels.map((channel) => ({
    id: crypto.randomUUID(),
    name: `${channel.label} sample`,
    kind: fixtureKind(channel),
    channel: channel.key,
    topic: "",
    payload: JSON.stringify(samplePayload(binding, channel), null, 2),
    commandInput: JSON.stringify(commandInput(binding, channel.key), null, 2),
  }))
}

function commandInput(binding: NativeMqttBindingDocument, channelKey: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const mapping of binding.version.command_mappings) {
    if (mapping.request_channel !== channelKey) continue
    for (const field of mapping.field_mappings.filter((item) => item.direction === "input")) {
      result[field.target_command_field_uuid] = exampleValue(field.wire_data_type)
    }
  }
  return result
}

function scalarText(value: unknown): string {
  return JSON.stringify(value)
}

function parseScalar(value: string): string | number | boolean | null {
  const parsed: unknown = JSON.parse(value)
  if (parsed === null || ["string", "number", "boolean"].includes(typeof parsed)) return parsed as string | number | boolean | null
  throw new Error("Selector value must be a JSON string, number, boolean, or null.")
}

function statusBadge(done: boolean, activeLabel: string, pendingLabel: string) {
  return <Badge variant={done ? "secondary" : "outline"}>{done ? activeLabel : pendingLabel}</Badge>
}

function PreviewResult({ preview, title }: { preview: DefinitionPreview; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {title}
          <Badge variant={preview.valid ? "secondary" : "destructive"}>
            {preview.valid ? "valid" : "invalid"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Input hash <span className="font-mono">{preview.input_hash}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {preview.diagnostics.length > 0 ? (
          <div className="flex flex-col gap-2">
            {preview.diagnostics.map((diagnostic, index) => (
              <Alert key={`${diagnostic.code}-${diagnostic.path}-${index}`} variant={diagnostic.severity === "error" ? "destructive" : "default"}>
                <AlertTriangleIcon />
                <AlertTitle>{diagnostic.code}</AlertTitle>
                <AlertDescription>
                  {diagnostic.message} <span className="font-mono">{diagnostic.path}</span>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        ) : (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>No compiler diagnostics</AlertTitle>
            <AlertDescription>The selected Profile, Binding, route, topics, and fixtures agree.</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Profile artifact</p>
            <p className="truncate font-mono text-xs">{preview.artifact_hashes.profile ?? "not emitted"}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Binding artifact</p>
            <p className="truncate font-mono text-xs">{preview.artifact_hashes.binding ?? "not emitted"}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Runtime Bundle</p>
            <p className="truncate font-mono text-xs">{preview.artifact_hashes.runtime_bundle ?? "not emitted"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function OnboardingFlow({
  organizationUuid,
  profiles,
  bindings,
  gateways,
  devices,
  routes,
  onRefresh,
}: OnboardingFlowProps) {
  const [flowId, setFlowId] = useState(() => crypto.randomUUID())
  const [profileUuid, setProfileUuid] = useState("")
  const [bindingUuid, setBindingUuid] = useState("")
  const [gatewayChoice, setGatewayChoice] = useState(NEW_GATEWAY)
  const [gatewayDraft, setGatewayDraft] = useState<GatewayDocument>(() => createGateway())
  const [deviceDraft, setDeviceDraft] = useState<DeviceDraftDocument>(() => createDevice())
  const [routeDraft, setRouteDraft] = useState<GatewayRouteDocument | null>(null)
  const [fixtures, setFixtures] = useState<FixtureDraft[]>([])
  const [definitionPreview, setDefinitionPreview] = useState<DefinitionPreview | null>(null)
  const [publication, setPublication] = useState<DefinitionPublicationResult | null>(null)
  const [savedGateway, setSavedGateway] = useState<GatewayResource | null>(null)
  const [savedDevice, setSavedDevice] = useState<DeviceResource | null>(null)
  const [savedRoute, setSavedRoute] = useState<GatewayRouteResource | null>(null)
  const [assignment, setAssignment] = useState<DeviceDefinitionAssignmentResource | null>(null)
  const [assignmentPreview, setAssignmentPreview] = useState<DefinitionPreview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedProfile =
    publication?.profile.profile.uuid === profileUuid
      ? publication.profile
      : profiles.find((profile) => profile.profile.uuid === profileUuid) ?? null
  const selectedBinding =
    publication?.binding.binding.uuid === bindingUuid
      ? publication.binding
      : bindings.find((binding) => binding.binding.uuid === bindingUuid) ?? null
  const profile = profileDocument(selectedProfile)
  const binding = bindingDocument(selectedBinding)
  const compatibleBindings = useMemo(
    () => bindings.filter((candidate) => candidate.binding.profile_uuid === profileUuid),
    [bindings, profileUuid],
  )
  const existingGateway =
    gatewayChoice === NEW_GATEWAY
      ? null
      : gateways.find((gateway) => gateway.gateway.uuid === gatewayChoice) ?? null
  const activeGateway = savedGateway
    ? gatewayDocument(savedGateway)
    : existingGateway
      ? gatewayDocument(existingGateway)
      : gatewayDraft
  const flowLocked = savedDevice !== null
  const definitionsPublished =
    selectedProfile?.meta.state === "published" && selectedBinding?.meta.state === "published"

  const resolvedChannels = useMemo(() => {
    if (!binding || !routeDraft) return []
    return binding.version.channels.map((channel) => ({
      ...channel,
      resolvedTopic: resolveTopic(channel.topic_template, organizationUuid, activeGateway, routeDraft),
    }))
  }, [activeGateway, binding, organizationUuid, routeDraft])

  function clearLifecycleResults() {
    setDefinitionPreview(null)
    setPublication(null)
    setSavedGateway(null)
    setSavedDevice(null)
    setSavedRoute(null)
    setAssignment(null)
    setAssignmentPreview(null)
    setError(null)
  }

  function initializeContext(nextProfile: DeviceProfileDocument, nextBinding: NativeMqttBindingDocument) {
    const nextDevice = {
      ...createDevice(),
      profile_version_uuid: nextProfile.version.uuid,
      binding_version_uuid: nextBinding.version.uuid,
    }
    const nextGateway = existingGateway ? gatewayDocument(existingGateway) : gatewayDraft
    setDeviceDraft(nextDevice)
    setRouteDraft(createRoute(nextGateway, nextDevice, nextProfile, nextBinding))
    setFixtures(fixtureDrafts(nextBinding))
    clearLifecycleResults()
  }

  function chooseProfile(uuid: string) {
    setProfileUuid(uuid)
    const nextProfile = profileDocument(profiles.find((item) => item.profile.uuid === uuid) ?? null)
    const nextBindingResource = bindings.find((item) => item.binding.profile_uuid === uuid && item.version)
    setBindingUuid(nextBindingResource?.binding.uuid ?? "")
    const nextBinding = bindingDocument(nextBindingResource ?? null)
    if (nextProfile && nextBinding) initializeContext(nextProfile, nextBinding)
    else {
      setRouteDraft(null)
      setFixtures([])
      clearLifecycleResults()
    }
  }

  function chooseBinding(uuid: string) {
    setBindingUuid(uuid)
    const nextBinding = bindingDocument(bindings.find((item) => item.binding.uuid === uuid) ?? null)
    if (profile && nextBinding) initializeContext(profile, nextBinding)
  }

  function chooseGateway(uuid: string) {
    setGatewayChoice(uuid)
    const nextGateway =
      uuid === NEW_GATEWAY
        ? gatewayDraft
        : gatewayDocument(gateways.find((item) => item.gateway.uuid === uuid)!)
    if (routeDraft) {
      setRouteDraft({
        ...routeDraft,
        route: { ...routeDraft.route, gateway_uuid: nextGateway.gateway.uuid },
      })
    }
    setDefinitionPreview(null)
    setError(null)
  }

  function changeRoute(next: GatewayRouteDocument) {
    setRouteDraft(next)
    setDefinitionPreview(null)
    setAssignmentPreview(null)
  }

  function preparedFixtures(): CompileFixture[] {
    if (!binding || !routeDraft) throw new Error("Select a Profile and Binding before compiling fixtures.")
    return fixtures.map((fixture) => {
      const channel = binding.version.channels.find((candidate) => candidate.key === fixture.channel)
      if (!channel) throw new Error(`Fixture ${fixture.name} references a missing Binding channel.`)
      const request: CompileFixture = {
        name: fixture.name,
        kind: fixture.kind,
        channel: fixture.channel,
        topic:
          fixture.topic.trim() ||
          resolveTopic(channel.topic_template, organizationUuid, activeGateway, routeDraft),
        payload: JSON.parse(fixture.payload),
      }
      if (fixture.kind === "command_request") {
        request.command_input = JSON.parse(fixture.commandInput) as Record<string, unknown>
      }
      return request
    })
  }

  function definitionRequest() {
    if (!profile || !binding || !routeDraft) {
      throw new Error("Select a saved Profile and compatible Binding first.")
    }
    return compileRequest(
      organizationUuid,
      profile,
      binding,
      activeGateway,
      routeDraft,
      preparedFixtures(),
    )
  }

  async function execute(action: string, work: () => Promise<void>) {
    setBusy(action)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(deviceDomainError(reason, action))
    } finally {
      setBusy(null)
    }
  }

  async function previewDefinitions() {
    await execute("Compile preview", async () => {
      setDefinitionPreview(await apiClient.previewDefinitionCompilation(definitionRequest()))
    })
  }

  async function publishDefinitions() {
    await execute("Publish definitions", async () => {
      if (!selectedProfile || !selectedBinding) throw new Error("Select saved definitions first.")
      if (!definitionPreview?.valid) throw new Error("Run a valid compile preview before publishing.")
      const result = await apiClient.publishDefinitionCompilation(
        definitionRequest(),
        selectedProfile.meta.etag,
        selectedBinding.meta.etag,
        `onboarding-${flowId}-publication`,
      )
      setPublication(result)
      setDefinitionPreview(result.compile)
      await onRefresh()
    })
  }

  async function persistRecords() {
    await execute("Create onboarding records", async () => {
      if (!profile || !binding || !routeDraft) throw new Error("Complete the definition and routing context first.")
      if (!definitionsPublished) throw new Error("Publish both definition versions before creating the Device assignment.")

      let gatewayResource = savedGateway ?? existingGateway
      if (!gatewayResource) {
        gatewayResource = await apiClient.createGateway(gatewayDraft, `onboarding-${flowId}-gateway`)
        setSavedGateway(gatewayResource)
      } else if (!savedGateway) {
        setSavedGateway(gatewayResource)
      }

      let deviceResource = savedDevice
      if (!deviceResource) {
        deviceResource = await apiClient.createDevice(
          {
            ...deviceDraft,
            profile_version_uuid: profile.version.uuid,
            binding_version_uuid: binding.version.uuid,
          },
          `onboarding-${flowId}-device`,
        )
        setSavedDevice(deviceResource)
      }

      let routeResource = savedRoute
      if (!routeResource) {
        const document: GatewayRouteDocument = {
          ...routeDraft,
          route: {
            ...routeDraft.route,
            gateway_uuid: gatewayResource.gateway.uuid,
            device_uuid: deviceResource.uuid,
            profile_version_uuid: profile.version.uuid,
            binding_version_uuid: binding.version.uuid,
          },
        }
        routeResource = await apiClient.createGatewayRoute(document, `onboarding-${flowId}-route`)
        setSavedRoute(routeResource)
      }

      setAssignment(await apiClient.deviceDefinitionAssignment(deviceResource.uuid))
      await onRefresh()
    })
  }

  async function compileAssignment() {
    await execute("Compile saved assignment", async () => {
      if (!savedDevice) throw new Error("Create the Device and Gateway Route first.")
      const preview = await apiClient.compileDeviceDefinition(
        savedDevice.uuid,
        fixtureRequest(preparedFixtures()),
      )
      setAssignmentPreview(preview)
    })
  }

  async function pinRuntimeBundle() {
    await execute("Pin Runtime Bundle", async () => {
      if (!savedDevice || !assignment) throw new Error("Load the saved Device assignment first.")
      if (!assignmentPreview?.valid) throw new Error("Compile a valid saved assignment before pinning.")
      const result = await apiClient.pinDeviceRuntimeBundle(
        savedDevice.uuid,
        fixtureRequest(preparedFixtures(), assignmentPreview.input_hash),
        assignment.etag,
        `onboarding-${flowId}-runtime`,
      )
      setAssignment(result.assignment)
      setAssignmentPreview(result.compile)
      await onRefresh()
    })
  }

  async function registerDevice() {
    await execute("Register Device", async () => {
      if (!savedDevice) throw new Error("Create the Device first.")
      if (!assignment?.runtime_bundle_hash) throw new Error("Pin a valid Runtime Bundle before registration.")
      const registered = await apiClient.registerDevice(
        savedDevice.uuid,
        savedDevice.etag,
        `onboarding-${flowId}-registration`,
      )
      setSavedDevice(registered)
      await onRefresh()
    })
  }

  function resetFlow() {
    const nextGateway = createGateway()
    setFlowId(crypto.randomUUID())
    setProfileUuid("")
    setBindingUuid("")
    setGatewayChoice(NEW_GATEWAY)
    setGatewayDraft(nextGateway)
    setDeviceDraft(createDevice())
    setRouteDraft(null)
    setFixtures([])
    clearLifecycleResults()
  }

  if (profiles.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CpuIcon /></EmptyMedia>
          <EmptyTitle>Create a Device Profile first</EmptyTitle>
          <EmptyDescription>Onboarding starts from a saved semantic Profile and its Native MQTT Binding.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><p className="text-sm text-muted-foreground">Use the Profile tab, then return here.</p></EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Gateway-routed Device onboarding
            <Badge variant="outline">{devices.length} Devices</Badge>
            <Badge variant="outline">{gateways.length} Gateways</Badge>
            <Badge variant="outline">{routes.length} Routes</Badge>
          </CardTitle>
          <CardDescription>
            The Gateway owns MQTT communication. Each route identifies one logical Device and maps shared hub payloads to its stable parameters.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" variant="outline" disabled={busy !== null} onClick={resetFlow}>
            <RefreshCwIcon data-icon="inline-start" />
            Start another onboarding
          </Button>
        </CardFooter>
      </Card>

      <Alert>
        <GitBranchIcon />
        <AlertTitle>Hub fan-out is a routing concern</AlertTitle>
        <AlertDescription>
          Reuse one Gateway for many logical Devices. Give each Device its own route path or an inbound selector such as <span className="font-mono">$.sensor_id == &quot;humidity-1&quot;</span>.
        </AlertDescription>
      </Alert>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Onboarding action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Accordion type="multiple" defaultValue={["definitions", "routing", "fixtures", "activation"]} className="flex flex-col gap-4">
        <AccordionItem value="definitions" className="rounded-xl border px-5">
          <AccordionTrigger>
            <span className="flex flex-wrap items-center gap-2">
              1. Select definitions
              {statusBadge(definitionsPublished, "published", "draft or unselected")}
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-5 pb-5">
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="onboarding-profile">Device Profile</FieldLabel>
                <Select value={profileUuid || undefined} onValueChange={chooseProfile} disabled={flowLocked}>
                  <SelectTrigger id="onboarding-profile" className="w-full"><SelectValue placeholder="Select a saved Profile" /></SelectTrigger>
                  <SelectContent><SelectGroup>{profiles.filter((item) => item.version).map((item) => (
                    <SelectItem key={item.profile.uuid} value={item.profile.uuid}>{item.profile.name} · {item.meta.state}</SelectItem>
                  ))}</SelectGroup></SelectContent>
                </Select>
                <FieldDescription>Semantic parameters, derived values, events, and Commands.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="onboarding-binding">Native MQTT Binding</FieldLabel>
                <Select value={bindingUuid || undefined} onValueChange={chooseBinding} disabled={!profile || flowLocked}>
                  <SelectTrigger id="onboarding-binding" className="w-full"><SelectValue placeholder="Select a compatible Binding" /></SelectTrigger>
                  <SelectContent><SelectGroup>{compatibleBindings.filter((item) => item.version).map((item) => (
                    <SelectItem key={item.binding.uuid} value={item.binding.uuid}>{item.binding.name} · {item.meta.state}</SelectItem>
                  ))}</SelectGroup></SelectContent>
                </Select>
                <FieldDescription>MQTT topics, JSON paths, calibration, and command payload placement.</FieldDescription>
              </Field>
            </FieldGroup>
            {profile && binding ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-4"><p className="font-medium">{profile.profile.name}</p><StableId value={profile.version.uuid} /></div>
                <div className="rounded-lg border p-4"><p className="font-medium">{binding.binding.name}</p><StableId value={binding.version.uuid} /></div>
              </div>
            ) : null}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="routing" className="rounded-xl border px-5">
          <AccordionTrigger>
            <span className="flex flex-wrap items-center gap-2">
              2. Define Gateway and logical Device route
              {statusBadge(Boolean(savedRoute), "saved", "authoring")}
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-6 pb-5">
            {!routeDraft || !profile || !binding ? (
              <Empty><EmptyHeader><EmptyMedia variant="icon"><RouteIcon /></EmptyMedia><EmptyTitle>Select definitions first</EmptyTitle><EmptyDescription>The route is created from the exact Profile and Binding Version UUIDs.</EmptyDescription></EmptyHeader></Empty>
            ) : (
              <>
                <fieldset disabled={flowLocked} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
                  <Card>
                  <CardHeader><CardTitle>Communication Gateway</CardTitle><CardDescription>Select an existing hub or create the MQTT communication identity once.</CardDescription></CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <Field>
                      <FieldLabel htmlFor="gateway-choice">Gateway</FieldLabel>
                      <Select value={gatewayChoice} onValueChange={chooseGateway} disabled={flowLocked}>
                        <SelectTrigger id="gateway-choice" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectGroup>
                          <SelectItem value={NEW_GATEWAY}>Create a new Gateway</SelectItem>
                          {gateways.map((gateway) => <SelectItem key={gateway.gateway.uuid} value={gateway.gateway.uuid}>{gateway.gateway.name} · {gateway.gateway.mqtt_client_id}</SelectItem>)}
                        </SelectGroup></SelectContent>
                      </Select>
                    </Field>
                    {gatewayChoice === NEW_GATEWAY ? (
                      <FieldGroup className="grid gap-4 md:grid-cols-2">
                        <TextField id="gateway-name" label="Gateway name" value={gatewayDraft.gateway.name} required placeholder="North plant hub" onChange={(name) => setGatewayDraft({ ...gatewayDraft, gateway: { ...gatewayDraft.gateway, name, key: gatewayDraft.gateway.key || slugKey(name) } })} />
                        <TextField id="gateway-key" label="Gateway key" value={gatewayDraft.gateway.key} required placeholder="north_plant_hub" onChange={(key) => setGatewayDraft({ ...gatewayDraft, gateway: { ...gatewayDraft.gateway, key: slugKey(key) } })} />
                        <TextField id="gateway-client-id" label="MQTT client ID" value={gatewayDraft.gateway.mqtt_client_id} required placeholder="north-hub-001" description="Broker identity used to resolve {gateway_id}." onChange={(mqtt_client_id) => setGatewayDraft({ ...gatewayDraft, gateway: { ...gatewayDraft.gateway, mqtt_client_id } })} />
                        <Field><FieldLabel htmlFor="gateway-description">Description</FieldLabel><Textarea id="gateway-description" value={gatewayDraft.gateway.description ?? ""} onChange={(event) => setGatewayDraft({ ...gatewayDraft, gateway: { ...gatewayDraft.gateway, description: event.target.value || null } })} /></Field>
                      </FieldGroup>
                    ) : null}
                    <StableId value={activeGateway.gateway.uuid} />
                  </CardContent>
                  </Card>

                  <Card>
                  <CardHeader><CardTitle>Logical Device</CardTitle><CardDescription>One platform identity with its own stable parameter UUIDs, independent of physical sensor packaging.</CardDescription></CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <FieldGroup className="grid gap-4 md:grid-cols-2">
                      <TextField id="device-name" label="Device name" value={deviceDraft.name} required placeholder="Line 1 three-phase meter" onChange={(name) => setDeviceDraft({ ...deviceDraft, name })} />
                      <TextField id="device-external-id" label="External ID" value={deviceDraft.external_id} required placeholder="meter-01" onChange={(external_id) => setDeviceDraft({ ...deviceDraft, external_id })} />
                      <Field className="md:col-span-2"><FieldLabel htmlFor="device-description">Description</FieldLabel><Textarea id="device-description" value={deviceDraft.description ?? ""} onChange={(event) => setDeviceDraft({ ...deviceDraft, description: event.target.value || null })} /></Field>
                    </FieldGroup>
                    {deviceDraft.uuid ? <StableId value={deviceDraft.uuid} /> : null}
                  </CardContent>
                  </Card>

                  <Card>
                  <CardHeader><CardTitle>Gateway Route</CardTitle><CardDescription>Resolve topic variables and optionally select this Device from a shared hub payload.</CardDescription></CardHeader>
                  <CardContent className="flex flex-col gap-6">
                    <FieldGroup className="grid gap-4 md:grid-cols-2">
                      <TextField id="route-path" label="Route path" value={routeDraft.route.route_path} required placeholder="meters/line-1/meter-01" description="Available as {route_path} in topic templates." onChange={(route_path) => changeRoute({ ...routeDraft, route: { ...routeDraft.route, route_path } })} />
                      <BooleanField id="route-enabled" label="Route enabled" checked={routeDraft.route.enabled} onChange={(enabled) => changeRoute({ ...routeDraft, route: { ...routeDraft.route, enabled } })} />
                    </FieldGroup>

                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Topic variables</p><p className="text-sm text-muted-foreground">Supply custom placeholders used by Binding topic templates.</p></div><AddButton onClick={() => {
                        const key = `variable_${Object.keys(routeDraft.route.topic_variables).length + 1}`
                        changeRoute({ ...routeDraft, route: { ...routeDraft.route, topic_variables: { ...routeDraft.route.topic_variables, [key]: "value" } } })
                      }}>Add variable</AddButton></div>
                      {Object.entries(routeDraft.route.topic_variables).map(([key, value]) => (
                        <FieldGroup key={key} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                          <TextField id={`topic-variable-${key}-key`} label="Variable" value={key} onChange={(nextKey) => {
                            const normalized = slugKey(nextKey)
                            if (!normalized || normalized === key) return
                            const next = { ...routeDraft.route.topic_variables }
                            delete next[key]
                            next[normalized] = value
                            changeRoute({ ...routeDraft, route: { ...routeDraft.route, topic_variables: next } })
                          }} />
                          <TextField id={`topic-variable-${key}-value`} label="Value" value={value} onChange={(nextValue) => changeRoute({ ...routeDraft, route: { ...routeDraft.route, topic_variables: { ...routeDraft.route.topic_variables, [key]: nextValue } } })} />
                          <Button type="button" size="icon" variant="outline" aria-label={`Remove ${key}`} onClick={() => {
                            const next = { ...routeDraft.route.topic_variables }
                            delete next[key]
                            changeRoute({ ...routeDraft, route: { ...routeDraft.route, topic_variables: next } })
                          }}><Trash2Icon /></Button>
                        </FieldGroup>
                      ))}
                    </div>

                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Inbound scopes</p><p className="text-sm text-muted-foreground">Payload paths and selectors route shared Gateway messages to this logical Device.</p></div><Button type="button" variant="outline" size="sm" onClick={() => changeRoute({ ...routeDraft, route: { ...routeDraft.route, inbound_scopes: inboundScopesForBinding(binding) } })}><RefreshCwIcon data-icon="inline-start" />Synchronize channels</Button></div>
                      {routeDraft.route.inbound_scopes.map((scope, index) => (
                        <Card key={`${scope.channel}-${index}`}>
                          <CardHeader><CardTitle className="text-base">{scope.channel}</CardTitle><CardDescription>Inbound channel scope {index + 1}</CardDescription></CardHeader>
                          <CardContent className="flex flex-col gap-4">
                            <FieldGroup className="grid gap-4 md:grid-cols-2">
                              <Field><FieldLabel htmlFor={`scope-${index}-channel`}>Channel</FieldLabel><Select value={scope.channel} onValueChange={(channel) => {
                                const next = routeDraft.route.inbound_scopes.map((item, itemIndex) => itemIndex === index ? { ...item, channel } : item)
                                changeRoute({ ...routeDraft, route: { ...routeDraft.route, inbound_scopes: next } })
                              }}><SelectTrigger id={`scope-${index}-channel`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{binding.version.channels.filter((channel) => channel.direction === "device_to_platform").map((channel) => <SelectItem key={channel.key} value={channel.key}>{channel.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
                              <TextField id={`scope-${index}-payload`} label="Route payload JSONPath" value={scope.payload_path} required placeholder="$" onChange={(payload_path) => {
                                const next = routeDraft.route.inbound_scopes.map((item, itemIndex) => itemIndex === index ? { ...item, payload_path } : item)
                                changeRoute({ ...routeDraft, route: { ...routeDraft.route, inbound_scopes: next } })
                              }} />
                            </FieldGroup>
                            <BooleanField id={`scope-${index}-selector-enabled`} label="Use a payload selector" checked={Boolean(scope.selector)} description="Use this when many logical Devices share one Gateway topic." onChange={(enabled) => {
                              const nextScope: InboundScope = enabled ? { ...scope, selector: { source: { scope: "message", json_path: "$.sensor_id" }, equals: "sensor-1" } } : { channel: scope.channel, payload_path: scope.payload_path }
                              const next = routeDraft.route.inbound_scopes.map((item, itemIndex) => itemIndex === index ? nextScope : item)
                              changeRoute({ ...routeDraft, route: { ...routeDraft.route, inbound_scopes: next } })
                            }} />
                            {scope.selector ? <FieldGroup className="grid gap-4 md:grid-cols-3">
                              <Field><FieldLabel htmlFor={`scope-${index}-selector-scope`}>Selector scope</FieldLabel><Select value={scope.selector.source.scope} onValueChange={(sourceScope: "message" | "record" | "route") => {
                                const next = routeDraft.route.inbound_scopes.map((item, itemIndex) => itemIndex === index && item.selector ? { ...item, selector: { ...item.selector, source: { ...item.selector.source, scope: sourceScope } } } : item)
                                changeRoute({ ...routeDraft, route: { ...routeDraft.route, inbound_scopes: next } })
                              }}><SelectTrigger id={`scope-${index}-selector-scope`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["message", "record", "route"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
                              <TextField id={`scope-${index}-selector-path`} label="Selector JSONPath" value={scope.selector.source.json_path} required onChange={(json_path) => {
                                const next = routeDraft.route.inbound_scopes.map((item, itemIndex) => itemIndex === index && item.selector ? { ...item, selector: { ...item.selector, source: { ...item.selector.source, json_path } } } : item)
                                changeRoute({ ...routeDraft, route: { ...routeDraft.route, inbound_scopes: next } })
                              }} />
                              <TextField id={`scope-${index}-selector-equals`} label="Equals JSON scalar" value={scalarText(scope.selector.equals)} required onChange={(value) => {
                                try {
                                  const equals = parseScalar(value)
                                  const next = routeDraft.route.inbound_scopes.map((item, itemIndex) => itemIndex === index && item.selector ? { ...item, selector: { ...item.selector, equals } } : item)
                                  changeRoute({ ...routeDraft, route: { ...routeDraft.route, inbound_scopes: next } })
                                } catch {
                                  // Preserve the last valid scalar while the user is typing.
                                }
                              }} />
                            </FieldGroup> : null}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </CardContent>
                  </Card>
                </fieldset>

                <Card>
                  <CardHeader><CardTitle>Resolved MQTT topics</CardTitle><CardDescription>Preview the exact Gateway and logical Device topics before compiling.</CardDescription></CardHeader>
                  <CardContent>
                    <Table><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Direction</TableHead><TableHead>Resolved topic</TableHead></TableRow></TableHeader><TableBody>{resolvedChannels.map((channel) => (
                      <TableRow key={channel.uuid}><TableCell><div className="flex flex-col"><span className="font-medium">{channel.label}</span><span className="text-xs text-muted-foreground">{channel.purpose}</span></div></TableCell><TableCell>{channel.direction}</TableCell><TableCell className="break-all font-mono text-xs">{channel.resolvedTopic}</TableCell></TableRow>
                    ))}</TableBody></Table>
                  </CardContent>
                </Card>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="fixtures" className="rounded-xl border px-5">
          <AccordionTrigger>
            <span className="flex flex-wrap items-center gap-2">3. Test real payload fixtures <Badge variant="outline">{fixtures.length}</Badge></span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-5 pb-5">
            {!binding || !routeDraft ? <Empty><EmptyHeader><EmptyMedia variant="icon"><BracesIcon /></EmptyMedia><EmptyTitle>No Binding selected</EmptyTitle><EmptyDescription>Fixtures are generated from inbound Binding channels.</EmptyDescription></EmptyHeader></Empty> : <>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Edit representative Gateway JSON. Compile preview proves extraction, calibration, constraints, derivation, and route selection.</p><AddButton onClick={() => {
                const channel = binding.version.channels.find((item) => item.direction === "device_to_platform") ?? binding.version.channels[0]
                if (!channel) return
                setFixtures([...fixtures, { id: crypto.randomUUID(), name: `${channel.label} sample ${fixtures.length + 1}`, kind: fixtureKind(channel), channel: channel.key, topic: "", payload: JSON.stringify(samplePayload(binding, channel), null, 2), commandInput: JSON.stringify(commandInput(binding, channel.key), null, 2) }])
              }}>Add fixture</AddButton></div>
              {fixtures.map((fixture, index) => (
                <Card key={fixture.id}>
                  <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2"><span>{fixture.name || `Fixture ${index + 1}`}</span><Button type="button" variant="outline" size="icon" aria-label={`Remove fixture ${index + 1}`} disabled={fixtures.length === 1} onClick={() => setFixtures(fixtures.filter((item) => item.id !== fixture.id))}><Trash2Icon /></Button></CardTitle><CardDescription>Fixture {index + 1}</CardDescription></CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <FieldGroup className="grid gap-4 md:grid-cols-3">
                      <TextField id={`${fixture.id}-name`} label="Fixture name" value={fixture.name} required onChange={(name) => setFixtures(fixtures.map((item) => item.id === fixture.id ? { ...item, name } : item))} />
                      <Field><FieldLabel htmlFor={`${fixture.id}-kind`}>Kind</FieldLabel><Select value={fixture.kind} onValueChange={(kind: FixtureDraft["kind"]) => setFixtures(fixtures.map((item) => item.id === fixture.id ? { ...item, kind } : item))}><SelectTrigger id={`${fixture.id}-kind`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["telemetry", "event", "property", "command_request", "command_response"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
                      <Field><FieldLabel htmlFor={`${fixture.id}-channel`}>Channel</FieldLabel><Select value={fixture.channel} onValueChange={(channel) => setFixtures(fixtures.map((item) => item.id === fixture.id ? { ...item, channel } : item))}><SelectTrigger id={`${fixture.id}-channel`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{binding.version.channels.map((channel) => <SelectItem key={channel.key} value={channel.key}>{channel.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
                    </FieldGroup>
                    <TextField id={`${fixture.id}-topic`} label="Topic override" value={fixture.topic} placeholder="Leave blank to use the resolved channel topic" onChange={(topic) => setFixtures(fixtures.map((item) => item.id === fixture.id ? { ...item, topic } : item))} />
                    <JsonTextarea id={`${fixture.id}-payload`} label="Gateway JSON payload" value={fixture.payload} rows={10} description="This is the compact payload sent by the Gateway. Profile metadata is not transmitted." onChange={(payload) => setFixtures(fixtures.map((item) => item.id === fixture.id ? { ...item, payload } : item))} />
                    {fixture.kind === "command_request" ? (
                      <JsonTextarea id={`${fixture.id}-command-input`} label="Semantic Command input" value={fixture.commandInput} rows={6} description="Keys are stable Command field UUIDs. The Binding encodes only their values into the MQTT request payload." onChange={(commandInput) => setFixtures(fixtures.map((item) => item.id === fixture.id ? { ...item, commandInput } : item))} />
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </>}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="activation" className="rounded-xl border px-5">
          <AccordionTrigger>
            <span className="flex flex-wrap items-center gap-2">4. Validate, publish, and register {statusBadge(savedDevice?.lifecycle_state === "registered", "registered", "not registered")}</span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-6 pb-5">
            <Card>
              <CardHeader><CardTitle>Definition lifecycle</CardTitle><CardDescription>Preview drafts first. Publishing is atomic and makes both selected versions immutable.</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" disabled={!profile || !binding || !routeDraft || fixtures.length === 0 || busy !== null || flowLocked} onClick={() => void previewDefinitions()}>
                  {busy === "Compile preview" ? <Spinner data-icon="inline-start" /> : <FileCheck2Icon data-icon="inline-start" />}Compile preview
                </Button>
                <Button type="button" disabled={!definitionPreview?.valid || definitionsPublished || busy !== null || flowLocked} onClick={() => void publishDefinitions()}>
                  {busy === "Publish definitions" ? <Spinner data-icon="inline-start" /> : <RocketIcon data-icon="inline-start" />}Publish Profile and Binding
                </Button>
                {definitionsPublished ? <Badge variant="secondary">Definitions published</Badge> : null}
              </CardContent>
            </Card>
            {definitionPreview ? <PreviewResult preview={definitionPreview} title="Draft-context compile" /> : null}

            <Card>
              <CardHeader><CardTitle>Persist onboarding context</CardTitle><CardDescription>Create or reuse the Gateway, create the logical Device, and attach its exact Gateway Route.</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button type="button" disabled={!definitionsPublished || !routeDraft || busy !== null || Boolean(savedRoute)} onClick={() => void persistRecords()}>
                  {busy === "Create onboarding records" ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}Create Gateway, Device, and Route
                </Button>
                {savedRoute ? <Badge variant="secondary">Route saved</Badge> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Compile and pin the exact assignment</CardTitle><CardDescription>Recompile persisted revisions, pin the immutable Runtime Bundle hash, then explicitly register the Device.</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" disabled={!assignment || busy !== null} onClick={() => void compileAssignment()}>
                  {busy === "Compile saved assignment" ? <Spinner data-icon="inline-start" /> : <NetworkIcon data-icon="inline-start" />}Compile saved assignment
                </Button>
                <Button type="button" disabled={!assignmentPreview?.valid || !assignment || Boolean(assignment.runtime_bundle_hash) || busy !== null} onClick={() => void pinRuntimeBundle()}>
                  {busy === "Pin Runtime Bundle" ? <Spinner data-icon="inline-start" /> : <RadioTowerIcon data-icon="inline-start" />}Pin Runtime Bundle
                </Button>
                <Button type="button" disabled={!assignment?.runtime_bundle_hash || savedDevice?.lifecycle_state === "registered" || busy !== null} onClick={() => void registerDevice()}>
                  {busy === "Register Device" ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}Register Device
                </Button>
              </CardContent>
              {assignment ? <CardFooter className="flex flex-wrap gap-2"><Badge variant="outline">Assignment revision {assignment.revision}</Badge>{assignment.runtime_bundle_hash ? <Badge variant="secondary">Bundle pinned</Badge> : <Badge variant="outline">Bundle not pinned</Badge>}{savedDevice ? <Badge variant="outline">Device {savedDevice.lifecycle_state}</Badge> : null}</CardFooter> : null}
            </Card>
            {assignmentPreview ? <PreviewResult preview={assignmentPreview} title="Persisted-assignment compile" /> : null}
            {savedDevice?.lifecycle_state === "registered" ? (
              <Alert>
                <CheckCircle2Icon />
                <AlertTitle>{savedDevice.name} is registered</AlertTitle>
                <AlertDescription>The logical Device is pinned to Runtime Bundle <span className="font-mono">{assignment?.runtime_bundle_hash}</span>. Broker credentials and live EMQX ingestion remain separate milestones.</AlertDescription>
              </Alert>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {profile && binding && routeDraft ? (
        <JsonPreview title="Onboarding context JSON" description="Read-only canonical request context. UUIDs remain stable while the form changes." value={{ gateway: activeGateway, device: deviceDraft, route: routeDraft, fixtures: fixtures.map(({ id: _id, payload, commandInput, ...fixture }) => ({ ...fixture, payload: (() => { try { return JSON.parse(payload) } catch { return payload } })(), ...(fixture.kind === "command_request" ? { command_input: (() => { try { return JSON.parse(commandInput) } catch { return commandInput } })() } : {}) })) }} testId="onboarding-json-preview" />
      ) : null}
    </div>
  )
}
