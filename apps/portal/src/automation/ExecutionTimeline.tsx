import { useEffect, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import type { NodeType } from "@iot-os/workflow-editor"
import { ActivityIcon, ClockIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@iot-os/ui/components/card"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@iot-os/ui/components/accordion"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@iot-os/ui/components/empty"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { actionLabel, actionStages, evidenceText, outcomeLabels, stepLabels, type Evaluation, type TimelineStep } from "./timeline"

import type { EvidenceTarget } from "./execution-evidence"

type Page = { data: Evaluation[]; next_cursor: string | null; retention_limit: number }
const timestamp = (value?: string) => !value || value.startsWith("0001-") ? "—" : new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })

function Evidence({ title, values }: { title: string; values: TimelineStep["inputs"] }) {
  if (!Object.keys(values).length) return null
  return <div className="flex min-w-0 flex-col gap-2"><h4 className="text-sm font-medium">{title}</h4>
    {Object.entries(values).map(([port, value]) => <div key={port} className="min-w-0 rounded-md border p-3">
      <div className="break-words text-sm"><span className="font-medium">{port}: </span>{evidenceText(value)}</div>
      {value.known && <div className="text-xs text-muted-foreground">Observed {timestamp(value.observed_at)}{value.expires_at && !value.expires_at.startsWith("0001-") ? ` · Fresh until ${timestamp(value.expires_at)}` : ""}</div>}
      {value.window && <div className="text-xs text-muted-foreground">Window {value.window}</div>}
    </div>)}
  </div>
}

