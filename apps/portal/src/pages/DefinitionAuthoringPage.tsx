import { type FormEvent, useEffect, useState } from "react"
import {
  ApiError,
  type CoordinatedDefinition,
  type DefinitionPreview,
  type Organization,
} from "@iot-os/api-client"
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
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Spinner } from "@iot-os/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { Textarea } from "@iot-os/ui/components/textarea"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  RefreshCwIcon,
  SaveIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { PageHeading, PageLoading } from "../components/PageStates"
import {
  buildDefinition,
  createDefaultDefinitionForm,
  formFromDefinition,
  type BuiltDefinition,
  type DefinitionFormState,
} from "../device-domain/definition-template"
import {
  clearDefinitionDraft,
  loadDefinitionDraft,
  saveDefinitionDraft,
} from "../device-domain/draft-storage"
import { apiClient } from "../lib/api-client"

type Operation = "idle" | "loading" | "saving" | "validating" | "publishing"

type ServerDraft = {
  bindingVersionUuid: string
  etag: string
}

function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.payload && typeof error.payload === "object") {
    const payload = error.payload as { detail?: unknown; message?: unknown }
    const message = payload.detail ?? payload.message

    if (typeof message === "string") return message
  }

  return "The definition could not be updated. Check the fields and try again."
}

function builtDefinition(form: DefinitionFormState):
  | { definition: BuiltDefinition; error: null }
  | { definition: null; error: string } {
  try {
    return { definition: buildDefinition(form), error: null }
  } catch (error) {
    return {
      definition: null,
      error: error instanceof Error ? error.message : "The definition is not valid JSON.",
    }
  }
}

