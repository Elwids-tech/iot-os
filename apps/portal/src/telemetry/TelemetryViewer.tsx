import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  TelemetryCapture,
  TelemetrySample,
  TelemetryDiagnosis,
} from "@iot-os/api-client"
import {
  ActivityIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
  SparklesIcon,
} from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import { Input } from "@iot-os/ui/components/input"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@iot-os/ui/components/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@iot-os/ui/components/dialog"
import { Field, FieldLabel } from "@iot-os/ui/components/field"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { Message, MessageContent } from "@iot-os/ui/components/message"
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble"
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
} from "@iot-os/ui/components/message-scroller"
import JsonCode from "@iot-os/ui/components/json-code"
import { api } from "../lib/api"
import { Choice, RequestError } from "../components/forms"
import {
  DeviceEmpty,
  DeviceStatus,
  formatValue,
  Section,
  useDeviceOrganization,
  devicePath,
} from "../devices/shared"
import { matchesSample, sampleStatus, wireHex } from "./model"

export default function TelemetryViewer() {
  const { org } = useDeviceOrganization()
  return <Viewer key={org} />
}
function Viewer() {
  const { org, capabilities, query: access } = useDeviceOrganization()
  const cache = useQueryClient()
  const [params, setParams] = useSearchParams()
  const captureId = params.get("capture") ?? ""
  const [gateway, setGateway] = useState(params.get("gateway") ?? "")
  const [device, setDevice] = useState("")
  const [gatewaySearch, setGatewaySearch] = useState("")
  const [deviceSearch, setDeviceSearch] = useState("")
  const [gatewayPage, setGatewayPage] = useState(1)
  const [devicePage, setDevicePage] = useState(1)
  const [duration, setDuration] = useState("300")
  const [tab, setTab] = useState("live")
  const [paused, setPaused] = useState(false)
  const [frozenSamples, setFrozenSamples] = useState<TelemetrySample[]>([])
  const [follow, setFollow] = useState(true)
  const [filter, setFilter] = useState("")
  const [kind, setKind] = useState("")
  const [pinned, setPinned] = useState<TelemetrySample | null>(null)
  const [confirm, setConfirm] = useState<"suspend" | "delete" | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const allowed = capabilities.view && capabilities.manage
  const gateways = useQuery({
    queryKey: ["telemetry-gateways", org, gatewaySearch, gatewayPage],
    queryFn: () =>
      api.gatewaysPage(org, {
        search: gatewaySearch,
        page: gatewayPage,
        per_page: 25,
      }),
    enabled: allowed,
  })
  const sources = useQuery({
    queryKey: ["telemetry-devices", org, gateway, deviceSearch, devicePage],
    queryFn: () =>
      api.discoveryPage(org, {
        gateway_uuid: gateway,
        search: deviceSearch,
        page: devicePage,
        per_page: 25,
      }),
    enabled: allowed && Boolean(gateway),
  })
  const captures = useQuery({
    queryKey: ["telemetry-captures", org],
    queryFn: () => api.telemetryCaptures(org),
    enabled: allowed,
    refetchInterval: 5000,
  })
  const capture = useQuery({
    queryKey: ["telemetry-capture", org, captureId],
    queryFn: () => api.telemetryCapture(org, captureId),
    enabled: allowed && Boolean(captureId),
    refetchInterval: 1000,
    retry: false,
  })
  const session = capture.data
  useEffect(() => {
    if (session) {
      setGateway(session.scope.gateway_uuid)
      setDevice(session.scope.device_uuid ?? "")
    }
  }, [session?.id])
  useEffect(() => {
    setPinned(null)
    setFollow(true)
    setPaused(false)
  }, [captureId])
  const live = Boolean(
    session &&
      !capture.isError &&
      !session.stopped &&
      Date.parse(session.expires_at) > now,
  )
  const suspended = live && Boolean(session?.suspended)
  const samples = paused ? frozenSamples : (session?.samples ?? [])
  const selected = follow
    ? (samples.at(-1) ?? pinned)
    : (samples.find((s) => s.id === pinned?.id) ?? pinned)
  const visible = samples
    .filter((s) => matchesSample(s, filter, kind))
    .slice()
    .reverse()
  const chooseCapture = (id: string) => {
    setPinned(null)
    setPaused(false)
    setFollow(true)
    setParams((p) => {
      p.set("capture", id)
      return p
    })
  }
  const start = useMutation({
    mutationFn: () =>
      api.startTelemetryCapture(org, {
        gateway_uuid: gateway,
        ...(device ? { device_uuid: device } : {}),
        duration_seconds: Number(duration),
      }),
    onSuccess: (s) => {
      cache.setQueryData(["telemetry-capture", org, s.id], s)
      chooseCapture(s.id)
      void cache.invalidateQueries({ queryKey: ["telemetry-captures", org] })
    },
  })
  const change = useMutation({
    mutationFn: (action: "stop" | "delete" | "suspend" | "resume") =>
      api.changeTelemetryCapture(org, captureId, action, action === "suspend"),
    onSuccess: (_, action) => {
      setConfirm(null)
      if (action === "delete") {
        setParams((p) => {
          p.delete("capture")
          return p
        })
        setPinned(null)
      }
      void cache.invalidateQueries({
        queryKey: ["telemetry-capture", org, captureId],
      })
      void cache.invalidateQueries({ queryKey: ["telemetry-captures", org] })
    },
  })
  function exportCapture() {
    if (!session) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(session, null, 2)], {
        type: "application/json",
      }),
    )
    const link = document.createElement("a")
    link.href = url
    link.download = `telemetry-${session.id}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function select(s: TelemetrySample) {
    setPinned(s)
    setFollow(false)
  }
  if (access.isPending)
    return (
      <div className="p-6">
        <Skeleton className="h-20" />
      </div>
    )
  if (access.error) return <RequestError error={access.error} />
  if (!allowed)
    return (
      <DeviceEmpty
        title="Telemetry access required"
        description="Device view and manage permissions are required to inspect captured payloads."
      />
    )
  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        helpContext={`telemetry.${tab === "stages" ? "processing" : tab === "ai" ? "troubleshoot" : "live"}`}
        title="Telemetry viewer"
        meta={<Badge variant="outline">Sparkplug B</Badge>}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!session}
              onClick={exportCapture}
            >
              <DownloadIcon data-icon="inline-start" />
              Export capture
            </Button>
            {live ? (
              <Button
                size="sm"
                disabled={
                  change.isPending || (suspended && !capabilities.activate)
                }
                onClick={() => change.mutate("stop")}
              >
                <SquareIcon data-icon="inline-start" />
                Stop capture
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!gateway || start.isPending}
                onClick={() => start.mutate()}
              >
                <ActivityIcon data-icon="inline-start" />
                {start.isPending ? "Starting…" : "Start capture"}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <RequestError
          error={
            start.error ||
            change.error ||
            gateways.error ||
            sources.error ||
            captures.error ||
            capture.error
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SearchableSelect
            label="Gateway"
            value={gateway}
            options={(gateways.data?.data ?? []).map((g) => ({
              value: g.uuid,
              label: g.name,
            }))}
            search={gatewaySearch}
            onSearchChange={(s) => {
              setGatewaySearch(s)
              setGatewayPage(1)
            }}
            onChange={(v) => {
              setGateway(v)
              setDevice("")
              setDevicePage(1)
            }}
            disabled={live}
            loading={gateways.isFetching}
            page={gatewayPage}
            hasNextPage={(gateways.data?.meta.last_page ?? 1) > gatewayPage}
            onPageChange={setGatewayPage}
          />
          <SearchableSelect
            label="Device"
            value={device}
            options={[
              { value: "", label: "All gateway sources" },
              ...(sources.data?.data ?? [])
                .filter((s) => s.assigned_device_uuid)
                .map((s) => ({
                  value: s.assigned_device_uuid!,
                  label: s.source_device_id || "Node metrics",
                })),
            ]}
            search={deviceSearch}
            onSearchChange={(s) => {
              setDeviceSearch(s)
              setDevicePage(1)
            }}
            onChange={setDevice}
            disabled={live || !gateway}
            loading={sources.isFetching}
            page={devicePage}
            hasNextPage={(sources.data?.meta.last_page ?? 1) > devicePage}
            onPageChange={setDevicePage}
          />
          <Choice
            label="Capture duration"
            value={duration}
            onChange={setDuration}
            disabled={live}
            options={[
              { value: "60", label: "1 minute" },
              { value: "300", label: "5 minutes" },
              { value: "600", label: "10 minutes" },
            ]}
          />
          <Choice
            label="Recent captures"
            value={captureId}
            onChange={chooseCapture}
            options={(captures.data ?? [])
              .slice()
              .sort((a, b) => b.started_at.localeCompare(a.started_at))
              .map((s) => ({
                value: s.id,
                label: `${s.scope.edge_node_id} · ${new Date(s.started_at).toLocaleTimeString()}`,
              }))}
          />
        </div>
        {!session ? (
          <DeviceEmpty
            title={
              capture.isFetching
                ? "Loading capture…"
                : "Inspect a live gateway stream"
            }
            description="Choose a gateway and start a timed capture. Inspect received payloads, processing stages and storage outcomes without changing normal ingestion."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
              <Badge variant={live ? "default" : "secondary"}>
                {live
                  ? `Capturing · ${Math.max(0, Math.ceil((Date.parse(session.expires_at) - now) / 1000))}s remaining`
                  : "Capture stopped"}
              </Badge>
              <span>
                {session.scope.edge_node_id} /{" "}
                {session.scope.source_device_id ?? "All sources"}
              </span>
              <span className="text-muted-foreground">Platform ingress</span>
              <span className="ml-auto">
                Production ingestion:{" "}
                {capture.isError
                  ? "Status unavailable"
                  : suspended
                    ? "Suspended for this device"
                    : "Unaffected by this capture"}
              </span>
              {capabilities.activate && session.scope.device_uuid && live && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={change.isPending}
                  onClick={() =>
                    suspended ? change.mutate("resume") : setConfirm("suspend")
                  }
                >
                  {suspended ? "Resume ingestion" : "Suspend…"}
                </Button>
              )}
              {!live && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirm("delete")}
                >
                  Delete capture
                </Button>
              )}
            </div>
            {suspended && (
              <Alert>
                <AlertTitle>
                  Production ingestion is temporarily suspended
                </AlertTitle>
                <AlertDescription>
                  Only this device is affected. Samples captured while suspended
                  are not stored or replayed. Ingestion resumes when this
                  capture stops, expires, or the runtime restarts.
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Captured", session.captured],
                ["In buffer", samples.length],
                [
                  "Issues in buffer",
                  samples.filter((s) =>
                    [
                      "rejected",
                      "handoff_failed",
                      "storage_retry",
                      "discarded",
                    ].includes(sampleStatus(s)),
                  ).length,
                ],
                ["Evicted / oversized", session.dropped],
              ].map(([label, value]) => (
                <div className="rounded-md border p-3" key={label}>
                  <div className="text-xl font-semibold tabular-nums">
                    {value}
                  </div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList variant="line">
                <TabsTrigger value="live">Live stream</TabsTrigger>
                <TabsTrigger value="stages">Processing stages</TabsTrigger>
                <TabsTrigger value="ai">AI troubleshoot</TabsTrigger>
              </TabsList>
              <TabsContent value="live">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <section className="min-w-0 rounded-md border">
                    <div className="flex flex-wrap items-center gap-2 border-b p-3">
                      <Input
                        aria-label="Filter messages"
                        placeholder="Filter topic, metric or value…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="min-w-40 flex-1"
                      />
                      <div className="w-36">
                        <Choice
                          label="Message type"
                          value={kind || "all"}
                          onChange={(v) => setKind(v === "all" ? "" : v)}
                          options={[
                            "all",
                            "NBIRTH",
                            "DBIRTH",
                            "NDATA",
                            "DDATA",
                            "NDEATH",
                            "DDEATH",
                          ].map((v) => ({
                            value: v,
                            label: v === "all" ? "All types" : v,
                          }))}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFrozenSamples(session.samples ?? [])
                          setPaused(!paused)
                        }}
                      >
                        {paused ? (
                          <PlayIcon data-icon="inline-start" />
                        ) : (
                          <PauseIcon data-icon="inline-start" />
                        )}
                        {paused ? "Resume view" : "Pause view"}
                      </Button>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={follow}
                          onCheckedChange={(v) => setFollow(v === true)}
                        />
                        Follow newest
                      </label>
                    </div>
                    <div className="max-h-[520px] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Time</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Seq</TableHead>
                            <TableHead>Result</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visible.map((s) => (
                            <TableRow
                              key={s.id}
                              data-state={
                                selected?.id === s.id ? "selected" : undefined
                              }
                            >
                              <TableCell>
                                <button
                                  className="font-mono text-xs underline underline-offset-2"
                                  onClick={() => select(s)}
                                  aria-label={`Inspect ${s.kind} ${s.id}`}
                                >
                                  {new Date(s.received_at).toLocaleTimeString()}
                                </button>
                              </TableCell>
                              <TableCell>{s.kind}</TableCell>
                              <TableCell>
                                {s.source_device_id || "Node"}
                              </TableCell>
                              <TableCell>{s.seq ?? "—"}</TableCell>
                              <TableCell>
                                <DeviceStatus value={sampleStatus(s)} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {!visible.length && (
                      <DeviceEmpty
                        title={
                          samples.length
                            ? "No matching messages"
                            : "Waiting for gateway messages"
                        }
                        description="Capture only includes messages received after it starts. No data is not a zero reading."
                      />
                    )}
                  </section>
                  {selected ? (
                    <Inspector
                      sample={selected}
                      onCompare={() => setTab("stages")}
                    />
                  ) : (
                    <DeviceEmpty title="Select a message" />
                  )}
                </div>
              </TabsContent>
              <TabsContent value="stages">
                {selected ? (
                  <Stages sample={selected} onAsk={() => setTab("ai")} />
                ) : (
                  <DeviceEmpty title="Select a message in Live stream" />
                )}
              </TabsContent>
              <TabsContent value="ai">
                <Diagnosis
                  key={session.id}
                  org={org}
                  session={session}
                  selected={selected ?? null}
                  onEvidence={(id) => {
                    const s = samples.find((s) => s.id === id)
                    if (s) {
                      select(s)
                      setTab("stages")
                    }
                  }}
                />
              </TabsContent>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              Latest 200 messages · up to 64 KiB per sample · available until{" "}
              {new Date(session.purge_at).toLocaleTimeString()} · captures are
              cleared on runtime restart.{" "}
              {paused && "View paused; capture continues."}
            </p>
          </>
        )}
      </div>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "suspend"
                ? "Suspend this device’s ingestion?"
                : "Delete this capture?"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "suspend"
                ? "New samples from this device will remain visible here but will not update production measurements or trigger downstream telemetry workflows. They will not be replayed. Ingestion resumes automatically when the capture expires. Already queued samples may finish storing."
                : "This permanently removes the captured diagnostic samples. Production measurements are unaffected."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              disabled={change.isPending}
              onClick={() => confirm && change.mutate(confirm)}
            >
              {confirm === "suspend"
                ? "Suspend until capture ends"
                : "Delete capture"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Inspector({
  sample,
  onCompare,
}: {
  sample: TelemetrySample
  onCompare: () => void
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-md border p-4">
      <Section
        title="Message inspector"
        meta={<Badge variant="outline">{sample.kind}</Badge>}
      >
        <p className="break-all font-mono text-xs text-muted-foreground">
          {sample.id}
        </p>
      </Section>
      <p className="break-all font-mono text-xs">{sample.topic}</p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>Sequence</dt>
        <dd>{sample.seq ?? "Unavailable"}</dd>
        <dt>Birth sequence</dt>
        <dd>{sample.bd_seq ?? "Not in this packet"}</dd>
        <dt>Payload</dt>
        <dd>{sample.payload_bytes} B</dd>
        <dt>Birth context</dt>
        <dd>{sample.birth_session ? "Available" : "Unavailable"}</dd>
        <dt>Result</dt>
        <dd>
          <DeviceStatus value={sampleStatus(sample)} />
        </dd>
      </dl>
      {sample.diagnostic && (
        <Alert>
          <AlertTitle>Protocol diagnostic</AlertTitle>
          <AlertDescription>{sample.diagnostic}</AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="decoded">
        <TabsList variant="line">
          <TabsTrigger value="decoded">Decoded metrics</TabsTrigger>
          <TabsTrigger value="wire">Wire bytes</TabsTrigger>
        </TabsList>
        <TabsContent value="decoded">
          <div className="h-64">
            <JsonCode
              label="Decoded Sparkplug metrics"
              readOnly
              value={JSON.stringify(sample.metrics ?? [], null, 2)}
            />
          </div>
        </TabsContent>
        <TabsContent value="wire">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
            {wireHex(sample.wire_base64)}
          </pre>
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        Decoded representation of binary protobuf. Raw means data received from
        the gateway.
      </p>
      <Button variant="outline" onClick={onCompare}>
        Compare stages
      </Button>
    </section>
  )
}
function Stages({
  sample,
  onAsk,
}: {
  sample: TelemetrySample
  onAsk: () => void
}) {
  const outcomes = sample.outcomes ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">{sample.kind}</Badge>
        <p className="break-all font-mono text-xs">{sample.id}</p>
        <Button className="ml-auto" variant="outline" onClick={onAsk}>
          <SparklesIcon data-icon="inline-start" />
          Ask about this sample
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          "Raw ingress",
          "Decoded / aliases",
          "Mapped / calibrated",
          "Validated / calculated",
          "Persistence",
        ].map((label, i) => (
          <div key={label} className="rounded-md border p-3">
            <span className="text-xs text-muted-foreground">
              {i < 2 ? "Gateway / protocol" : "Platform processing"}
            </span>
            <h3 className="mt-1 text-sm font-medium">{label}</h3>
            <p className="mt-2 text-xs">
              {i === 0
                ? `${sample.payload_bytes} bytes received`
                : i === 1
                  ? sample.status
                  : i === 4
                    ? sampleStatus(sample)
                    : outcomes.some((o) => o.stages?.length)
                      ? "Evidence available"
                      : "Not processed"}
            </p>
          </div>
        ))}
      </div>
      {sample.diagnostic && (
        <Alert>
          <AlertTitle>Capture diagnostic</AlertTitle>
          <AlertDescription>{sample.diagnostic}</AlertDescription>
        </Alert>
      )}
      {!outcomes.length && (
        <DeviceEmpty
          title="No platform processing for this message"
          description="Birth/death packets, unassigned sources, rejected messages and unmapped metrics may have no reading stages. Inspect protocol evidence in Live stream."
        />
      )}
      {outcomes.map((o) => (
        <section key={o.device_uuid} className="min-w-0 rounded-md border p-4">
          <Section
            title="Field lineage and values"
            meta={<DeviceStatus value={o.status} />}
          >
            <p className="mb-3 break-all text-xs text-muted-foreground">
              Device {o.device_uuid} · Configuration {o.configuration_uuid}
            </p>
            {o.diagnostic && (
              <Alert>
                <AlertTitle>Processing diagnostic</AlertTitle>
                <AlertDescription>{o.diagnostic}</AlertDescription>
              </Alert>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received metric</TableHead>
                  <TableHead>Mapped field</TableHead>
                  <TableHead>Decoded</TableHead>
                  <TableHead>Conversion</TableHead>
                  <TableHead>Calibrated</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Stored</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(o.stages ?? []).map((t) => (
                  <TableRow key={t.parameter_uuid}>
                    <TableCell className="font-mono">{t.metric}</TableCell>
                    <TableCell>{t.key}</TableCell>
                    <TableCell>{formatValue(t.raw)}</TableCell>
                    <TableCell>
                      {t.conversion
                        ? `× ${t.conversion.multiplier ?? 1} + ${t.conversion.offset ?? 0}`
                        : "Identity"}
                    </TableCell>
                    <TableCell>
                      {formatValue(t.converted)} {t.unit}
                    </TableCell>
                    <TableCell>
                      <DeviceStatus value={t.quality} />
                      {t.diagnostic && (
                        <p className="max-w-60 text-xs">{t.diagnostic}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {o.status === "stored"
                        ? formatValue(
                            o.readings?.find(
                              (r) => r.parameter_uuid === t.parameter_uuid,
                            )?.value,
                          )
                        : "Not confirmed"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">Decoded metrics</h3>
                <div className="h-64">
                  <JsonCode
                    readOnly
                    label="Stage decoded metrics"
                    value={JSON.stringify(sample.metrics, null, 2)}
                  />
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Validated and calculated readings · {o.status}
                </h3>
                <div className="h-64">
                  <JsonCode
                    readOnly
                    label="Processed readings"
                    value={JSON.stringify(o.readings, null, 2)}
                  />
                </div>
              </div>
            </div>
          </Section>
        </section>
      ))}
    </div>
  )
}
function Diagnosis({
  org,
  session,
  selected,
  onEvidence,
}: {
  org: string
  session: TelemetryCapture
  selected: TelemetrySample | null
  onEvidence: (id: string) => void
}) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<{
    question: string
    result: TelemetryDiagnosis
    device?: string
  } | null>(null)
  const [review, setReview] = useState(false)
  const diagnose = useMutation({
    mutationFn: ({ text, sample }: { text: string; sample: TelemetrySample }) =>
      api.diagnoseTelemetry(org, session.id, text, [sample.id]),
    onSuccess: (result, input) =>
      setAnswer({
        question: input.text,
        result,
        device: input.sample.outcomes?.[0]?.device_uuid,
      }),
  })
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-md border p-4">
        <Section
          title="Capture evidence"
          meta={<Badge variant="outline">Read only</Badge>}
        >
          <p className="mb-4 text-sm text-muted-foreground">
            Select a message in Live stream. AI receives that sample’s decoded
            values and processing outcomes.
          </p>
          {selected ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt>Message type</dt>
                <dd>{selected.kind}</dd>
                <dt>Birth context</dt>
                <dd>{selected.birth_session ? "Resolved" : "Unavailable"}</dd>
                <dt>Protocol result</dt>
                <dd>
                  <DeviceStatus value={selected.status} />
                </dd>
                <dt>Production outcome</dt>
                <dd>
                  <DeviceStatus value={sampleStatus(selected)} />
                </dd>
              </dl>
              <p className="mt-4 break-all font-mono text-xs">{selected.id}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => onEvidence(selected.id)}
              >
                Inspect evidence
              </Button>
            </>
          ) : (
            <DeviceEmpty title="Waiting for a selected sample" />
          )}
          <Alert className="mt-4">
            <AlertTitle>Bounded evidence</AlertTitle>
            <AlertDescription>
              A missing birth message in this capture does not prove an
              onboarding failure. Capture starts now; earlier messages may be
              outside the window.
            </AlertDescription>
          </Alert>
        </Section>
      </section>
      <section className="flex min-w-0 flex-col gap-4 rounded-md border p-4">
        <Section
          title="Telemetry assistant"
          meta={<Badge variant="outline">Selected sample only</Badge>}
        >
          <p className="text-sm text-muted-foreground">
            Evidence-linked explanations and configuration suggestions.
          </p>
        </Section>
        <RequestError error={diagnose.error} />
        <div className="h-80">
          <MessageScrollerProvider>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent>
                  {answer ? (
                    <>
                      <Message align="end">
                        <MessageContent>
                          <Bubble variant="secondary">
                            <BubbleContent>{answer.question}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                      <Message>
                        <MessageContent>
                          <Bubble variant="outline">
                            <BubbleContent>
                              <p className="whitespace-pre-wrap">
                                {answer.result.explanation}
                              </p>
                              <p className="mt-3">{answer.result.next_check}</p>
                            </BubbleContent>
                          </Bubble>
                          <div className="flex flex-wrap gap-2">
                            {answer.result.evidence_ids.map((id) => (
                              <Button
                                variant="outline"
                                size="sm"
                                key={id}
                                disabled={
                                  !session.samples?.some((s) => s.id === id)
                                }
                                onClick={() => onEvidence(id)}
                              >
                                Sample {id.slice(0, 8)}
                              </Button>
                            ))}
                          </div>
                          {answer.result.suggested_review && (
                            <Button
                              variant="outline"
                              onClick={() => setReview(true)}
                            >
                              Review suggested change
                            </Button>
                          )}
                        </MessageContent>
                      </Message>
                    </>
                  ) : (
                    <DeviceEmpty
                      title="Ask about the captured data"
                      description="For example: Why does the stored value differ from the received value?"
                    />
                  )}
                  {diagnose.isPending && (
                    <p role="status" className="text-sm text-muted-foreground">
                      Analyzing selected evidence…
                    </p>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (selected && question.trim())
              diagnose.mutate({ text: question.trim(), sample: selected })
          }}
          className="flex items-end gap-2"
        >
          <Field>
            <FieldLabel htmlFor="telemetry-question">
              Ask about this sample
            </FieldLabel>
            <Input
              id="telemetry-question"
              value={question}
              maxLength={2000}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Why is this reading invalid?"
            />
          </Field>
          <Button
            type="submit"
            disabled={!selected || !question.trim() || diagnose.isPending}
          >
            Analyze
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          No broker access · No automatic changes · Uses the configured AI
          allowance
        </p>
      </section>
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review configuration suggestion</DialogTitle>
            <DialogDescription>
              No changes have been applied. Verify the suggestion against device
              documentation or a reference measurement before editing.
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm">
            {answer?.result.suggested_review}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(false)}>
              Dismiss
            </Button>
            {answer?.device && (
              <Button asChild>
                <Link to={devicePath(org, answer.device) + "/configuration"}>
                  Open device configuration
                </Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