export function ExecutionTimeline({ org, workflowId, registry, evidenceTarget, renderAssistant }: { org: string; workflowId?: string; registry: NodeType[]; evidenceTarget?: EvidenceTarget & { sequence: number }; renderAssistant: (evaluation: Evaluation) => ReactNode }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [selected, setSelected] = useState<string>()
  const [paused, setPaused] = useState(false)
  const before = cursors[cursors.length - 1]
  const list = useQuery({
    queryKey: ["automation-timeline", org, workflowId, before],
    queryFn: () => api.automation<Page>(org, `/${workflowId}/timeline${before ? `?before=${before}` : ""}`),
    enabled: Boolean(workflowId), refetchInterval: paused || before ? false : 5000, retry: false,
  })
  const selectedId = selected ?? list.data?.data[0]?.id
  useEffect(() => {
    if (list.data?.data[0]) setSelected(current => current ?? list.data.data[0].id)
  }, [list.data])
  const detail = useQuery({
    queryKey: ["automation-evaluation", org, workflowId, selectedId],
    queryFn: () => api.automation<{ data: Evaluation }>(org, `/${workflowId}/timeline/${selectedId}`),
    enabled: Boolean(workflowId && selectedId), refetchInterval: paused ? false : 5000, retry: false,
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
  return <Card>
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-col gap-1"><CardTitle>Execution timeline</CardTitle><CardDescription>Follow incoming telemetry, node decisions, and action delivery for the deployed workflow.</CardDescription></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={!workflowId} onClick={() => setPaused(value => !value)}>{paused ? "Resume updates" : "Pause updates"}</Button><Button variant="outline" size="sm" aria-label="Refresh execution timeline" disabled={!workflowId || list.isFetching} onClick={() => { void list.refetch(); if (selectedId) void detail.refetch() }}><RefreshCwIcon /></Button></div></div>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <RequestError error={list.error} />
      {!workflowId ? <Empty><EmptyHeader><EmptyTitle>Save this workflow to view its execution history</EmptyTitle><EmptyDescription>Simulation results appear in the Simulation tab. Live evaluations are recorded after activation.</EmptyDescription></EmptyHeader></Empty> : list.isPending ? <Skeleton className="h-44" /> : !list.error && !list.data?.data.length ? <Empty><EmptyHeader><EmptyTitle>No recorded evaluations</EmptyTitle><EmptyDescription>History starts when the runtime evaluates telemetry or a due timer after this feature was installed. Inactive workflows do not receive new evaluations.</EmptyDescription></EmptyHeader></Empty> : null}
      {Boolean(list.data?.data.length) && <div className="grid min-w-0 gap-5 xl:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="text-xs text-muted-foreground">{before ? "Browsing older evaluations" : paused ? "Updates paused" : "Latest evaluations · updates every 5 seconds"}</div>
          <ol aria-label="Workflow evaluations" className="flex max-h-[36rem] flex-col gap-2 overflow-y-auto">
            {list.data?.data.map(row => <li key={row.id}><Button variant={selectedId === row.id ? "secondary" : "outline"} aria-pressed={selectedId === row.id} className="h-auto w-full justify-start whitespace-normal p-3 text-left" onClick={() => setSelected(row.id)}>
              {row.trigger === "timer" ? <ClockIcon data-icon="inline-start" /> : <ActivityIcon data-icon="inline-start" />}
              <span className="flex min-w-0 flex-col gap-1"><span>{outcomeLabels[row.outcome] ?? row.outcome}</span><span className="text-xs text-muted-foreground">{timestamp(row.at)}</span><span className="text-xs text-muted-foreground">{row.source?.device_name ?? (row.trigger === "timer" ? "Timer evaluation" : "Telemetry evaluation")} · deployment {row.generation}</span></span>
            </Button></li>)}
          </ol>
          <div className="flex gap-2"><Button variant="outline" size="sm" disabled={cursors.length === 1} onClick={() => { setCursors([null]); setSelected(undefined) }}>Latest</Button><Button variant="outline" size="sm" disabled={!list.data?.next_cursor} onClick={() => { setCursors(current => [...current, list.data!.next_cursor]); setSelected(undefined) }}>Older</Button></div>
        </div>
        <div id={item ? `evaluation-${item.id}-details` : undefined} tabIndex={-1} className="flex min-w-0 flex-col gap-4" aria-label="Evaluation details">
          <RequestError error={detail.error} />
          {detail.isPending && <Skeleton className="h-44" />}
          {item && <>
            <div className="flex flex-wrap items-center gap-2"><Badge variant={item.outcome === "suspended" ? "destructive" : "secondary"}>{outcomeLabels[item.outcome] ?? item.outcome}</Badge><Badge variant="outline">Deployment {item.generation} · draft {item.draft_revision}</Badge><span className="text-xs text-muted-foreground">{timestamp(item.at)}</span></div>
            <div>{renderAssistant(item)}</div>
            <p className="text-sm">{item.source ? `Telemetry from ${item.source.device_name ?? item.source.device_uuid}` : "A scheduled runtime timer evaluated the workflow."}</p>
            {item.diagnostic && <Alert variant="destructive"><AlertDescription>{item.diagnostic}</AlertDescription></Alert>}
            {item.trace_truncated && <Alert><AlertDescription>This evaluation exceeded the trace limit. Only the final 1,000 node steps are available.</AlertDescription></Alert>}
            <Accordion type="multiple" key={`${item.id}:${evidenceTarget?.sequence ?? 0}`} defaultValue={evidenceTarget?.evaluationId === item.id && evidenceTarget.step !== undefined ? [`step-${evidenceTarget.step}`] : item.trace?.length ? ["step-0"] : []}>
              {item.trace?.map((step, index) => <AccordionItem key={index} id={`evaluation-${item.id}-step-${index}`} tabIndex={-1} value={`step-${index}`}>
                <AccordionTrigger><span className="flex flex-wrap items-center gap-2"><span>{index + 1}. {registry.find(type => type.type === step.node_type)?.label ?? step.node_type} · {step.node_id}</span><Badge variant="outline">{stepLabels[step.status] ?? step.status}</Badge></span></AccordionTrigger>
                <AccordionContent><div className="flex flex-col gap-3">
                  <p>{step.reason}</p>
                  {step.event_note && <p className="text-muted-foreground">{step.event_note}</p>}
                  {step.binding && <p className="text-muted-foreground">{step.binding.device_name ?? step.binding.device_uuid} · {step.binding.parameter_label ?? step.binding.role}{step.binding.unit ? ` (${step.binding.unit})` : ""}</p>}
                  <div className="grid min-w-0 gap-3 md:grid-cols-2"><Evidence title="Inputs" values={step.inputs} /><Evidence title="Outputs" values={step.outputs} /></div>
                  <details><summary className="cursor-pointer text-xs text-muted-foreground">Deployed node configuration</summary><pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(step.config, null, 2)}</pre></details>
                </div></AccordionContent>
              </AccordionItem>)}
            </Accordion>
            <div className="flex flex-col gap-3"><h3 className="text-sm font-medium">Action delivery</h3>
              {!item.intent_ids.length && <p className="text-sm text-muted-foreground">No action was requested by this evaluation. The node decisions above explain why.</p>}
              {item.actions?.map(action => <Card key={action.id} id={`evaluation-${item.id}-action-${action.id}`} tabIndex={-1}><CardHeader><CardTitle className="text-sm">{action.device_name ?? action.node_id ?? "Action request"}{action.binding ? ` · ${action.parameter_label ?? action.binding} → ${JSON.stringify(action.value)}` : ""}</CardTitle><CardDescription>{actionLabel(action)}</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">
                {(action.diagnostic || action.command?.diagnostic) && <p className="text-sm">{action.command?.diagnostic ?? action.diagnostic}</p>}
                <ol className="flex flex-col gap-2 border-l pl-4">{actionStages(action).map((stage, index) => <li key={index} className="text-sm">{stage.label}<span className="block text-xs text-muted-foreground">{timestamp(stage.at)}</span></li>)}</ol>
                {action.command && <p className="break-all text-xs text-muted-foreground">Command {action.command.uuid}</p>}
              </CardContent></Card>)}
            </div>
            <details><summary className="cursor-pointer text-xs text-muted-foreground">Evidence identifiers</summary><div className="break-all text-xs text-muted-foreground">Evaluation {item.id}<br />Deployment {item.operation_uuid}{item.source && <><br />Telemetry event {item.source.event_id}<br />Device configuration {item.source.configuration_uuid}</>}</div></details>
          </>}
        </div>
      </div>}
      <p className="text-xs text-muted-foreground">Up to {list.data?.retention_limit ?? 1000} recent evaluations are retained per workflow. Organization retention may remove older entries sooner. Each entry uses its deployed revision; editing the draft does not change past evidence.</p>
    </CardContent>
  </Card>
}
