import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import type { NodeType } from "@iot-os/workflow-editor"
import { ActivityIcon, ChevronDownIcon, ClockIcon, PauseIcon, PlayIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@iot-os/ui/components/accordion"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@iot-os/ui/components/empty"
import { Panel, PanelActions, PanelContent, PanelDescription, PanelFooter, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SegmentedControl, SegmentedControlItem } from "@iot-os/ui/components/segmented-control"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@iot-os/ui/components/sheet"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { cn } from "@iot-os/ui/lib/utils"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { actionLabel, actionStages, evidenceText, outcomeLabels, stepLabels, type Evaluation, type TimelineStep } from "./timeline"
import { bands, changes, dataHealth, formatSpan, stepCards, summarize, type RuntimeState, type SegmentTone, type Series, type SeriesPoint } from "./execution-model"

import type { EvidenceTarget } from "./execution-evidence"

export type LiveExecution = { enabled: boolean; stopped_reason?: string; consumer_healthy: boolean; state?: RuntimeState } | null | undefined

const ranges = [{ hours: 6, label: "6 h" }, { hours: 24, label: "24 h" }, { hours: 168, label: "7 d" }]
const timestamp = (value?: string) => !value || value.startsWith("0001-") ? "—" : new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })
const clockIn = (hours: number) => (ms: number) => new Date(ms).toLocaleString(undefined, hours > 24 ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit" })

const segmentClass: Record<SegmentTone, string> = {
  on: "bg-primary", off: "bg-muted-foreground/25", raised: "bg-destructive", clear: "bg-muted", fresh: "bg-muted-foreground/25",
  unknown: "border border-dashed border-muted-foreground/70", none: "bg-muted/40",
}
const legend: { tone: SegmentTone; label: string }[] = [
  { tone: "on", label: "On" }, { tone: "off", label: "Off" }, { tone: "raised", label: "Alert raised" }, { tone: "unknown", label: "No fresh reading" },
]

function Bar({ fraction, label }: { fraction: number; label: string }) {
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-2 overflow-hidden rounded-full bg-muted">
    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }} />
  </div>
}

function Evidence({ title, values }: { title: string; values: TimelineStep["inputs"] }) {
  if (!Object.keys(values).length) return null
  return <div className="flex min-w-0 flex-col gap-2"><h4 className="text-meta font-medium">{title}</h4>
    {Object.entries(values).map(([port, value]) => <div key={port} className="min-w-0 rounded-md border p-3">
      <div className="break-words text-body"><span className="font-medium">{port}: </span>{evidenceText(value)}</div>
      {value.known && <div className="text-meta text-muted-foreground">Observed {timestamp(value.observed_at)}{value.expires_at && !value.expires_at.startsWith("0001-") ? ` · Fresh until ${timestamp(value.expires_at)}` : ""}</div>}
      {value.window && <div className="text-meta text-muted-foreground">Window {value.window}</div>}
    </div>)}
  </div>
}