function ReadOnlyJson({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[34rem] overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function DefinitionAuthoringPage() {
  const organization = useOutletContext<Organization>()
  const { bindingVersionUuid } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState<DefinitionFormState>(createDefaultDefinitionForm)
  const [serverDraft, setServerDraft] = useState<ServerDraft | null>(null)
  const [preview, setPreview] = useState<DefinitionPreview | null>(null)
  const [operation, setOperation] = useState<Operation>("loading")
  const [hydrated, setHydrated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hasConflict, setHasConflict] = useState(false)
  const built = builtDefinition(form)

  useEffect(() => {
    let active = true

    setHydrated(false)
    setPreview(null)
    setError(null)
    setNotice(null)
    setHasConflict(false)

    if (!bindingVersionUuid) {
      const stored = loadDefinitionDraft(organization.uuid)
      setForm(stored?.form ?? createDefaultDefinitionForm())
      setServerDraft(
        stored?.bindingVersionUuid && stored.etag
          ? { bindingVersionUuid: stored.bindingVersionUuid, etag: stored.etag }
          : null,
      )
      setOperation("idle")
      setHydrated(true)

      return () => {
        active = false
      }
    }

    setOperation("loading")
    apiClient
      .coordinatedDefinition(bindingVersionUuid)
      .then((response) => {
        if (!active) return
        setForm(formFromDefinition(response.data))
        setServerDraft({ bindingVersionUuid, etag: response.etag })
        setOperation("idle")
        setHydrated(true)
      })
      .catch((loadError) => {
        if (!active) return
        setError(apiErrorMessage(loadError))
        setOperation("idle")
        setHydrated(true)
      })

    return () => {
      active = false
    }
  }, [bindingVersionUuid, organization.uuid])

  useEffect(() => {
    if (!hydrated) return

    saveDefinitionDraft(organization.uuid, {
      form,
      bindingVersionUuid: serverDraft?.bindingVersionUuid,
      etag: serverDraft?.etag,
    })
  }, [form, hydrated, organization.uuid, serverDraft])

  function update<K extends keyof DefinitionFormState>(
    key: K,
    value: DefinitionFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }))
    setPreview(null)
    setNotice(null)
  }

  function acceptResponse(response: CoordinatedDefinition): ServerDraft {
    const next = {
      bindingVersionUuid:
        response.data.binding.version.uuid ?? form.identity.bindingVersionUuid,
      etag: response.etag,
    }
    setServerDraft(next)
    setForm((current) => ({
      ...formFromDefinition(response.data),
      samplePayload: current.samplePayload,
    }))
    setHasConflict(false)

    return next
  }

  async function save(): Promise<ServerDraft | null> {
    if (!built.definition) {
      setError(built.error)
      return null
    }

    setError(null)
    setNotice(null)
    setPreview(null)
    setOperation("saving")

    try {
      const response = serverDraft
        ? await apiClient.replaceCoordinatedDefinition(
            serverDraft.bindingVersionUuid,
            built.definition.profile,
            built.definition.binding,
            serverDraft.etag,
          )
        : await apiClient.createCoordinatedDefinition(
            built.definition.profile,
            built.definition.binding,
          )
      const next = acceptResponse(response)
      setNotice("Draft saved. Validate it with the telemetry sample before publishing.")

      return next
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 412) {
        setHasConflict(true)
        setError("This draft changed after you loaded it. Reload the current server draft to review it.")
      } else {
        setError(apiErrorMessage(saveError))
      }

      return null
    } finally {
      setOperation("idle")
    }
  }

  async function validate() {
    if (!built.definition) {
      setError(built.error)
      return
    }

    const saved = await save()

    if (!saved) return

    setOperation("validating")
    setError(null)
    setNotice(null)

    try {
      const result = await apiClient.validateCoordinatedDefinition(
        saved.bindingVersionUuid,
        built.definition.fixtures,
        saved.etag,
      )
      setPreview(result)
      setNotice(
        result.valid
          ? "Validation passed. The coordinated definition is ready to publish."
          : "Validation completed with contract diagnostics.",
      )
    } catch (validationError) {
      if (validationError instanceof ApiError && validationError.status === 412) {
        setHasConflict(true)
      }
      setError(apiErrorMessage(validationError))
    } finally {
      setOperation("idle")
    }
  }

  async function publish() {
    if (!serverDraft || !preview?.valid) return

    setOperation("publishing")
    setError(null)
    setNotice(null)

    try {
      await apiClient.publishCoordinatedDefinition(
        serverDraft.bindingVersionUuid,
        serverDraft.etag,
      )
      clearDefinitionDraft(organization.uuid)
      navigate(`/organizations/${organization.uuid}/definitions`, {
        replace: true,
      })
    } catch (publishError) {
      if (publishError instanceof ApiError && publishError.status === 412) {
        setHasConflict(true)
      }
      setError(apiErrorMessage(publishError))
      setOperation("idle")
    }
  }

  async function reloadServerDraft() {
    if (!serverDraft) return

    setOperation("loading")
    setError(null)

    try {
      const response = await apiClient.coordinatedDefinition(serverDraft.bindingVersionUuid)
      acceptResponse(response)
      setPreview(null)
      setNotice("Current server draft loaded. Review it before saving again.")
    } catch (reloadError) {
      setError(apiErrorMessage(reloadError))
    } finally {
      setOperation("idle")
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save()
  }

  if (operation === "loading" && !hydrated) {
    return (
      <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
        <PageHeading
          title="Definition authoring"
          description="Loading the coordinated Profile and Binding draft."
        />
        <PageLoading label="Loading definition draft…" />
      </section>
    )
  }

  const busy = operation !== "idle"

  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6"
      onSubmit={submit}
    >
      <PageHeading
        title={serverDraft ? "Edit Device definition" : "Create Device definition"}
        description="Describe Device semantics and map the manufacturer-owned MQTT JSON payload. The generated DTO remains visible for review."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" disabled={busy}>
              {operation === "saving" ? <Spinner data-icon="inline-start" /> : <SaveIcon />}
              Save draft
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void validate()}>
              {operation === "validating" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ShieldCheckIcon />
              )}
              Validate
            </Button>
            <Button
              type="button"
              disabled={busy || !serverDraft || !preview?.valid}
              onClick={() => void publish()}
            >
              {operation === "publishing" ? <Spinner data-icon="inline-start" /> : <SendIcon />}
              Publish
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{hasConflict ? "Draft conflict" : "Definition needs attention"}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{error}</span>
            {hasConflict && serverDraft ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void reloadServerDraft()}>
                <RefreshCwIcon data-icon="inline-start" />
                Reload server draft
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Definition workspace updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.72fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile and Binding identity</CardTitle>
              <CardDescription>
                The Profile defines what the Device means; the Binding defines how this firmware
                communicates over MQTT JSON.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="profile-name">Profile name</FieldLabel>
                    <Input
                      id="profile-name"
                      value={form.profileName}
                      onChange={(event) => update("profileName", event.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="profile-key">Profile key</FieldLabel>
                    <Input
                      id="profile-key"
                      className="font-mono"
                      value={form.profileKey}
                      onChange={(event) => update("profileKey", event.target.value)}
                      pattern="[a-z][a-z0-9_]*"
                      required
                    />
                    <FieldDescription>Stable snake_case identifier.</FieldDescription>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="profile-description">Profile description</FieldLabel>
                  <Textarea
                    id="profile-description"
                    value={form.profileDescription}
                    onChange={(event) => update("profileDescription", event.target.value)}
                  />
                </Field>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="binding-name">Binding name</FieldLabel>
                    <Input
                      id="binding-name"
                      value={form.bindingName}
                      onChange={(event) => update("bindingName", event.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="binding-key">Binding key</FieldLabel>
                    <Input
                      id="binding-key"
                      className="font-mono"
                      value={form.bindingKey}
                      onChange={(event) => update("bindingKey", event.target.value)}
                      pattern="[a-z][a-z0-9_]*"
                      required
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="binding-description">Binding description</FieldLabel>
                  <Textarea
                    id="binding-description"
                    value={form.bindingDescription}
                    onChange={(event) => update("bindingDescription", event.target.value)}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Telemetry contract</CardTitle>
              <CardDescription>
                Map Device identity, observation time, temperature, and humidity from one JSON
                payload.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="telemetry-topic">MQTT topic template</FieldLabel>
                  <Input
                    id="telemetry-topic"
                    className="font-mono"
                    value={form.telemetryTopic}
                    onChange={(event) => update("telemetryTopic", event.target.value)}
                    required
                  />
                  <FieldDescription>
                    Use {"{device_id}"} where the registered external Device ID belongs.
                  </FieldDescription>
                </Field>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="device-id-path">Device ID JSONPath</FieldLabel>
                    <Input
                      id="device-id-path"
                      className="font-mono"
                      value={form.deviceIdPath}
                      onChange={(event) => update("deviceIdPath", event.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="timestamp-path">Timestamp JSONPath</FieldLabel>
                    <Input
                      id="timestamp-path"
                      className="font-mono"
                      value={form.timestampPath}
                      onChange={(event) => update("timestampPath", event.target.value)}
                      required
                    />
                  </Field>
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="temperature-path">Temperature JSONPath</FieldLabel>
                    <Input
                      id="temperature-path"
                      className="font-mono"
                      value={form.temperaturePath}
                      onChange={(event) => update("temperaturePath", event.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="temperature-minimum">Minimum °C</FieldLabel>
                    <Input
                      id="temperature-minimum"
                      type="number"
                      value={form.temperatureMinimum}
                      onChange={(event) => update("temperatureMinimum", event.target.valueAsNumber)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="temperature-maximum">Maximum °C</FieldLabel>
                    <Input
                      id="temperature-maximum"
                      type="number"
                      value={form.temperatureMaximum}
                      onChange={(event) => update("temperatureMaximum", event.target.valueAsNumber)}
                      required
                    />
                  </Field>
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="humidity-path">Humidity JSONPath</FieldLabel>
                    <Input
                      id="humidity-path"
                      className="font-mono"
                      value={form.humidityPath}
                      onChange={(event) => update("humidityPath", event.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="humidity-minimum">Minimum %</FieldLabel>
                    <Input
                      id="humidity-minimum"
                      type="number"
                      value={form.humidityMinimum}
                      onChange={(event) => update("humidityMinimum", event.target.valueAsNumber)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="humidity-maximum">Maximum %</FieldLabel>
                    <Input
                      id="humidity-maximum"
                      type="number"
                      value={form.humidityMaximum}
                      onChange={(event) => update("humidityMaximum", event.target.valueAsNumber)}
                      required
                    />
                  </Field>
                </div>
                <Field data-invalid={Boolean(built.error)}>
                  <FieldLabel htmlFor="sample-payload">Telemetry sample payload</FieldLabel>
                  <Textarea
                    id="sample-payload"
                    className="min-h-52 font-mono"
                    value={form.samplePayload}
                    onChange={(event) => update("samplePayload", event.target.value)}
                    aria-invalid={Boolean(built.error)}
                    spellCheck={false}
                    required
                  />
                  <FieldDescription>
                    This fixture is replayed by the deterministic compiler during validation.
                  </FieldDescription>
                  <FieldError errors={built.error ? [{ message: built.error }] : undefined} />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Thermostat command</CardTitle>
              <CardDescription>
                Optionally expose a two-way set_temperature Command with correlated application
                status. MQTT PUBACK alone is not treated as success.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="thermostat-enabled"
                    checked={form.thermostatEnabled}
                    onCheckedChange={(checked) => update("thermostatEnabled", checked === true)}
                  />
                  <FieldLabel htmlFor="thermostat-enabled">Enable temp_level control</FieldLabel>
                </Field>
                {form.thermostatEnabled ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="command-request-topic">Request topic</FieldLabel>
                      <Input
                        id="command-request-topic"
                        className="font-mono"
                        value={form.commandRequestTopic}
                        onChange={(event) => update("commandRequestTopic", event.target.value)}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="command-response-topic">Response topic</FieldLabel>
                      <Input
                        id="command-response-topic"
                        className="font-mono"
                        value={form.commandResponseTopic}
                        onChange={(event) => update("commandResponseTopic", event.target.value)}
                        required
                      />
                    </Field>
                    <div className="grid gap-5 md:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="command-timeout">Timeout seconds</FieldLabel>
                        <Input
                          id="command-timeout"
                          type="number"
                          min={1}
                          max={300}
                          value={form.commandTimeoutSeconds}
                          onChange={(event) =>
                            update("commandTimeoutSeconds", event.target.valueAsNumber)
                          }
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="target-minimum">Minimum target °C</FieldLabel>
                        <Input
                          id="target-minimum"
                          type="number"
                          value={form.targetTemperatureMinimum}
                          onChange={(event) =>
                            update("targetTemperatureMinimum", event.target.valueAsNumber)
                          }
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="target-maximum">Maximum target °C</FieldLabel>
                        <Input
                          id="target-maximum"
                          type="number"
                          value={form.targetTemperatureMaximum}
                          onChange={(event) =>
                            update("targetTemperatureMaximum", event.target.valueAsNumber)
                          }
                          required
                        />
                      </Field>
                    </div>
                  </>
                ) : null}
              </FieldGroup>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 self-start xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle>Contract review</CardTitle>
            <CardDescription>
              Confirm the exact DTO and compiler evidence before publication.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="contract">
              <TabsList className="w-full">
                <TabsTrigger value="contract">Generated DTO</TabsTrigger>
                <TabsTrigger value="validation">Validation</TabsTrigger>
              </TabsList>
              <TabsContent value="contract" className="pt-4">
                {built.definition ? (
                  <ReadOnlyJson
                    value={{
                      profile: built.definition.profile,
                      binding: built.definition.binding,
                      fixtures: built.definition.fixtures,
                    }}
                  />
                ) : (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertTitle>Generated contract unavailable</AlertTitle>
                    <AlertDescription>{built.error}</AlertDescription>
                  </Alert>
                )}
              </TabsContent>
              <TabsContent value="validation" className="flex flex-col gap-4 pt-4">
                {!preview ? (
                  <Alert>
                    <ShieldCheckIcon />
                    <AlertTitle>Not validated yet</AlertTitle>
                    <AlertDescription>
                      Save and validate to replay the sample through JSONPath extraction, type
                      coercion, semantic constraints, and canonical preview generation.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <Alert variant={preview.valid ? "default" : "destructive"}>
                      {preview.valid ? <CheckCircle2Icon /> : <AlertCircleIcon />}
                      <AlertTitle>
                        {preview.valid ? "Contract validation passed" : "Contract validation failed"}
                      </AlertTitle>
                      <AlertDescription>
                        {preview.diagnostics.length} diagnostic
                        {preview.diagnostics.length === 1 ? "" : "s"} · {preview.previews.length}{" "}
                        fixture preview{preview.previews.length === 1 ? "" : "s"}
                      </AlertDescription>
                    </Alert>
                    {preview.diagnostics.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {preview.diagnostics.map((diagnostic, index) => (
                          <div
                            className="rounded-lg border p-3 text-sm"
                            key={`${diagnostic.code}-${diagnostic.path}-${index}`}
                          >
                            <div className="font-medium">{diagnostic.code}</div>
                            <div className="text-muted-foreground">{diagnostic.message}</div>
                            <div className="mt-1 font-mono text-xs text-muted-foreground">
                              {diagnostic.path}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <ReadOnlyJson value={preview.previews} />
                  </>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-2 border-t">
            <p className="text-xs text-muted-foreground">
              Drafts are tenant-owned and editable. Publishing locks both exact Versions and their
              compiler artifacts.
            </p>
          </CardFooter>
        </Card>
      </div>
    </form>
  )
}
