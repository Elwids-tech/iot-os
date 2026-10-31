import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AssistantRun } from "@iot-os/api-client"
import type { NodeType, Workflow } from "@iot-os/workflow-editor"
import { ArrowLeftIcon, PlusIcon, SendIcon, SquareIcon, WorkflowIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@iot-os/ui/components/card"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { InputGroup, InputGroupTextarea, InputGroupAddon } from "@iot-os/ui/components/input-group"
import { Message, MessageContent } from "@iot-os/ui/components/message"
import { ActionCard } from "@iot-os/ui/components/action-card"
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble"
import { Marker, MarkerContent } from "@iot-os/ui/components/marker"
import { Markdown, MarkdownLink } from "@iot-os/ui/components/markdown"
import { Thinking } from "@iot-os/ui/components/thinking"
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from "@iot-os/ui/components/message-scroller"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { usePanel, usePanelSlot } from "../panel/context"
import { conversationCost, formatCost } from "../assistant/cost"
import { DeviceStateReview } from "./DeviceStateConfig"
import { evidenceMarkdown, type ExecutionSelection, type ExecutionReferences, type EvidenceTarget } from "./execution-evidence"
import { changedNodes, draftSignature } from "./assistant-draft"
import { assistantSessionIds } from "./assistant-session"

type Target = { name: string; workflow: Workflow; draft_revision?: number }
type Proposal = { id: string; run_id?: string; summary: string; status: string; before: Target; changes: { values: { workflow: Workflow } }[] }
type Detail = { id: string; runs: (AssistantRun & { execution?: ExecutionReferences | null })[]; proposals: Proposal[] }
type Session = { id?: string; text: string; used: string[] }

type AssistantProps = {
  org: string; editorId: string; workflowId?: string; name: string; graph: Workflow; revision?: number;
  /** The workspace assistant's hand-off this editor was opened for. */
  handoff?: string;
  registry: NodeType[]; disabled: boolean; onApply: (graph: Workflow) => void;
  /** A recorded evaluation to explain instead of the editable draft. */
  execution?: ExecutionSelection; onClearExecution?: () => void; onEvidence: (target: EvidenceTarget) => void;
}

const explanationPrompt = "Explain this execution. What happened, which conditions were decisive, and what is known about action delivery? Cite the recorded evidence."

/**
 * The editor's conversation, portalled into the workspace panel's Ask tab while
 * the editor is mounted, so it keeps the editor's draft, registry and evidence
 * handlers. The header's Assistant control opens it.
 */
export function WorkflowAssistant(props: AssistantProps) {
  const panel = usePanel()
  const { execution, name } = props
  const target = usePanelSlot(
    execution ? `Evaluation ${execution.id}` : name || "This automation",
    execution
      ? `Explaining evaluation ${execution.id} · deployment ${execution.generation} · draft ${execution.draft_revision}`
      : `Build or refine “${name || "this automation"}”. Review suggestions before using them in your draft.`,
  )
  return target && createPortal(<WorkflowAssistantBody {...props} onClose={panel.closePanel} />, target)
}

function WorkflowAssistantBody({ org, editorId, workflowId, name, graph, revision, registry, disabled, onApply, execution: selectedExecution, onClearExecution, onEvidence, onClose, handoff }: AssistantProps & { onClose: () => void }) {
  const cache = useQueryClient()
  const panel = usePanel()
  const sessionIds = assistantSessionIds(editorId, workflowId, selectedExecution?.id)
  const sessionId = sessionIds[0]
  const key = ["workflow-assistant-session", org, sessionId]
  const [session, setSession] = useState<Session>(() => cache.getQueryData<Session>(key) ?? { text: "", used: [] })
  // The session follows the selected evaluation: switching between the draft and an explanation swaps conversations.
  useEffect(() => {
    setSession(cache.getQueryData<Session>(["workflow-assistant-session", org, sessionId]) ?? { text: "", used: [] })
    setError(undefined)
  }, [cache, org, sessionId])
  // A request chosen in the workspace assistant waits in the composer for the person to edit and send.
  const { handoff: pendingHandoff, takeHandoff } = panel
  useEffect(() => {
    if (pendingHandoff?.to !== "automation" || pendingHandoff.id !== handoff) return
    const text = pendingHandoff.text
    takeHandoff()
    setSession(current => ({ ...current, text }))
  }, [pendingHandoff, handoff, takeHandoff])
  const [autoExplain, setAutoExplain] = useState(false)
  const explained = useRef<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // The message being sent, shown at once until its run appears in the conversation.
  const [pending, setPending] = useState<{ prompt: string; runs: number }>()
  const [error, setError] = useState<unknown>()
  const [search, setSearch] = useState("")
  const operation = useRef(false)
  const request = useRef<{ signature: string; id: string } | undefined>(undefined)
  useEffect(() => {
    cache.setQueryDefaults(["workflow-assistant-session"], { gcTime: Infinity })
    for (const id of sessionIds) cache.setQueryData(["workflow-assistant-session", org, id], session)
  }, [cache, org, sessionIds.join(" "), session])
  const settings = useQuery({ queryKey: ["workflow-assistant-settings", org], queryFn: () => api.workflowAssistantSettings(org), retry: false, staleTime: 60000 })
  const conversations = useQuery({ queryKey: ["workflow-assistant-conversations", org], queryFn: () => api.workflowAssistantConversations(org), enabled: Boolean(settings.data), retry: false })
  const detail = useQuery({
    queryKey: ["workflow-assistant", org, session.id],
    queryFn: () => api.workflowAssistantDetail<Detail>(org, session.id!),
    enabled: Boolean(session.id), retry: false,
    refetchInterval: query => query.state.data?.runs.some(run => ["queued", "running"].includes(run.status)) ? 1000 : false,
  })
  const previousEvidence = detail.data?.runs.slice(-1)[0]?.execution
  const execution = selectedExecution ?? (previousEvidence ? { id: previousEvidence.evaluation_id, generation: previousEvidence.generation, draft_revision: previousEvidence.draft_revision } : undefined)
  const active = detail.data?.runs.find(run => ["queued", "running"].includes(run.status))
  const locked = busy || Boolean(active) || disabled || detail.isFetching && !detail.data
  const latest = detail.data?.proposals.filter(proposal => proposal.status === "pending").slice(-1)[0]
  const before = latest?.before
  const stale = before ? draftSignature(before.name, before.workflow) !== draftSignature(name, graph) : false
  const proposed = latest?.changes[0]?.values.workflow
  const used = latest && session.used.includes(latest.id)

  // "Explain this execution" opens the panel on a fresh evaluation session and asks once.
  useEffect(() => {
    if (!selectedExecution || session.id || explained.current === selectedExecution.id) return
    explained.current = selectedExecution.id
    setSession(current => ({ ...current, text: explanationPrompt }))
    setAutoExplain(true)
  }, [selectedExecution, session.id])
  useEffect(() => {
    if (autoExplain && settings.data?.enabled && !locked) {
      setAutoExplain(false)
      void send(explanationPrompt)
    }
  }, [autoExplain, settings.data?.enabled, locked])

  async function send(prompt = session.text.trim()) {
    if (operation.current || locked || !prompt.trim() || !settings.data?.enabled) return
    operation.current = true
    setBusy(true)
    setError(undefined)
    setPending({ prompt, runs: detail.data?.runs.length ?? 0 })
    setSession(current => ({ ...current, text: "" }))
    try {
      let id = session.id
      if (!id) {
        id = (await api.createWorkflowAssistantConversation(org, workflowId)).id
        setSession(current => ({ ...current, id }))
        void cache.invalidateQueries({ queryKey: ["workflow-assistant-conversations", org] })
      }
      const target: Target = { name, workflow: graph, draft_revision: revision }
      const signature = JSON.stringify({ text: prompt, target, execution_id: execution?.id })
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() }
      await api.workflowAssistantMessage(org, id, { request_id: request.current.id, text: prompt, target, execution_id: execution?.id })
      request.current = undefined
      // Cached detail younger than the default stale time, or a fetch begun with a new conversation, predates this
      // message; without its run nothing polls, so the reply would never appear. Invalidating replaces both.
      await cache.invalidateQueries({ queryKey: ["workflow-assistant", org, id] })
      await cache.fetchQuery({ queryKey: ["workflow-assistant", org, id], queryFn: () => api.workflowAssistantDetail<Detail>(org, id) })
    } catch (e) {
      setError(e)
      // Give the unsent message back so it can be retried or edited.
      if (request.current) setSession(current => current.text ? current : { ...current, text: prompt })
    } finally { operation.current = false; setBusy(false); setPending(undefined) }
  }

  return <div className="flex h-full min-h-0 flex-col" role="region" aria-label={selectedExecution ? "Explain execution" : "Automation assistant"}>
    {selectedExecution && onClearExecution && <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
      <Button variant="ghost" size="sm" onClick={onClearExecution}><ArrowLeftIcon data-icon="inline-start" />Back to the draft conversation</Button>
    </div>}
    <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
      <div className="min-w-0 flex-1"><SearchableSelect label="Automation conversation" labelHidden value={session.id ?? ""} placeholder="New conversation" search={search} onSearchChange={setSearch} disabled={locked} options={(conversations.data ?? []).filter(item => (item.id === session.id || item.workflow_uuid === (workflowId ?? null)) && item.title.toLowerCase().includes(search.toLowerCase())).map(item => ({ value: item.id, label: `${item.title} · ${item.id.slice(-6)}` }))} onChange={id => { setSession({ id, text: "", used: [] }); setError(undefined) }} /></div>
      <Button variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" disabled={locked || !session.id} onClick={() => { setSession({ text: "", used: [] }); setError(undefined) }}><PlusIcon /></Button>
    </div>
    <div className="min-h-0 flex-1">
      <MessageScrollerProvider autoScroll><MessageScroller><MessageScrollerViewport><MessageScrollerContent className="p-4">
        {!execution && <MessageScrollerItem messageId="intro">
          <Card><CardHeader><CardTitle>Describe the behavior you want</CardTitle><CardDescription>I can use available devices, their controls, and saved geofences to help configure this automation.</CardDescription></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">For example: “When GPS Demo Tracker enters GPS Demo Boundary, turn on the alarm for 3 seconds at 20% volume.”</p></CardContent>
            <CardFooter><Button variant="outline" disabled={locked} onClick={() => setSession(current => ({ ...current, text: "Explain this workflow and point out any missing configuration." }))}>Explain this workflow</Button></CardFooter>
          </Card>
        </MessageScrollerItem>}
        {detail.data?.runs.map(run => <MessageScrollerItem key={run.id} messageId={run.id} scrollAnchor>
          <div className="flex flex-col gap-4">
            <Message align="end"><MessageContent><Bubble align="end" variant="tinted"><BubbleContent className="whitespace-pre-wrap">{run.prompt}</BubbleContent></Bubble></MessageContent></Message>
            <Message><MessageContent>
              {run.answer && <Bubble variant="ghost"><BubbleContent><AnswerMarkdown answer={run.answer} evidence={run.execution} onEvidence={target => { onEvidence(target); onClose() }} /></BubbleContent></Bubble>}
              {run.status === "queued" ? <Thinking>Waiting for the assistant…</Thinking> : run.status === "running" && <Thinking>{run.execution ? "Reading the recorded evidence…" : "Thinking…"}</Thinking>}
              {run.status === "completed" && !run.answer && <Marker><MarkerContent>No response text.</MarkerContent></Marker>}
              {run.status === "cancelled" && <Marker><MarkerContent>Response stopped.</MarkerContent></Marker>}
              {run.execution && <div className="flex flex-col gap-1">
                <Button variant="outline" size="sm" onClick={() => { onEvidence({ evaluationId: run.execution!.evaluation_id }); onClose() }}>View evaluation {run.execution.evaluation_id} · deployment {run.execution.generation} · draft {run.execution.draft_revision}</Button>
                <p className="text-meta text-muted-foreground">Evidence captured {new Date(run.execution.captured_at).toLocaleString()}. Delivery may have progressed since this response.</p>
                {run.execution.trace_truncated && <Alert><AlertDescription>This execution has a partial trace. The explanation can only cover retained evidence.</AlertDescription></Alert>}
              </div>}
              {run.error_message && <Alert><AlertDescription>{run.error_message}</AlertDescription></Alert>}
            </MessageContent></Message>
          </div>
        </MessageScrollerItem>)}
        {pending && (detail.data?.runs.length ?? 0) === pending.runs && <MessageScrollerItem messageId="pending" scrollAnchor>
          <div className="flex flex-col gap-4">
            <Message align="end"><MessageContent><Bubble align="end" variant="tinted"><BubbleContent className="whitespace-pre-wrap">{pending.prompt}</BubbleContent></Bubble></MessageContent></Message>
            <Message><MessageContent><Thinking>Sending…</Thinking></MessageContent></Message>
          </div>
        </MessageScrollerItem>}
        {latest && proposed && before && <MessageScrollerItem messageId={latest.id}>
          <ActionCard icon={WorkflowIcon} label="Workflow proposal" title="Review the proposed workflow" description={latest.summary}>
            <div className="flex w-full flex-col gap-3">
              <Badge variant="outline">Validated draft · {proposed.nodes.length} nodes · {proposed.edges.length} connections</Badge>
              <ul className="flex flex-col gap-2 text-sm">{changedNodes(before.workflow, proposed).map(({ node, change }) => <li key={node.id}>{change} {registry.find(type => type.type === node.type)?.label ?? node.type} · {node.id}</li>)}</ul>
              {proposed.nodes.filter(node => node.type === "action.command.v1").map(node => <DeviceStateReview key={node.id} org={org} node={node} graph={proposed} />)}
              <details><summary className="cursor-pointer text-sm">Full proposed configuration</summary><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(proposed, null, 2)}</pre></details>
              <p className="text-sm text-muted-foreground">Using this proposal updates your editable draft. Save and review activation when ready. Undo restores the previous graph.</p>
              {stale && !used && <Alert><AlertDescription>Your draft changed after this request. Ask for an updated proposal to preserve your edits.</AlertDescription></Alert>}
            </div>
            <Button size="sm" disabled={locked || stale || Boolean(used)} onClick={() => {
              if (draftSignature(before.name, before.workflow) !== draftSignature(name, graph)) return
              onApply(proposed)
              setSession(current => ({ ...current, used: [...current.used, latest.id] }))
              onClose()
              toast.success("Proposal added to the draft. Review the canvas, then save when ready")
            }}>{used ? "Added to draft" : "Use this draft"}</Button>
          </ActionCard>
        </MessageScrollerItem>}
      </MessageScrollerContent></MessageScrollerViewport><MessageScrollerButton /></MessageScroller></MessageScrollerProvider>
    </div>
    <div className="flex shrink-0 flex-col gap-2 border-t px-3 py-3">
      <RequestError error={error ?? settings.error ?? detail.error ?? conversations.error} />
      {settings.data && !settings.data.enabled && <Alert><AlertDescription>The assistant is unavailable. You can continue editing manually.</AlertDescription></Alert>}
      <form onSubmit={event => { event.preventDefault(); void send() }}>
        <InputGroup><InputGroupTextarea aria-label="Message the automation assistant" placeholder={execution ? "Ask why a step or action behaved this way…" : "Describe a workflow or ask for a change…"} rows={2} maxLength={8000} value={session.text} onChange={event => setSession(current => ({ ...current, text: event.target.value }))} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
          <InputGroupAddon align="block-end"><span className="mr-auto text-meta text-muted-foreground">{execution ? `Using evaluation ${execution.id}` : "Suggestions for this draft"}</span>
            {active ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await api.assistantCancel(org, session.id!, active.id); await detail.refetch() } catch (e) { setError(e) } finally { setBusy(false) } }}><SquareIcon data-icon="inline-start" />Stop</Button> : <Button size="icon-sm" aria-label="Send automation message" disabled={locked || !settings.data?.enabled || !session.text.trim()}><SendIcon /></Button>}
          </InputGroupAddon></InputGroup>
      </form>
      <p className="text-meta text-muted-foreground">Your request, draft{execution ? ", the execution evidence" : ""} and the devices and geofences it uses go to {settings.data?.provider?.label ?? "the AI provider"}. Nothing is saved or activated for you.{conversationCost(detail.data?.runs) > 0 && <span className="tabular-nums"> · About {formatCost(conversationCost(detail.data?.runs))} so far</span>}</p>
    </div>
  </div>
}

/** A reply as Markdown; its recorded-evidence references become buttons that open the evaluation. */
function AnswerMarkdown({ answer, evidence, onEvidence }: { answer: string; evidence?: ExecutionReferences | null; onEvidence: (target: EvidenceTarget) => void }) {
  const { markdown, targets } = evidenceMarkdown(answer, evidence)
  return <Markdown components={{
    a: props => {
      const target = props.href?.startsWith("#evidence-") ? targets[Number(props.href.slice("#evidence-".length))] : undefined
      return target
        ? <Button variant="outline" size="sm" className="h-auto whitespace-normal px-1 py-0 align-baseline" onClick={() => onEvidence(target)}>{props.children}</Button>
        : <MarkdownLink {...props} />
    },
  }}>{markdown}</Markdown>
}