export function ExecutionTimeline({ org, workflowId, registry, evidenceTarget, renderAssistant, execution, deployment, titleOf }: {
  org: string; workflowId?: string; registry: NodeType[]; evidenceTarget?: EvidenceTarget & { sequence: number }
  renderAssistant: (evaluation: Evaluation) => ReactNode
  /** The runtime's live execution: whether it runs, and the state its duration steps count from. */
  execution?: LiveExecution
  /** Deployment state as the editor shows it, for example "applied". */
  deployment?: string
  titleOf: (nodeId: string) => string
}) {
  const [hours, setHours] = useState(6)
  const [selected, setSelected] = useState<string>()
  const [paused, setPaused] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(12)
  const series = useQuery({
    queryKey: ["automation-series", org, workflowId, hours],
    queryFn: () => api.automation<Series>(org, `/${workflowId}/series?hours=${hours}`),
    enabled: Boolean(workflowId), refetchInterval: paused ? false : hours > 6 ? 30000 : 5000, retry: false,
  })
  const detail = useQuery({
    queryKey: ["automation-evaluation", org, workflowId, selected],
    queryFn: () => api.automation<{ data: Evaluation }>(org, `/${workflowId}/timeline/${selected}`),
    enabled: Boolean(workflowId && selected), retry: false,
  })
  const item = detail.data?.data
  useEffect(() => {
    if (evidenceTarget) setSelected(evidenceTarget.evaluationId)
  }, [evidenceTarget])
  useEffect(() => {
    if (!item || item.id !== evidenceTarget?.evaluationId) return
    const suffix = evidenceTarget.step !== undefined ? `step-${evidenceTarget.step}` : evidenceTarget.action ? `action-${evidenceTarget.action}` : "details"
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`evaluation-${item.id}-${suffix}`)
      element?.scrollIntoView({ block: "center" })
      element?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [item?.id, evidenceTarget])

  const data = series.data
  const clock = useMemo(() => clockIn(hours), [hours])
  const view = useMemo(() => {
    if (!data) return undefined
    const now = Math.max(Date.parse(data.to), Date.now())
    return {
      summary: summarize(data, execution?.state, now, clock), cards: stepCards(data, execution?.state, now, titleOf),
      bands: bands(data, titleOf), changes: changes(data, titleOf), health: dataHealth(data),
      from: Date.parse(data.from), to: Date.parse(data.to),
    }
    // titleOf is rebuilt on every editor render; the graph it reads is covered by data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, execution?.state, clock])
  const range = ranges.find((entry) => entry.hours === hours)!.label
  const running = execution ? (execution.enabled ? { tone: "good" as const, label: "Running" } : { tone: "critical" as const, label: "Suspended" }) : { tone: "muted" as const, label: deployment === "applied" ? "Deployed" : "Not running" }
  const version = data?.data.at(-1)?.generation
  const quietRow = (point: SeriesPoint) => <li key={point.id}><Button variant="ghost" size="sm" className="h-auto w-full justify-start gap-2 py-1.5 font-normal" onClick={() => setSelected(point.id)}>
    {point.trigger === "timer" ? <ClockIcon data-icon="inline-start" /> : <ActivityIcon data-icon="inline-start" />}
    <span className="text-meta text-muted-foreground tabular-nums">{clock(Date.parse(point.at))}</span><span className="text-meta">{outcomeLabels[point.outcome] ?? point.outcome}</span>
  </Button></li>

  if (!workflowId) return <Panel><PanelContent><Empty><EmptyHeader><EmptyTitle>Save this automation to see it run</EmptyTitle><EmptyDescription>Simulation results appear in the Simulation tab. Live evaluations are recorded after activation.</EmptyDescription></EmptyHeader></Empty></PanelContent></Panel>

  return <div className="flex min-w-0 flex-col gap-4">
    <Panel>
      <PanelHeader>
        <StatusMark tone={running.tone} className="text-meta">{running.label}{version ? ` · version ${version}` : ""}{execution && !execution.consumer_healthy ? " · runtime consumer unhealthy" : ""}</StatusMark>
        <PanelActions>
          <Button variant="outline" size="sm" onClick={() => setPaused((value) => !value)}>{paused ? <PlayIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}{paused ? "Resume updates" : "Pause updates"}</Button>
          <Button variant="outline" size="sm" aria-label="Refresh execution" disabled={series.isFetching} onClick={() => void series.refetch()}><RefreshCwIcon /></Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3">
        <RequestError error={series.error} />
        {execution?.stopped_reason && <Alert variant="destructive"><AlertDescription>{execution.stopped_reason}</AlertDescription></Alert>}
        {series.isPending ? <Skeleton className="h-20" /> : view && <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-[999_1_24rem] flex-col gap-1">
            <StatusMark tone={view.summary.tone} className="text-meta text-muted-foreground">Right now</StatusMark>
            <p className="text-display text-balance">{view.summary.title}</p>
            <p className="text-body text-muted-foreground">{view.summary.detail}</p>
          </div>
          {view.summary.progress && <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3"><span className="text-heading">{formatSpan(view.summary.progress.elapsedMs)} of {formatSpan(view.summary.progress.totalMs)}</span>
              {view.summary.progress.elapsedMs < view.summary.progress.totalMs && <span className="text-meta text-muted-foreground">{formatSpan(view.summary.progress.totalMs - view.summary.progress.elapsedMs)} to go</span>}</div>
            <Bar fraction={view.summary.progress.elapsedMs / view.summary.progress.totalMs} label="Duration elapsed" />
            <div className="flex justify-between gap-3 text-meta text-muted-foreground"><span>Since {clock(view.summary.progress.sinceMs)}</span><span>Due {clock(view.summary.progress.dueMs)}</span></div>
          </div>}
        </div>}
      </PanelContent>
    </Panel>

    {view && view.cards.length > 0 && <section aria-label="Steps" className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
      {view.cards.map((card, index) => <Panel key={card.id} className={cn("gap-2 p-4", card.deciding && "ring-2 ring-primary")} aria-current={card.deciding ? "step" : undefined}>
        <div className="flex items-center justify-between gap-2 text-meta text-muted-foreground"><span className="truncate">{index + 1} · {titleOf(card.id)}</span>{card.deciding && <Badge variant="outline">Decides</Badge>}</div>
        <StatusMark tone={card.tone} className="text-title whitespace-normal">{card.headline}</StatusMark>
        {card.fraction !== undefined && <Bar fraction={card.fraction} label={`${titleOf(card.id)} progress`} />}
        <p className="text-meta text-muted-foreground">{card.caption || registry.find((type) => type.type === card.type)?.label || card.type}</p>
      </Panel>)}
    </section>}

    <Panel>
      <PanelHeader>
        <PanelTitle>Last {range}</PanelTitle>
        <PanelActions>
          <SegmentedControl aria-label="History period" value={String(hours)} onValueChange={(value) => value && setHours(Number(value))}>
            {ranges.map((entry) => <SegmentedControlItem key={entry.hours} value={String(entry.hours)}>{entry.label}</SegmentedControlItem>)}
          </SegmentedControl>
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3">
        {series.isPending ? <Skeleton className="h-24" /> : view && !data?.data.length ? <Empty><EmptyHeader><EmptyTitle>No recorded evaluations</EmptyTitle><EmptyDescription>Nothing was evaluated in the last {range}. An automation that is not active records nothing.</EmptyDescription></EmptyHeader></Empty> : view && <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">{legend.filter((entry) => view.bands.some((band) => band.segments.some((segment) => segment.tone === entry.tone))).map((entry) => <span key={entry.label} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={cn("size-3 rounded-sm", segmentClass[entry.tone])} />{entry.label}</span>)}</div>
          <div className="grid grid-cols-[minmax(4rem,9rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
            {view.bands.map((band) => <div key={band.id} className="contents">
              <div className="truncate text-meta text-muted-foreground" title={band.label}>{band.label}</div>
              <div className={cn("flex gap-px", band.id === "readings" ? "h-3" : "h-7")}>
                {band.segments.map((segment, index) => {
                  const style = { flexGrow: Math.max(1, segment.to - segment.from), flexBasis: 0 }
                  const text = `${band.label}: ${segment.label}, ${clock(segment.from)} to ${clock(segment.to)} (${formatSpan(segment.to - segment.from)})`
                  return segment.tone === "none" || !segment.pointId
                    ? <div key={index} style={style} title={text} className={cn("rounded-sm", segmentClass[segment.tone])} />
                    : <button key={index} type="button" style={style} title={text} aria-label={text} className={cn("min-w-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", segmentClass[segment.tone])} onClick={() => setSelected(segment.pointId)} />
                })}
              </div>
            </div>)}
            <div />
            <div className="flex justify-between border-t pt-1 text-meta text-muted-foreground tabular-nums">
              {[0, 1, 2, 3, 4, 5].map((step) => <span key={step} className={cn(step % 3 !== 0 && "max-md:hidden")}>{clock(view.from + ((view.to - view.from) * step) / 6)}</span>)}<span className="font-medium text-foreground">Now</span>
            </div>
          </div>
        </>}
      </PanelContent>
      <PanelFooter>Select a block to open that moment. A gap with no fresh reading pauses a duration; it does not restart it.</PanelFooter>
    </Panel>

    {view && Boolean(data?.data.length) && <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel>
        <PanelHeader><PanelTitle>What changed</PanelTitle><PanelDescription>{data!.data.length} evaluations in the last {range}</PanelDescription></PanelHeader>
        <PanelContent flush>
          <ol aria-label="Changes" className="flex flex-col divide-y">
            {view.changes.slice(0, shown).map((change, index) => change.kind === "event"
              ? <li key={`${change.pointId}-${index}`}><Button variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left font-normal whitespace-normal" onClick={() => setSelected(change.pointId)}>
                <span className="w-20 shrink-0 text-meta text-muted-foreground tabular-nums">{clock(Date.parse(change.at))}</span>
                <span className="flex min-w-0 flex-col"><StatusMark tone={change.tone} className="font-medium whitespace-normal">{change.title}</StatusMark>{change.detail && <span className="text-meta text-muted-foreground">{change.detail}</span>}</span>
              </Button></li>
              : <li key={`quiet-${change.points[0].id}`} className="flex flex-col">
                <Button variant="ghost" size="sm" aria-expanded={open.has(change.points[0].id)} className="h-auto justify-start gap-3 rounded-none px-4 py-2 font-normal text-muted-foreground" onClick={() => setOpen((current) => { const next = new Set(current); if (!next.delete(change.points[0].id)) next.add(change.points[0].id); return next })}>
                  <span className="w-20 shrink-0" /><span>{change.points.length} {change.points.length === 1 ? "check" : "checks"} with nothing new</span><ChevronDownIcon className={cn("transition-transform", open.has(change.points[0].id) && "rotate-180")} />
                </Button>
                {open.has(change.points[0].id) && <ol aria-label="Evaluations with nothing new" className="flex max-h-64 flex-col overflow-y-auto pb-2 pl-24">{[...change.points].reverse().map(quietRow)}</ol>}
              </li>)}
          </ol>
        </PanelContent>
        {view.changes.length > shown && <PanelFooter><Button variant="outline" size="sm" onClick={() => setShown((count) => count + 12)}>Show earlier changes</Button></PanelFooter>}
      </Panel>

      <Panel>
        <PanelHeader><PanelTitle>Is the data arriving?</PanelTitle></PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
            {[
              { value: view.health.reportGapMs, label: "between reports" },
              { value: view.health.ageOnArrivalMs, label: "old on arrival" },
              { value: view.health.freshMs, label: "counted as fresh" },
            ].map((stat) => <div key={stat.label} className="flex flex-col"><dd className="text-title">{stat.value === undefined ? "—" : formatSpan(stat.value)}</dd><dt className="text-meta text-muted-foreground">{stat.label}</dt></div>)}
            <div className="flex flex-col"><dd className="text-title">{view.health.gaps}</dd><dt className="text-meta text-muted-foreground">{view.health.gaps === 1 ? "gap" : "gaps"} with no fresh reading</dt></div>
          </dl>
          {view.health.suggestedFreshSeconds && <Alert><AlertDescription>Readings go stale before the next one arrives. Setting freshness to about {formatSpan(view.health.suggestedFreshSeconds * 1000)} on the input would close the gaps.</AlertDescription></Alert>}
        </PanelContent>
      </Panel>
    </div>}

    <p className="text-meta text-muted-foreground">Up to 1,000 recent evaluations are kept per automation, and organization retention may remove older ones sooner. Each one uses the version that was deployed then; editing the draft does not change past evidence.</p>

    <Sheet open={Boolean(selected)} onOpenChange={(next) => !next && setSelected(undefined)}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{item ? outcomeLabels[item.outcome] ?? item.outcome : "Evaluation"}</SheetTitle>
          <SheetDescription>{item ? `${timestamp(item.at)} · ${item.source ? `reading from ${item.source.device_name ?? item.source.device_uuid}` : "a timer was due"}` : "Loading the evidence for this moment."}</SheetDescription>
        </SheetHeader>
        <div id={item ? `evaluation-${item.id}-details` : undefined} tabIndex={-1} className="flex min-w-0 flex-col gap-4 px-6 py-4" aria-label="Evaluation details">
          <RequestError error={detail.error} />
          {detail.isPending && <Skeleton className="h-44" />}
          {item && <>
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Version {item.generation} · draft {item.draft_revision}</Badge>{renderAssistant(item)}</div>
            {item.diagnostic && <Alert variant="destructive"><AlertDescription>{item.diagnostic}</AlertDescription></Alert>}
            {item.trace_truncated && <Alert><AlertDescription>This evaluation exceeded the trace limit. Only the final 1,000 node steps are available.</AlertDescription></Alert>}
            <Accordion type="multiple" key={`${item.id}:${evidenceTarget?.sequence ?? 0}`} defaultValue={evidenceTarget?.evaluationId === item.id && evidenceTarget.step !== undefined ? [`step-${evidenceTarget.step}`] : []}>
              {item.trace?.map((step, index) => <AccordionItem key={index} id={`evaluation-${item.id}-step-${index}`} tabIndex={-1} value={`step-${index}`}>
                <AccordionTrigger><span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                  <span className="flex flex-wrap items-center gap-2"><span>{index + 1}. {titleOf(step.node_id)}</span><Badge variant="outline">{stepLabels[step.status] ?? step.status}</Badge></span>
                  <span className="text-meta font-normal text-muted-foreground">{step.reason}</span>
                </span></AccordionTrigger>
                <AccordionContent><div className="flex flex-col gap-3">
                  {step.event_note && <p className="text-muted-foreground">{step.event_note}</p>}
                  <p className="text-meta text-muted-foreground">{registry.find((type) => type.type === step.node_type)?.label ?? step.node_type} · {step.node_id}{step.binding ? ` · ${step.binding.device_name ?? step.binding.device_uuid} · ${step.binding.parameter_label ?? step.binding.role}${step.binding.unit ? ` (${step.binding.unit})` : ""}` : ""}</p>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2"><Evidence title="Inputs" values={step.inputs} /><Evidence title="Outputs" values={step.outputs} /></div>
                  <details><summary className="cursor-pointer text-meta text-muted-foreground">Step settings as deployed</summary><pre className="max-h-48 overflow-auto text-code">{JSON.stringify(step.config, null, 2)}</pre></details>
                </div></AccordionContent>
              </AccordionItem>)}
            </Accordion>
            <div className="flex flex-col gap-3"><h3 className="text-heading">Action delivery</h3>
              {!item.intent_ids.length && <p className="text-body text-muted-foreground">Nothing was sent by this evaluation. The steps above show why.</p>}
              {item.actions?.map((action) => <div key={action.id} id={`evaluation-${item.id}-action-${action.id}`} tabIndex={-1} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-col"><span className="font-medium">{action.device_name ?? (action.node_id ? titleOf(action.node_id) : "Action request")}{action.binding ? ` · ${action.parameter_label ?? action.binding} → ${JSON.stringify(action.value)}` : ""}</span><span className="text-meta text-muted-foreground">{actionLabel(action)}</span></div>
                {(action.diagnostic || action.command?.diagnostic) && <p className="text-body">{action.command?.diagnostic ?? action.diagnostic}</p>}
                <ol className="flex flex-col gap-2 border-l pl-4">{actionStages(action).map((stage, index) => <li key={index} className="text-body">{stage.label}<span className="block text-meta text-muted-foreground">{timestamp(stage.at)}</span></li>)}</ol>
                {action.command && <p className="break-all text-meta text-muted-foreground">Command {action.command.uuid}</p>}
              </div>)}
            </div>
            <details><summary className="cursor-pointer text-meta text-muted-foreground">Evidence identifiers</summary><div className="break-all text-meta text-muted-foreground">Evaluation {item.id}<br />Deployment {item.operation_uuid}{item.source && <><br />Telemetry event {item.source.event_id}<br />Device configuration {item.source.configuration_uuid}</>}</div></details>
          </>}
        </div>
      </SheetContent>
    </Sheet>
  </div>
}
