import { useMemo, useState } from "react"
import type {
  CompiledDeviceProfileDefinition,
  DeviceProfileParameter,
} from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { Switch } from "@iot-os/ui/components/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { Textarea } from "@iot-os/ui/components/textarea"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react"
import rgbLightFixture from "@contracts/definitions/device-profiles/rgb-light.v1.json"
import threePhaseEnergyMeterFixture from "@contracts/definitions/device-profiles/three-phase-energy-meter.v1.json"

const fixtures = [
  rgbLightFixture as unknown as CompiledDeviceProfileDefinition,
  threePhaseEnergyMeterFixture as unknown as CompiledDeviceProfileDefinition,
]

type ValidationState =
  | { state: "idle" }
  | { state: "valid"; count: number }
  | { state: "invalid"; messages: string[] }

type NewParameter = {
  key: string
  label: string
  dataType: DeviceProfileParameter["data_type"]
}

const emptyParameter: NewParameter = { key: "", label: "", dataType: "number" }

function cloneDefinition(definition: CompiledDeviceProfileDefinition): CompiledDeviceProfileDefinition {
  return structuredClone(definition)
}

function definitionDiagnostics(definition: CompiledDeviceProfileDefinition): string[] {
  const messages: string[] = []
  const uuids = new Set<string>()
  const keys = new Set<string>()

  for (const parameter of definition.parameters) {
    if (uuids.has(parameter.uuid)) messages.push("Each parameter must have a stable unique UUID.")
    if (keys.has(parameter.key)) messages.push("Each parameter key must be unique in a profile.")
    if (parameter.kind === "derived" && parameter.accepts_command) {
      messages.push(`${parameter.label} is derived and cannot accept commands.`)
    }
    uuids.add(parameter.uuid)
    keys.add(parameter.key)
  }

  const derivedTargets = new Set(definition.calculations.map((calculation) => calculation.target_parameter_uuid))
  for (const targetUuid of derivedTargets) {
    const target = definition.parameters.find((parameter) => parameter.uuid === targetUuid)
    if (!target || target.kind !== "derived") {
      messages.push("Each calculation target must be a derived parameter in this profile.")
    }
  }

  return [...new Set(messages)]
}

