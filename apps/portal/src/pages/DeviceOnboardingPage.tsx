import { type FormEvent, useEffect, useState } from "react"
import { ApiError, type Device, type Organization } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { Spinner } from "@iot-os/ui/components/spinner"
import { Textarea } from "@iot-os/ui/components/textarea"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleIcon,
  CpuIcon,
  FileCode2Icon,
} from "lucide-react"
import { Link, useOutletContext, useSearchParams } from "react-router-dom"
import { PageHeading, PageLoading } from "../components/PageStates"
import {
  loadDefinitionCatalog,
  publishedDefinitions,
  type DefinitionCatalogEntry,
} from "../device-domain/catalog"
import {
  clearDeviceDraft,
  loadDeviceDraft,
  saveDeviceDraft,
} from "../device-domain/draft-storage"
import { apiClient } from "../lib/api-client"

type Operation = "idle" | "creating" | "assigning" | "registering"

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.payload && typeof error.payload === "object") {
    const payload = error.payload as { detail?: unknown; message?: unknown }
    const value = payload.detail ?? payload.message

    if (typeof value === "string") return value
  }

  if (error instanceof Error) return error.message

  return "Device onboarding could not be completed. Review the current step and try again."
}

function OnboardingStep({
  label,
  complete,
  active,
}: {
  label: string
  complete: boolean
  active: boolean
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      {active ? (
        <Spinner className="text-muted-foreground" />
      ) : complete ? (
        <CheckCircle2Icon className="size-4 text-foreground" />
      ) : (
        <CircleIcon className="size-4 text-muted-foreground" />
      )}
      <span className={complete || active ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </li>
  )
}

export function DeviceOnboardingPage() {
  const organization = useOutletContext<Organization>()
  const [searchParams] = useSearchParams()
  const requestedDefinition = searchParams.get("definition")
  const [definitions, setDefinitions] = useState<DefinitionCatalogEntry[] | null>(null)
  const [name, setName] = useState("")
  const [externalId, setExternalId] = useState("")
  const [description, setDescription] = useState("")
  const [bindingVersionUuid, setBindingVersionUuid] = useState("")
  const [operation, setOperation] = useState<Operation>("idle")
  const [device, setDevice] = useState<Device | null>(null)
  const [completedDevice, setCompletedDevice] = useState<Device | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let active = true
    const stored = loadDeviceDraft(organization.uuid)

    setDefinitions(null)
    setName(stored?.name ?? "")
    setExternalId(stored?.externalId ?? "")
    setDescription(stored?.description ?? "")
    setBindingVersionUuid("")
    setDevice(null)
    setCompletedDevice(null)
    setError(null)
    setHydrated(false)

    Promise.all([
      loadDefinitionCatalog(),
      stored?.deviceUuid ? apiClient.device(stored.deviceUuid).catch(() => null) : Promise.resolve(null),
    ])
      .then(([catalog, storedDevice]) => {
        if (!active) return
        const published = publishedDefinitions(catalog)
        const requested = published.find(
          (entry) => entry.bindingVersion.uuid === requestedDefinition,
        )
        const storedDefinition = published.find(
          (entry) => entry.bindingVersion.uuid === stored?.bindingVersionUuid,
        )
        setDefinitions(published)
        setBindingVersionUuid(
          requested?.bindingVersion.uuid ??
            storedDefinition?.bindingVersion.uuid ??
            published[0]?.bindingVersion.uuid ??
            "",
        )
        setDevice(storedDevice)
        if (storedDevice?.lifecycle_state === "registered") {
          setCompletedDevice(storedDevice)
          clearDeviceDraft(organization.uuid)
        }
        setHydrated(true)
      })
      .catch(() => {
        if (!active) return
        setDefinitions([])
        setError("Published Device definitions could not be loaded for this Organization.")
        setHydrated(true)
      })

    return () => {
      active = false
    }
  }, [organization.uuid, requestedDefinition])

  useEffect(() => {
    if (!hydrated || completedDevice) return

    saveDeviceDraft(organization.uuid, {
      name,
      externalId,
      description,
      bindingVersionUuid,
      deviceUuid: device?.uuid,
    })
  }, [
    bindingVersionUuid,
    completedDevice,
    description,
    device?.uuid,
    externalId,
    hydrated,
    name,
    organization.uuid,
  ])

  const selected = definitions?.find(
    (entry) => entry.bindingVersion.uuid === bindingVersionUuid,
  )
  const assignmentComplete = Boolean(device?.definition_assignment)
  const registrationComplete = completedDevice?.lifecycle_state === "registered"

  async function onboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selected) {
      setError("Select a published Device definition before onboarding.")
      return
    }

    setError(null)
    let current = device

    try {
      if (!current) {
        setOperation("creating")
        current = await apiClient.createDeviceDraft({
          name: name.trim(),
          external_id: externalId.trim(),
          description: description.trim() || null,
        })
        setDevice(current)
      }

      if (!current.definition_assignment) {
        setOperation("assigning")
        await apiClient.assignDeviceDefinition(
          current.uuid,
          selected.profileVersion.uuid,
          selected.bindingVersion.uuid,
          current.etag,
        )
        current = await apiClient.device(current.uuid)
        setDevice(current)
      }

      if (
        current.definition_assignment?.profile_version_uuid !== selected.profileVersion.uuid ||
        current.definition_assignment.binding_version_uuid !== selected.bindingVersion.uuid
      ) {
        throw new Error("The Device draft is assigned to a different immutable definition.")
      }

      if (current.lifecycle_state === "draft") {
        setOperation("registering")
        current = await apiClient.registerDevice(current.uuid, current.etag)
        setDevice(current)
      }

      setCompletedDevice(current)
      clearDeviceDraft(organization.uuid)
    } catch (onboardingError) {
      if (current) {
        try {
          current = await apiClient.device(current.uuid)
          setDevice(current)
        } catch {
          // Preserve the last known Device draft when the refresh also fails.
        }
      }
      setError(errorMessage(onboardingError))
    } finally {
      setOperation("idle")
    }
  }

  if (!definitions) {
    return (
      <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
        <PageHeading
          title="Onboard Device"
          description="Loading published Device definitions for this Organization."
        />
        <PageLoading label="Loading onboarding workspace…" />
      </section>
    )
  }

  if (completedDevice) {
    return (
      <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
        <PageHeading
          title="Device registered"
          description="The Device now pins the exact published Profile and Binding Versions selected during onboarding."
        />
        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <CheckCircle2Icon className="size-5" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle>{completedDevice.name}</CardTitle>
                <CardDescription className="font-mono">
                  {completedDevice.external_id}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Lifecycle: </span>
              <span className="font-medium">{completedDevice.lifecycle_state}</span>
            </div>
            <div className="break-all">
              <span className="text-muted-foreground">Device UUID: </span>
              <span className="font-mono text-xs">{completedDevice.uuid}</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button asChild>
              <Link to={`/organizations/${organization.uuid}/devices`}>View Device registry</Link>
            </Button>
          </CardFooter>
        </Card>
      </section>
    )
  }

  const busy = operation !== "idle"

  return (
    <form className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6" onSubmit={onboard}>
      <PageHeading
        title="Onboard Device"
        description="Create one tenant-owned Device identity, assign immutable semantics and transport mapping, then register it explicitly."
        actions={
          <Button type="submit" disabled={busy || !selected}>
            {busy ? <Spinner data-icon="inline-start" /> : <CpuIcon />}
            {device ? "Continue onboarding" : "Onboard Device"}
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Onboarding needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {definitions.length === 0 ? (
        <Alert>
          <FileCode2Icon />
          <AlertTitle>No published Device definition is available</AlertTitle>
          <AlertDescription>
            <span>Validate and publish a coordinated Profile and Binding before onboarding.</span>{" "}
            <Link
              className="font-medium underline underline-offset-4"
              to={`/organizations/${organization.uuid}/definitions/new`}
            >
              Create a definition
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Device identity and definition</CardTitle>
            <CardDescription>
              External ID must match the identity represented by {"{device_id}"} in MQTT topics and
              payloads.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="device-name">Device name</FieldLabel>
                <Input
                  id="device-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={Boolean(device)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="external-id">External Device ID</FieldLabel>
                <Input
                  id="external-id"
                  className="font-mono"
                  value={externalId}
                  onChange={(event) => setExternalId(event.target.value)}
                  disabled={Boolean(device)}
                  required
                />
                <FieldDescription>Example: sensor-001</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="device-description">Description</FieldLabel>
                <Textarea
                  id="device-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={Boolean(device)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="definition">Published Device definition</FieldLabel>
                <Select
                  value={bindingVersionUuid}
                  onValueChange={setBindingVersionUuid}
                  disabled={Boolean(device) || definitions.length === 0}
                  required
                >
                  <SelectTrigger id="definition" className="w-full">
                    <SelectValue placeholder="Select a published definition" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Published Profile and Binding Versions</SelectLabel>
                      {definitions.map((entry) => (
                        <SelectItem
                          key={entry.bindingVersion.uuid}
                          value={entry.bindingVersion.uuid}
                        >
                          {entry.profile.name} · {entry.binding.name} · v
                          {entry.bindingVersion.version}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {selected ? (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <div className="font-medium">{selected.profile.name}</div>
                  <div className="mt-1 text-muted-foreground">{selected.binding.name}</div>
                  <div className="mt-3 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                    <span>Profile Version: {selected.profileVersion.uuid}</span>
                    <span>Binding Version: {selected.bindingVersion.uuid}</span>
                  </div>
                </div>
              ) : null}
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Registration sequence</CardTitle>
            <CardDescription>
              Each mutation uses the latest Device revision ETag.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              <OnboardingStep
                label="Create Device draft"
                complete={Boolean(device)}
                active={operation === "creating"}
              />
              <OnboardingStep
                label="Assign definition Versions"
                complete={assignmentComplete}
                active={operation === "assigning"}
              />
              <OnboardingStep
                label="Register Device"
                complete={registrationComplete}
                active={operation === "registering"}
              />
            </ol>
          </CardContent>
          <CardFooter className="border-t text-xs text-muted-foreground">
            Broker credentials, live ingestion, and Command delivery are separate later milestones.
          </CardFooter>
        </Card>
      </div>
    </form>
  )
}
