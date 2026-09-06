import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import {
  configurationProfile,
  type DeviceDetail,
  type DeviceDraft,
  type DeviceProfileArtifact,
  type DeviceValidation,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@iot-os/ui/components/card"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  Choice,
  TextField,
  SaveBar,
  RequestError,
  Confirm,
} from "../components/forms"
import { DevicePages, formatTime, useDeviceOrganization } from "./shared"
import { MeasurementTable } from "./MeasurementsSection"
import type { DeviceOperation } from "./DeviceWorkspace"

const emptyDraft: DeviceDraft = {
  artifact_uuid: "",
  candidate_uuid: null,
  birth_revision: null,
  mappings: [],
}
export function ConfigurationSection({
  org,
  device,
  editable,
  canActivate,
  run,
  busy,
}: {
  org: string
  device: DeviceDetail
  editable: boolean
  canActivate: boolean
  run: DeviceOperation
  busy: boolean
}) {
  const [params] = useSearchParams()
  const [sourceSearch, setSourceSearch] = useState(""),
    [sourcePage, setSourcePage] = useState(1),
    [artifactPage, setArtifactPage] = useState(1),
    [profilePage, setProfilePage] = useState(1)
  const [draft, setDraft] = useState<DeviceDraft>(() => ({
    ...(device.draft ?? emptyDraft),
    ...(params.get("candidate")
      ? { candidate_uuid: params.get("candidate"), birth_revision: null }
      : {}),
  }))
  const [base, setBase] = useState(() =>
      JSON.stringify(device.draft ?? emptyDraft),
    ),
    [revision, setRevision] = useState(device.draft_revision)
  const [profileUuid, setProfileUuid] = useState(
      device.draft_artifact?.profile_uuid ?? "",
    ),
    [artifact, setArtifact] = useState<DeviceProfileArtifact | null>(
      device.draft_artifact,
    )
  const [search, setSearch] = useState(""),
    [profileSearch, setProfileSearch] = useState(""),
    [validation, setValidation] = useState<DeviceValidation | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(false),
    [activate, setActivate] = useState(false),
    [rollback, setRollback] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== base
  useUnsaved(dirty)
  const writable = editable && device.lifecycle !== "archived"
  const profiles = useQuery({
    queryKey: ["device-profile-options", org, profileSearch, profilePage],
    queryFn: () =>
      api.deviceProfiles(org, {
        search: profileSearch,
        perPage: 25,
        page: profilePage,
      }),
  })
  const artifacts = useQuery({
    queryKey: ["device-artifact-options", org, profileUuid, artifactPage],
    queryFn: () => api.profileArtifacts(org, profileUuid, artifactPage),
    enabled: Boolean(profileUuid),
  })
  const candidates = useQuery({
    queryKey: ["discovery-options", org, sourceSearch, sourcePage],
    queryFn: () =>
      api.discoveryPage(org, {
        search: sourceSearch,
        page: sourcePage,
        per_page: 25,
      }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const selectedSource = useQuery({
    queryKey: ["discovery-candidate", org, draft.candidate_uuid],
    queryFn: () => api.discoveryCandidate(org, draft.candidate_uuid!),
    enabled: Boolean(draft.candidate_uuid),
    refetchInterval: 5000,
  })
  const suggestions = useQuery({
    queryKey: ["device-mapping-suggestions", org, device.uuid, artifact?.uuid],
    queryFn: () =>
      api.deviceMappingSuggestions(org, device.uuid, artifact!.uuid),
    enabled: Boolean(artifact && editable),
  })
  const sources = [...(candidates.data?.data ?? [])]
  if (
    selectedSource.data &&
    !sources.some((c) => c.uuid === selectedSource.data!.uuid)
  )
    sources.unshift(selectedSource.data)
  if (
    device.candidate &&
    !sources.some((c) => c.uuid === device.candidate!.uuid)
  )
    sources.unshift(device.candidate)
  const candidate = sources.find((c) => c.uuid === draft.candidate_uuid)
  useEffect(() => {
    if (candidate && draft.birth_revision === null)
      setDraft((current) => ({
        ...current,
        birth_revision: candidate.birth_revision,
      }))
  }, [candidate?.uuid, candidate?.birth_revision, draft.birth_revision])
  const parameters =
    artifact?.definition.parameters.filter(
      (p) => p.reports_state && p.kind !== "derived",
    ) ?? []
  const visible = parameters
    .filter((p) =>
      (p.label + " " + p.key).toLowerCase().includes(search.toLowerCase()),
    )
    .slice(0, 100)
  const mapped = useMemo(
    () => new Map(draft.mappings.map((m) => [m.parameter_uuid, m])),
    [draft.mappings],
  )
  const metricOptions = [
    { value: "", label: "Choose a source metric" },
    ...(candidate?.metrics ?? []).map((m) => ({
      value: m.name,
      label: `${m.name} · ${m.datatype}`,
    })),
  ]
  function changeMapping(
    uuid: string,
    metric: string,
    command: string | null = null,
  ) {
    setDraft((current) => ({
      ...current,
      mappings: [
        ...current.mappings.filter((m) => m.parameter_uuid !== uuid),
        ...(metric
          ? [{ parameter_uuid: uuid, metric, command_metric: command }]
          : []),
      ],
    }))
    setValidation(null)
  }
  function useSaved() {
    setDraft(device.draft ?? emptyDraft)
    setBase(JSON.stringify(device.draft ?? emptyDraft))
    setRevision(device.draft_revision)
    setArtifact(device.draft_artifact)
    setProfileUuid(device.draft_artifact?.profile_uuid ?? "")
    setValidation(null)
    setError(null)
  }
  const profileOptions = (profiles.data?.data ?? [])
    .filter((p) => p.revision > 0)
    .map((p) => ({ value: p.uuid, label: p.name }))
  if (
    artifact &&
    !profileOptions.some((p) => p.value === artifact.profile_uuid)
  )
    profileOptions.unshift({
      value: artifact.profile_uuid,
      label: artifact.definition.profile.name,
    })
  const revisionOptions = (artifacts.data?.data ?? []).map((a) => ({
    value: a.uuid,
    label: `Revision ${a.revision} · ${formatTime(a.compiled_at)}`,
  }))
  if (artifact && !revisionOptions.some((a) => a.value === artifact.uuid))
    revisionOptions.unshift({
      value: artifact.uuid,
      label: `Revision ${artifact.revision} (selected)`,
    })
  return (
    <div className="flex flex-col gap-6 pt-4">
      <RequestError
        error={error ?? profiles.error ?? artifacts.error ?? candidates.error}
      />
      {device.draft_revision !== revision && (
        <Alert>
          <AlertTitle>The device has a newer saved revision</AlertTitle>
          <AlertDescription>
            Your local configuration is retained. Review the saved revision
            before retrying.
            <Button variant="outline" onClick={useSaved}>
              Load saved configuration
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Profile and source</CardTitle>
          <CardDescription>
            Select a published profile revision. Profile publication alone never
            changes this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Find a profile"
              value={profileSearch}
              onChange={(e) => {
                setProfileSearch(e.target.value)
                setProfilePage(1)
              }}
              disabled={!writable}
            />
            <Choice
              label="Device profile"
              value={profileUuid}
              disabled={!writable || busy}
              onChange={(v) => {
                setProfileUuid(v)
                setArtifactPage(1)
                setArtifact(null)
                setDraft((d) => ({ ...d, artifact_uuid: "", mappings: [] }))
                setValidation(null)
              }}
              options={[
                { value: "", label: "Choose a published profile" },
                ...profileOptions,
              ]}
            />
            <Choice
              label="Published revision"
              value={draft.artifact_uuid}
              disabled={!writable || busy || loading || !profileUuid}
              onChange={async (uuid) => {
                const summary = artifacts.data?.data.find(
                  (a) => a.uuid === uuid,
                )
                if (!summary) return
                setLoading(true)
                setError(null)
                try {
                  const result = await api.profileArtifact(
                    org,
                    profileUuid,
                    summary.revision,
                  )
                  setArtifact(result)
                  setDraft((d) => ({
                    ...d,
                    artifact_uuid: uuid,
                    mappings: d.mappings.filter((m) =>
                      result.definition.parameters.some(
                        (p) => p.uuid === m.parameter_uuid,
                      ),
                    ),
                  }))
                  setValidation(null)
                } catch (reason) {
                  setError(reason)
                } finally {
                  setLoading(false)
                }
              }}
              options={[
                { value: "", label: "Choose a revision" },
                ...revisionOptions,
              ]}
            />
            <TextField
              label="Find a source"
              value={sourceSearch}
              onChange={(e) => {
                setSourceSearch(e.target.value)
                setSourcePage(1)
              }}
            />
            <Choice
              label="Discovered source"
              value={draft.candidate_uuid ?? ""}
              disabled={!writable || busy}
              onChange={(uuid) => {
                const next = sources.find((c) => c.uuid === uuid)
                setDraft((d) => ({
                  ...d,
                  candidate_uuid: uuid || null,
                  birth_revision: next?.birth_revision ?? null,
                }))
                setValidation(null)
              }}
              options={[
                { value: "", label: "Not connected yet" },
                ...sources
                  .filter(
                    (c) =>
                      c.status !== "rejected" &&
                      (!c.assigned_device_uuid ||
                        c.assigned_device_uuid === device.uuid),
                  )
                  .map((c) => ({
                    value: c.uuid,
                    label: `${c.source_device_id || "Edge Node measurements"} · ${c.gateway.name}`,
                  })),
              ]}
            />
          </FieldGroup>
          <DevicePages
            meta={candidates.data?.meta}
            onPage={setSourcePage}
            label="Source choices"
          />
          <DevicePages
            meta={profiles.data?.meta}
            onPage={setProfilePage}
            label="Profile choices"
          />
          <DevicePages
            meta={artifacts.data?.meta}
            onPage={setArtifactPage}
            label="Published revisions"
          />
        </CardContent>
      </Card>
      {candidate && draft.birth_revision !== candidate.birth_revision && (
        <Alert>
          <AlertTitle>A new birth certificate needs review</AlertTitle>
          <AlertDescription>
            The source now reports birth revision {candidate.birth_revision}.
            Check its metric names and types.
            <Button
              variant="outline"
              disabled={!writable}
              onClick={() => {
                setDraft((d) => ({
                  ...d,
                  birth_revision: candidate.birth_revision,
                }))
                setValidation(null)
              }}
            >
              Review this birth revision
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Parameter mappings</CardTitle>
          <CardDescription>
            {artifact
              ? `${parameters.length} reported parameters · ${artifact.definition.calculations.length} calculations`
              : "Select a profile to map its measurements."}{" "}
            Commands are enabled only for explicitly selected writable
            parameters.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {artifact && (
            <>
              {suggestions.data && suggestions.data.length > 0 && (
                <Choice
                  label="Copy profile binding mappings"
                  value=""
                  disabled={!writable || busy}
                  options={[
                    { value: "", label: "Choose a binding to copy" },
                    ...suggestions.data.map((s) => ({
                      value: s.binding_uuid,
                      label: s.name,
                    })),
                  ]}
                  onChange={(uuid) => {
                    const suggestion = suggestions.data.find(
                      (s) => s.binding_uuid === uuid,
                    )
                    if (suggestion) {
                      setDraft((d) => ({ ...d, mappings: suggestion.mappings }))
                      setValidation(null)
                    }
                  }}
                  help="Copies direct metric mappings into this device draft. Review them before saving and activating."
                />
              )}
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Find a parameter"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    disabled={!writable || !candidate || busy}
                    onClick={() => {
                      const normalize = (v: string) =>
                        v.toLowerCase().replace(/[\s._-]/g, "")
                      setDraft((d) => ({
                        ...d,
                        mappings: parameters.flatMap((p) => {
                          const current = mapped.get(p.uuid)
                          if (current) return [current]
                          const metric = candidate?.metrics.find(
                            (m) =>
                              normalize(m.name) === normalize(p.label) ||
                              normalize(m.name) === normalize(p.key),
                          )
                          return metric
                            ? [
                                {
                                  parameter_uuid: p.uuid,
                                  metric: metric.name,
                                  command_metric: null,
                                },
                              ]
                            : []
                        }),
                      }))
                      setValidation(null)
                    }}
                  >
                    Suggest matching metrics
                  </Button>
                </div>
              </FieldGroup>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profile parameter</TableHead>
                    <TableHead>Source metric</TableHead>
                    <TableHead>State command</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((p) => {
                    const mapping = mapped.get(p.uuid)
                    return (
                      <TableRow key={p.uuid}>
                        <TableCell>
                          {p.label}
                          <p className="text-xs text-muted-foreground">
                            {p.data_type} · {p.unit ?? "No unit"}
                          </p>
                        </TableCell>
                        <TableCell className="min-w-64">
                          <Choice
                            label={`Source for ${p.label}`}
                            value={mapping?.metric ?? ""}
                            disabled={!writable || busy}
                            onChange={(v) =>
                              changeMapping(
                                p.uuid,
                                v,
                                mapping?.command_metric ?? null,
                              )
                            }
                            options={metricOptions}
                          />
                        </TableCell>
                        <TableCell>
                          {p.accepts_command ? (
                            <div className="flex flex-col gap-3">
                              <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={Boolean(mapping?.command_metric)}
                                  disabled={
                                    !writable || !mapping?.metric || busy
                                  }
                                  onCheckedChange={(checked) =>
                                    changeMapping(
                                      p.uuid,
                                      mapping!.metric,
                                      checked ? mapping!.metric : null,
                                    )
                                  }
                                />
                                Enable {p.label} command
                              </label>
                              {mapping?.command_metric && (
                                <Choice
                                  label={`Command target for ${p.label}`}
                                  value={mapping.command_metric}
                                  disabled={!writable || busy}
                                  options={metricOptions}
                                  onChange={(v) =>
                                    changeMapping(
                                      p.uuid,
                                      mapping.metric,
                                      v || null,
                                    )
                                  }
                                />
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Read only
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {parameters.length > 100 && (
                <p className="text-sm text-muted-foreground">
                  Showing up to 100 matching parameters. Search to edit others;
                  all mappings are retained.
                </p>
              )}
            </>
          )}
        </CardContent>
        {writable && (
          <CardFooter className="p-0">
            <form
              className="w-full"
              onSubmit={async (e) => {
                e.preventDefault()
                setError(null)
                try {
                  const result = await run(() =>
                    api.saveDeviceConfiguration(org, device.uuid, {
                      ...draft,
                      draft_revision: revision,
                    }),
                  )
                  setDraft(result.draft!)
                  setBase(JSON.stringify(result.draft))
                  setRevision(result.draft_revision)
                  setValidation(null)
                } catch (reason) {
                  setError(reason)
                }
              }}
            >
              <SaveBar
                dirty={dirty}
                busy={busy || loading}
                disabled={!draft.artifact_uuid}
                onCancel={useSaved}
                label="Save configuration draft"
              />
            </form>
          </CardFooter>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Validate and activate</CardTitle>
          <CardDescription>
            Validate the exact saved draft against captured source values, then
            review the configuration before activation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={
                !writable ||
                dirty ||
                busy ||
                !draft.candidate_uuid ||
                !draft.artifact_uuid ||
                revision !== device.draft_revision
              }
              onClick={async () => {
                setError(null)
                try {
                  setValidation(
                    await run(() =>
                      api.validateDevice(org, device.uuid, revision),
                    ),
                  )
                } catch (reason) {
                  setError(reason)
                }
              }}
            >
              Validate saved configuration
            </Button>
            <Button
              disabled={
                !canActivate ||
                busy ||
                dirty ||
                device.deployment_status === "pending" ||
                validation?.draft_revision !== device.draft_revision
              }
              onClick={() => setActivate(true)}
            >
              Review and activate
            </Button>
          </div>
          {validation && (
            <>
              <Alert>
                <AlertTitle>Configuration validation completed</AlertTitle>
                <AlertDescription>
                  Review sample values and diagnostics below. These are captured
                  samples, not newly received live measurements.
                </AlertDescription>
              </Alert>
              <MeasurementTable readings={validation.preview.readings} />
            </>
          )}
        </CardContent>
      </Card>
      {device.configurations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Configuration history</CardTitle>
            <CardDescription>
              Each activation keeps its exact profile and mappings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Profile revision</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {device.configurations.map((c) => (
                  <TableRow key={c.uuid}>
                    <TableCell>Revision {c.revision}</TableCell>
                    <TableCell>
                      {configurationProfile(c).profile.revision}
                    </TableCell>
                    <TableCell>{formatTime(c.created_at)}</TableCell>
                    <TableCell>
                      {device.applied_configuration_uuid === c.uuid
                        ? "Applied"
                        : device.desired_configuration_uuid === c.uuid
                          ? "Requested"
                          : "Historical"}
                    </TableCell>
                    <TableCell>
                      {canActivate &&
                        c.uuid !== device.applied_configuration_uuid && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              busy ||
                              dirty ||
                              device.deployment_status === "pending" ||
                              device.lifecycle === "archived"
                            }
                            onClick={() => setRollback(c.uuid)}
                          >
                            Review rollback
                          </Button>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Confirm
        open={activate}
        title="Activate this configuration?"
        description={`Apply ${artifact?.definition.profile.name ?? "the selected profile"}, revision ${artifact?.revision}, to ${device.name}. The currently applied version remains in use until the runtime accepts this request.`}
        action="Activate configuration"
        destructive={false}
        onClose={() => setActivate(false)}
        onConfirm={async () => {
          const result = await run(() =>
            api.deviceAction(
              org,
              device.uuid,
              "activate",
              device.draft_revision,
            ),
          )
          setRevision(result.draft_revision)
          setValidation(null)
        }}
      />
      <Confirm
        open={Boolean(rollback)}
        title="Restore a historical configuration?"
        description="A new immutable configuration will use these historical mappings and profile revision after validating them against the current source."
        action="Request rollback"
        destructive={false}
        onClose={() => setRollback(null)}
        onConfirm={async () => {
          if (rollback) {
            const result = await run(() =>
              api.deviceAction(
                org,
                device.uuid,
                "activate",
                device.draft_revision,
                rollback,
              ),
            )
            setRevision(result.draft_revision)
            setValidation(null)
          }
        }}
      />
    </div>
  )
}