export function DeviceProfilesPage() {
  const [profile, setProfile] = useState(() => cloneDefinition(fixtures[0]))
  const [selectedParameterUuid, setSelectedParameterUuid] = useState(profile.parameters[0]?.uuid ?? "")
  const [search, setSearch] = useState("")
  const [validation, setValidation] = useState<ValidationState>({ state: "idle" })
  const [published, setPublished] = useState(false)
  const [newParameter, setNewParameter] = useState<NewParameter>(emptyParameter)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  const selectedParameter = profile.parameters.find(
    (parameter) => parameter.uuid === selectedParameterUuid,
  )
  const visibleParameters = useMemo(
    () =>
      profile.parameters.filter((parameter) =>
        `${parameter.label} ${parameter.key}`.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [profile.parameters, search],
  )
  const calculationMessages = useMemo(() => definitionDiagnostics(profile), [profile])

  function chooseFixture(uuid: string) {
    const next = fixtures.find((fixture) => fixture.profile.uuid === uuid)
    if (!next) return

    const definition = cloneDefinition(next)
    setProfile(definition)
    setSelectedParameterUuid(definition.parameters[0]?.uuid ?? "")
    setValidation({ state: "idle" })
    setPublished(false)
  }

  function updateParameter(uuid: string, update: Partial<DeviceProfileParameter>) {
    setProfile((current) => ({
      ...current,
      parameters: current.parameters.map((parameter) =>
        parameter.uuid === uuid ? { ...parameter, ...update } : parameter,
      ),
    }))
    setPublished(false)
    setValidation({ state: "idle" })
  }

  function reorder(uuid: string, direction: -1 | 1) {
    setProfile((current) => {
      const index = current.parameters.findIndex((parameter) => parameter.uuid === uuid)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.parameters.length) return current

      const parameters = [...current.parameters]
      ;[parameters[index], parameters[targetIndex]] = [parameters[targetIndex], parameters[index]]

      return { ...current, parameters }
    })
    setPublished(false)
  }

  function runValidation() {
    const messages = definitionDiagnostics(profile)
    setValidation(messages.length === 0 ? { state: "valid", count: profile.parameters.length } : { state: "invalid", messages })
  }

  function addParameter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const key = newParameter.key.trim()
    const label = newParameter.label.trim()
    if (!key || !label) return

    const parameter: DeviceProfileParameter = {
      uuid: crypto.randomUUID(),
      key,
      label,
      kind: "measurement",
      data_type: newParameter.dataType,
      format: null,
      unit: null,
      reports_state: true,
      accepts_command: false,
      validation: null,
      display: null,
      reporting: null,
      counter: null,
    }
    setProfile((current) => ({ ...current, parameters: [...current.parameters, parameter] }))
    setSelectedParameterUuid(parameter.uuid)
    setNewParameter(emptyParameter)
    setIsAddDialogOpen(false)
    setPublished(false)
    setValidation({ state: "idle" })
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Device profiles</h1>
          <p className="text-sm text-muted-foreground">
            Contract-driven authoring mock using the same immutable artifacts as Laravel and runtime tests.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={published ? "default" : "secondary"}>{published ? "Published" : "Draft"}</Badge>
          <Button variant="outline" onClick={runValidation}>
            <CheckCircle2Icon data-icon="inline-start" />
            Run validation
          </Button>
          <Button disabled={validation.state !== "valid"} onClick={() => setPublished(true)}>
            <UploadIcon data-icon="inline-start" />
            Publish revision {profile.profile.revision}
          </Button>
        </div>
      </div>

      <Alert>
        <CircleAlertIcon />
        <AlertTitle>Protocol-neutral authoring</AlertTitle>
        <AlertDescription>
          This definition contains parameters, validation, calculations, and alarm suggestions only. Transport locators are managed by separate bindings.
        </AlertDescription>
      </Alert>

      {validation.state === "valid" ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Definition is ready to publish</AlertTitle>
          <AlertDescription>{validation.count} parameter identities and calculation targets are valid.</AlertDescription>
        </Alert>
      ) : null}
      {validation.state === "invalid" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Fix validation diagnostics before publication</AlertTitle>
          <AlertDescription>{validation.messages.join(" ")}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>1. Select a fixture contract</CardTitle>
          <CardDescription>Fixture data is shared with the Laravel compiler and later runtime compatibility tests.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="fixture-profile">Profile fixture</FieldLabel>
              <Select value={profile.profile.uuid} onValueChange={chooseFixture}>
                <SelectTrigger id="fixture-profile">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {fixtures.map((fixture) => (
                      <SelectItem key={fixture.profile.uuid} value={fixture.profile.uuid}>
                        {fixture.profile.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>2. Parameters</CardTitle>
            <CardDescription>Search, inspect, and reorder stable parameter identities.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Field className="flex-1">
                <FieldLabel className="sr-only" htmlFor="parameter-search">Search parameters</FieldLabel>
                <Input
                  id="parameter-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search parameters"
                />
              </Field>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                Add parameter
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead>Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleParameters.map((parameter) => {
                    const index = profile.parameters.findIndex((item) => item.uuid === parameter.uuid)
                    return (
                      <TableRow key={parameter.uuid} data-state={parameter.uuid === selectedParameterUuid ? "selected" : undefined}>
                        <TableCell>
                          <Button variant="ghost" onClick={() => setSelectedParameterUuid(parameter.uuid)}>
                            <span className="flex min-w-0 flex-col gap-1 text-left">
                              <span className="truncate font-medium">{parameter.label}</span>
                              <span className="truncate font-mono text-xs text-muted-foreground">{parameter.key}</span>
                            </span>
                          </Button>
                        </TableCell>
                        <TableCell><Badge variant="outline">{parameter.kind}</Badge></TableCell>
                        <TableCell>{parameter.data_type}</TableCell>
                        <TableCell>{parameter.reports_state ? "Reports" : "Local"}{parameter.accepts_command ? " · command" : ""}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button aria-label={`Move ${parameter.label} up`} disabled={index === 0} onClick={() => reorder(parameter.uuid, -1)} size="icon-sm" variant="ghost">
                              <ArrowUpIcon />
                            </Button>
                            <Button aria-label={`Move ${parameter.label} down`} disabled={index === profile.parameters.length - 1} onClick={() => reorder(parameter.uuid, 1)} size="icon-sm" variant="ghost">
                              <ArrowDownIcon />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Parameter detail</CardTitle>
            <CardDescription>{selectedParameter ? selectedParameter.uuid : "Choose a parameter"}</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedParameter ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="parameter-label">Label</FieldLabel>
                  <Input id="parameter-label" value={selectedParameter.label} onChange={(event) => updateParameter(selectedParameter.uuid, { label: event.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="parameter-unit">Engineering unit</FieldLabel>
                  <Input id="parameter-unit" value={selectedParameter.unit ?? ""} onChange={(event) => updateParameter(selectedParameter.uuid, { unit: event.target.value || null })} placeholder="Optional" />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Accept commands</FieldTitle>
                    <FieldDescription>Derived parameters are always read-only.</FieldDescription>
                  </FieldContent>
                  <Switch checked={selectedParameter.accepts_command} disabled={selectedParameter.kind === "derived"} onCheckedChange={(checked) => updateParameter(selectedParameter.uuid, { accepts_command: checked })} />
                </Field>
                <FieldSet>
                  <FieldTitle>Advanced JSON view</FieldTitle>
                  <Textarea aria-label="Selected parameter JSON" readOnly value={JSON.stringify(selectedParameter.validation ?? {}, null, 2)} />
                  <FieldDescription>Validation uses the restricted JSON Logic contract and emits stable diagnostic codes.</FieldDescription>
                </FieldSet>
              </FieldGroup>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>4. Validation preview</CardTitle>
            <CardDescription>Generated JSON Logic and user-facing diagnostics are visible before save.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea aria-label="Compiled definition preview" readOnly value={JSON.stringify(profile, null, 2)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>5. Calculations and publication</CardTitle>
            <CardDescription>Only pure derived calculations may be published with the profile.</CardDescription>
          </CardHeader>
          <CardContent>
            {calculationMessages.length === 0 ? (
              <Alert>
                <CheckCircle2Icon />
                <AlertTitle>No calculation dependency errors</AlertTitle>
                <AlertDescription>Targets are derived parameters and their stable UUIDs resolve inside this profile.</AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Calculation diagnostics</AlertTitle>
                <AlertDescription>{calculationMessages.join(" ")}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter>
            <Badge variant="outline">Revision {profile.profile.revision}</Badge>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a protocol-neutral parameter</DialogTitle>
            <DialogDescription>The editor writes the same artifact shape that is accepted by the authoring API.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addParameter}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-parameter-key">Stable key</FieldLabel>
                <Input id="new-parameter-key" value={newParameter.key} onChange={(event) => setNewParameter((current) => ({ ...current, key: event.target.value }))} placeholder="temperature.outlet" />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-parameter-label">Label</FieldLabel>
                <Input id="new-parameter-label" value={newParameter.label} onChange={(event) => setNewParameter((current) => ({ ...current, label: event.target.value }))} placeholder="Outlet temperature" />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-parameter-type">Canonical data type</FieldLabel>
                <Select value={newParameter.dataType} onValueChange={(value: NewParameter["dataType"]) => setNewParameter((current) => ({ ...current, dataType: value }))}>
                  <SelectTrigger id="new-parameter-type"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{["boolean", "integer", "number", "string", "timestamp", "bytes"].map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
              <Button type="submit"><PlusIcon data-icon="inline-start" />Add parameter</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
