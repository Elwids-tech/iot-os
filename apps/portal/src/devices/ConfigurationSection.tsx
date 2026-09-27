import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import {
  configurationProfile,
  type DeviceDetail,
  type DeviceMapping,
  type DeviceDraft,
  type DeviceProfileArtifact,
} from "@iot-os/api-client"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Button } from "@iot-os/ui/components/button"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { ChevronDownIcon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { Choice, SaveBar, RequestError, Confirm } from "../components/forms"
import {
  Age,
  configurationRevision,
  DevicePages,
  discoveryPath,
  formatTime,
  gatewayPath,
  metricCount,
  profilePath,
  Section,
} from "./shared"
import {
  IncomingConversionFields,
  conversionEligible,
  conversionEquation,
} from "../profiles/IncomingConversionFields"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@iot-os/ui/components/accordion"
import { MeasurementTable } from "./MeasurementsSection"
import { UsedIn } from "./DeviceOverview"
import type { DeviceOperation } from "./DeviceWorkspace"

const emptyDraft: DeviceDraft = {
  artifact_uuid: "",
  candidate_uuid: null,
  birth_revision: null,
  mappings: [],
}
const sourceName = (id: string) => id || "Gateway measurements"
const announced = (
  <abbr title="Sparkplug birth certificate revision" className="cursor-help">
    Announced revision
  </abbr>
)
function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <>
      <span className="mr-2 font-normal text-muted-foreground">{number}</span>
      {children}
    </>
  )
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
  const cache = useQueryClient()
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
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(false),
    [activate, setActivate] = useState(false),
    [rollback, setRollback] = useState<string | null>(null),
    [replace, setReplace] = useState<{
      title: string
      action: string
      apply: () => void
    } | null>(null)
  const dirty = JSON.stringify(draft) !== base
  useUnsaved(dirty)
  const writable = editable && device.lifecycle !== "archived"
  // Validation results live in the query cache per saved draft revision, so they survive tab switches.
  const validationKey = ["device-validation", org, device.uuid, revision]
  const validationQuery = useQuery({
    queryKey: validationKey,
    queryFn: () => api.validateDevice(org, device.uuid, revision),
    enabled: false,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
  const validation = validationQuery.data ?? null
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
  const mappedCount = parameters.filter((p) => mapped.has(p.uuid)).length
  const commandLabels = parameters
    .filter((p) => mapped.get(p.uuid)?.command_metric)
    .map((p) => p.label)
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
    conversion?: Partial<DeviceMapping>,
  ) {
    setDraft((current) => ({
      ...current,
      mappings: [
        ...current.mappings.filter((m) => m.parameter_uuid !== uuid),
        ...(metric
          ? [
              {
                ...current.mappings.find((m) => m.parameter_uuid === uuid),
                parameter_uuid: uuid,
                metric,
                command_metric: command,
                ...conversion,
              },
            ]
          : []),
      ],
    }))
  }
  /** Runs `apply` directly, or after a confirm when it would replace existing mappings. */
  function replacing(title: string, action: string, apply: () => void) {
    if (draft.mappings.length) setReplace({ title, action, apply })
    else apply()
  }
  function useSaved() {
    setDraft(device.draft ?? emptyDraft)
    setBase(JSON.stringify(device.draft ?? emptyDraft))
    setRevision(device.draft_revision)
    setArtifact(device.draft_artifact)
    setProfileUuid(device.draft_artifact?.profile_uuid ?? "")
    setError(null)
  }
  const profileOptions = (profiles.data?.data ?? [])
    .filter((p) => p.revision > 0)
    .map((p) => ({ value: p.uuid, label: p.name }))
  if (
    artifact &&
    !profileSearch &&
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

  const validateReason = !writable
    ? "View only"
    : dirty
      ? "Save the draft first"
      : !draft.artifact_uuid
        ? "Choose a profile revision first"
        : !draft.candidate_uuid
          ? "Choose a discovered source first"
          : revision !== device.draft_revision
            ? "Load the newer saved draft first"
            : undefined
  const applyReason = !canActivate
    ? "Your role cannot apply configurations"
    : dirty
      ? "Save the draft first"
      : device.deployment_status === "pending"
        ? "Waiting for the runtime to confirm the last request"
        : validation?.draft_revision !== device.draft_revision
          ? "Validate the saved draft first"
          : undefined
  const applied = device.configurations.find(
    (c) => c.uuid === device.applied_configuration_uuid,
  )
  const appliedRevision = configurationRevision(device, device.applied_configuration_uuid)
  const setup: Array<[string, StatusTone, string]> = [
    [
      "Profile and source",
      draft.artifact_uuid && draft.candidate_uuid ? "good" : "muted",
      artifact
        ? `${artifact.definition.profile.name} rev ${artifact.revision}${candidate ? "" : ", no source"}`
        : "Not chosen",
    ],
    [
      "Mappings",
      !mappedCount ? "muted" : dirty ? "warning" : "good",
      `${mappedCount} of ${parameters.length} mapped${dirty ? ", unsaved" : ""}`,
    ],
    [
      "Validate",
      validation ? (validation.preview.valid ? "good" : "warning") : "muted",
      validation ? `Draft ${validation.draft_revision} validated` : "Not validated",
    ],
    [
      "Review and apply",
      appliedRevision !== undefined && !dirty ? "good" : "muted",
      dirty
        ? "Save first"
        : appliedRevision !== undefined
          ? `Applied rev ${appliedRevision}`
          : applyReason
            ? "Not ready"
            : "Ready to apply",
    ],
  ]

  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-6">
      <div className="flex min-w-0 flex-col gap-8">
        <RequestError
          error={error ?? profiles.error ?? artifacts.error ?? candidates.error}
        />
        {!writable && (
          <p className="text-sm text-muted-foreground">
            {device.lifecycle === "archived"
              ? "Archived devices are read-only."
              : "View only. Your role cannot change the configuration."}
          </p>
        )}
        {device.draft_revision !== revision && (
          <Alert>
            <AlertTitle>The device has a newer saved revision</AlertTitle>
            <AlertDescription>
              Your local configuration is kept. Review the saved revision before
              retrying.
              <Button variant="outline" size="sm" onClick={useSaved}>
                Load saved configuration
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Section title={<Step number={1}>Profile and source</Step>}>
          <FieldGroup className="grid gap-4 md:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1">
              <SearchableSelect
                search={profileSearch}
                onSearchChange={(value) => {
                  setProfileSearch(value)
                  setProfilePage(1)
                }}
                loading={profiles.isLoading}
                selectedLabel={
                  artifact?.profile_uuid === profileUuid
                    ? artifact.definition.profile.name
                    : undefined
                }
                page={profilePage}
                hasNextPage={Boolean(
                  profiles.data && profilePage < profiles.data.meta.last_page,
                )}
                onPageChange={setProfilePage}
                label="Device profile"
                value={profileUuid}
                disabled={!writable || busy}
                onChange={(v) =>
                  replacing(
                    "Change the profile and clear all mappings?",
                    "Change profile",
                    () => {
                      setProfileUuid(v)
                      setArtifactPage(1)
                      setArtifact(null)
                      setDraft((d) => ({ ...d, artifact_uuid: "", mappings: [] }))
                    },
                  )
                }
                options={[
                  { value: "", label: "Choose a published profile" },
                  ...profileOptions,
                ]}
              />
              {artifact && (
                <p className="text-sm text-muted-foreground">
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    to={profilePath(org, artifact.profile_uuid)}
                  >
                    Open profile
                  </Link>{" "}
                  · {parameters.length} parameters
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Choice
                label="Published revision"
                value={draft.artifact_uuid}
                disabled={!writable || busy || loading || !profileUuid}
                help="Publishing a newer revision never changes this device."
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
              <DevicePages
                meta={artifacts.data?.meta}
                onPage={setArtifactPage}
                label="Published revisions"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <SearchableSelect
                search={sourceSearch}
                onSearchChange={(value) => {
                  setSourceSearch(value)
                  setSourcePage(1)
                }}
                loading={candidates.isLoading}
                selectedLabel={
                  candidate
                    ? sourceName(candidate.source_device_id) +
                      " · " +
                      candidate.gateway.name
                    : undefined
                }
                page={sourcePage}
                hasNextPage={Boolean(
                  candidates.data && sourcePage < candidates.data.meta.last_page,
                )}
                onPageChange={setSourcePage}
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
                }}
                options={[
                  { value: "", label: "Not connected yet" },
                  ...(candidates.data?.data ?? [])
                    .filter(
                      (c) =>
                        c.status !== "rejected" &&
                        (!c.assigned_device_uuid ||
                          c.assigned_device_uuid === device.uuid),
                    )
                    .map((c) => ({
                      value: c.uuid,
                      label: `${sourceName(c.source_device_id)} · ${c.gateway.name}`,
                    })),
                ]}
              />
              {candidate && (
                <p className="text-sm text-muted-foreground">
                  {announced} {candidate.birth_revision} ·{" "}
                  {metricCount(candidate.metrics.length)} ·{" "}
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    to={discoveryPath(org, candidate.gateway.uuid)}
                  >
                    View in discovery
                  </Link>
                </p>
              )}
            </div>
          </FieldGroup>
        </Section>
        {candidate && draft.birth_revision !== candidate.birth_revision && (
          <Alert>
            <AlertTitle>The source announced new metrics</AlertTitle>
            <AlertDescription>
              It now reports revision {candidate.birth_revision}. Check its
              metric names and types.
              <Button
                variant="outline"
                size="sm"
                disabled={!writable}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    birth_revision: candidate.birth_revision,
                  }))
                }
              >
                Use revision {candidate.birth_revision}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Section
          title={<Step number={2}>Parameter mappings</Step>}
          meta={artifact ? `${mappedCount} of ${parameters.length} mapped` : undefined}
          actions={
            artifact && (
              <>
                <Input
                  aria-label="Find a parameter"
                  placeholder="Find a parameter"
                  className="h-8 w-44"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
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
                  }}
                >
                  Suggest matching metrics
                </Button>
                {suggestions.data && suggestions.data.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={!writable || busy}>
                        Copy binding mappings
                        <ChevronDownIcon data-icon="inline-end" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {suggestions.data.map((s) => (
                        <DropdownMenuItem
                          key={s.binding_uuid}
                          onSelect={() =>
                            replacing(
                              `Replace the current mappings with ${s.name}?`,
                              "Replace mappings",
                              () => setDraft((d) => ({ ...d, mappings: s.mappings })),
                            )
                          }
                        >
                          {s.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )
          }
        >
          {!artifact ? (
            <p className="text-sm text-muted-foreground">
              Choose a profile revision to map its parameters.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Source metric</TableHead>
                    <TableHead>Command target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((p) => {
                    const mapping = mapped.get(p.uuid)
                    return (
                      <TableRow key={p.uuid}>
                        <TableCell className="align-top">
                          {p.label}
                          <p className="font-mono text-xs text-muted-foreground">
                            {p.data_type}
                            {p.unit ? ` · ${p.unit}` : ""}
                          </p>
                        </TableCell>
                        <TableCell className="min-w-64 align-top whitespace-normal">
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
                          {mapping && conversionEligible(p) && (
                            <Accordion type="single" collapsible>
                              <AccordionItem value="conversion">
                                <AccordionTrigger>
                                  Incoming conversion for {p.label}
                                </AccordionTrigger>
                                <AccordionContent>
                                  <FieldGroup>
                                    <Choice
                                      label={`Conversion mode for ${p.label}`}
                                      value={mapping.conversion_mode ?? "profile"}
                                      disabled={!writable || busy}
                                      options={[
                                        { value: "profile", label: "Use profile default" },
                                        { value: "custom", label: "Custom conversion" },
                                        { value: "none", label: "No conversion" },
                                      ]}
                                      onChange={(mode) =>
                                        changeMapping(
                                          p.uuid,
                                          mapping.metric,
                                          mapping.command_metric,
                                          {
                                            conversion_mode:
                                              mode as DeviceMapping["conversion_mode"],
                                            ingress_conversion:
                                              mode === "custom"
                                                ? (p.ingress_conversion ?? {
                                                    source_unit: null,
                                                    multiplier: 1,
                                                    offset: 0,
                                                  })
                                                : null,
                                          },
                                        )
                                      }
                                    />
                                    <p className="text-sm text-muted-foreground">
                                      {mapping.conversion_mode === "custom"
                                        ? "Device override"
                                        : mapping.conversion_mode === "none"
                                          ? "Conversion bypassed"
                                          : "Selected published profile"}
                                      :{" "}
                                      {conversionEquation(
                                        mapping.conversion_mode === "none"
                                          ? null
                                          : mapping.conversion_mode === "custom"
                                            ? mapping.ingress_conversion
                                            : p.ingress_conversion,
                                      )}
                                      . Stored unit: {p.unit ?? "No unit"}.
                                    </p>
                                    {mapping.conversion_mode === "custom" && (
                                      <IncomingConversionFields
                                        toggle={false}
                                        value={mapping.ingress_conversion ?? null}
                                        storedUnit={p.unit}
                                        dataType={p.data_type}
                                        disabled={!writable || busy}
                                        onChange={(value) =>
                                          changeMapping(
                                            p.uuid,
                                            mapping.metric,
                                            mapping.command_metric,
                                            { ingress_conversion: value },
                                          )
                                        }
                                      />
                                    )}
                                    <p className="text-sm text-muted-foreground">
                                      Save and validate to check captured source
                                      samples. Changes apply after you apply the
                                      configuration.
                                    </p>
                                  </FieldGroup>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          )}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          {p.accepts_command ? (
                            <div className="flex flex-col gap-3">
                              <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={Boolean(mapping?.command_metric)}
                                  disabled={!writable || !mapping?.metric || busy}
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
                                    changeMapping(p.uuid, mapping.metric, v || null)
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
                  all mappings are kept.
                </p>
              )}
            </>
          )}
        </Section>
        <Section
          title={<Step number={3}>Validate</Step>}
          actions={
            <Button
              variant="outline"
              size="sm"
              disabled={busy || Boolean(validateReason)}
              onClick={async () => {
                setError(null)
                try {
                  await run(() =>
                    cache.fetchQuery({
                      queryKey: validationKey,
                      queryFn: () => api.validateDevice(org, device.uuid, revision),
                      staleTime: 0,
                      gcTime: 30 * 60_000,
                    }),
                  )
                } catch (reason) {
                  setError(reason)
                }
              }}
            >
              Validate saved draft
            </Button>
          }
        >
          {validation ? (
            <div className="flex flex-col gap-3">
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <StatusMark tone={validation.preview.valid ? "good" : "warning"}>
                  Draft {validation.draft_revision}{" "}
                  {validation.preview.valid ? "validated" : "has problems"}
                </StatusMark>
                <span className="text-muted-foreground">
                  <Age value={new Date(validationQuery.dataUpdatedAt).toISOString()} />
                  {dirty && " · save to validate your changes"}
                </span>
                <span className="ml-auto text-muted-foreground">
                  Captured samples, not live readings
                </span>
              </p>
              <MeasurementTable readings={validation.preview.readings} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {validateReason ?? "Checks the saved draft against captured source values."}
            </p>
          )}
        </Section>
        <Section title={<Step number={4}>Review and apply</Step>}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Profile</dt>
              <dd>
                {artifact ? (
                  <>
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      to={profilePath(org, artifact.profile_uuid)}
                    >
                      {artifact.definition.profile.name}
                    </Link>
                    <span className="text-muted-foreground"> · rev {artifact.revision}</span>
                  </>
                ) : (
                  "Not chosen"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                {candidate ? (
                  <>
                    <span className="font-mono">{sourceName(candidate.source_device_id)}</span>
                    <span className="text-muted-foreground"> · {candidate.gateway.name}</span>
                  </>
                ) : (
                  "Not connected"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Mappings</dt>
              <dd>
                {mappedCount} of {parameters.length}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Commands enabled</dt>
              <dd>{commandLabels.length ? commandLabels.join(", ") : "None"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Currently applied</dt>
              <dd>
                {applied
                  ? `Configuration ${applied.revision} · ${applied.profile_name ?? configurationProfile(applied).profile.name} rev ${applied.profile_revision ?? configurationProfile(applied).profile.revision}`
                  : "Nothing yet"}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
            <Button
              disabled={busy || Boolean(applyReason)}
              onClick={() => setActivate(true)}
            >
              Apply new configuration
            </Button>
            {applyReason && (
              <span className="text-sm text-muted-foreground">{applyReason}</span>
            )}
          </div>
        </Section>
        {device.configurations.length > 0 && (
          <Section
            title="Configuration history"
            meta={dirty ? "Save or discard changes to roll back" : undefined}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Profile revision</TableHead>
                  <TableHead>Incoming conversions</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {device.configurations.map((c) => {
                  const profile = configurationProfile(c)
                  const conversions = c.definition.mappings.filter(
                    (m) => m.ingress_conversion || m.conversion_mode === "none",
                  )
                  return (
                    <TableRow key={c.uuid}>
                      <TableCell>Configuration {c.revision}</TableCell>
                      <TableCell>
                        {c.profile_name ?? profile.profile.name}
                        <span className="text-muted-foreground">
                          {" "}
                          · rev {profile.profile.revision}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {conversions.length ? (
                          <div className="flex flex-col gap-1">
                            {conversions.map((m) => {
                              const p = profile.parameters.find(
                                (p) => p.uuid === m.parameter_uuid,
                              )
                              return (
                                <p key={m.parameter_uuid} className="text-sm">
                                  {p?.label ?? m.parameter_uuid}:{" "}
                                  {m.conversion_mode === "custom"
                                    ? "Device override"
                                    : m.conversion_mode === "none"
                                      ? "Bypassed"
                                      : "Profile default"}{" "}
                                  · {conversionEquation(m.ingress_conversion)} ·{" "}
                                  {p?.unit ?? "No unit"}
                                </p>
                              )
                            })}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">No conversions</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Age value={c.created_at} />
                      </TableCell>
                      <TableCell>
                        {device.applied_configuration_uuid === c.uuid ? (
                          <StatusMark tone="good">Applied</StatusMark>
                        ) : device.desired_configuration_uuid === c.uuid ? (
                          <StatusMark tone="warning">Requested</StatusMark>
                        ) : (
                          <StatusMark tone="muted">Historical</StatusMark>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canActivate && c.uuid !== device.applied_configuration_uuid && (
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
                  )
                })}
              </TableBody>
            </Table>
          </Section>
        )}
        {writable && (
          <form
            className="sticky bottom-0 z-10"
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
        )}
      </div>
      <aside
        aria-label="Configuration summary"
        className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-4 xl:border-l xl:pl-6"
      >
        <Section title="Setup">
          <ol className="flex flex-col gap-3 text-sm">
            {setup.map(([name, tone, state], index) => (
              <li key={name} className="flex gap-3">
                <span className="text-muted-foreground">{index + 1}</span>
                <div className="min-w-0">
                  <p>{name}</p>
                  <StatusMark tone={tone} className="text-muted-foreground whitespace-normal">
                    {state}
                  </StatusMark>
                </div>
              </li>
            ))}
          </ol>
        </Section>
        {candidate && (
          <Section title="Source">
            <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Gateway</dt>
              <dd className="min-w-0 break-words">
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  to={gatewayPath(org, candidate.gateway.uuid)}
                >
                  {candidate.gateway.name}
                </Link>
              </dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="min-w-0 font-mono break-words">
                {sourceName(candidate.source_device_id)}
              </dd>
              <dt className="text-muted-foreground">{announced}</dt>
              <dd>
                {candidate.birth_revision} · {metricCount(candidate.metrics.length)}
              </dd>
              <dt className="text-muted-foreground">Last seen</dt>
              <dd>
                <Age value={candidate.last_seen_at} />
              </dd>
            </dl>
          </Section>
        )}
        <UsedIn org={org} device={device} />
      </aside>
      <Confirm
        open={Boolean(replace)}
        title={replace?.title ?? ""}
        description={`${draft.mappings.length} mappings in this draft will be replaced. Nothing is saved until you save the draft.`}
        action={replace?.action ?? "Replace"}
        onClose={() => setReplace(null)}
        onConfirm={() => replace?.apply()}
      />
      <Confirm
        open={activate}
        title="Apply this configuration?"
        description={`Apply ${artifact?.definition.profile.name ?? "the selected profile"}, revision ${artifact?.revision}, to ${device.name}. The currently applied version stays in use until the runtime accepts this request.`}
        action="Apply new configuration"
        destructive={false}
        onClose={() => setActivate(false)}
        onConfirm={async () => {
          const result = await run(() =>
            api.deviceAction(org, device.uuid, "activate", device.draft_revision),
          )
          setRevision(result.draft_revision)
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
          }
        }}
      />
    </div>
  )
}
