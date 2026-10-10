import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AssistantRun } from "@iot-os/api-client"
import type { NodeType, Workflow } from "@iot-os/workflow-editor"
import { SparklesIcon, SendIcon, SquareIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@iot-os/ui/components/card"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@iot-os/ui/components/sheet"
import { InputGroup, InputGroupTextarea, InputGroupAddon } from "@iot-os/ui/components/input-group"
import { Message, MessageContent, MessageHeader } from "@iot-os/ui/components/message"
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble"
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from "@iot-os/ui/components/message-scroller"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { DeviceStateReview } from "./DeviceStateConfig"
import { evidenceParts, type ExecutionSelection, type ExecutionReferences, type EvidenceTarget } from "./execution-evidence"
import { changedNodes, draftSignature } from "./assistant-draft"

type Target = { name: string; workflow: Workflow; draft_revision?: number }
type Proposal = { id: string; run_id?: string; summary: string; status: string; before: Target; changes: { values: { workflow: Workflow } }[] }
type Detail = { id: string; runs: (AssistantRun & { execution?: ExecutionReferences | null })[]; proposals: Proposal[] }
type Session = { id?: string; text: string; used: string[] }

export function WorkflowAssistant({ org, editorId, workflowId, name, graph, revision, registry, disabled, onApply, execution: selectedExecution, onEvidence, size = "default" }: {
  org: string; editorId: string; workflowId?: string; name: string; graph: Workflow; revision?: number;
  registry: NodeType[]; disabled: boolean; onApply: (graph: Workflow) => void;
  execution?: ExecutionSelection; onEvidence: (target: EvidenceTarget) => void; size?: "default" | "sm";
}) {
  const cache = useQueryClient()
  const sessionId = selectedExecution ? `${editorId}:evaluation:${selectedExecution.id}` : editorId
  const key = ["workflow-assistant-session", org, sessionId]
  const [session, setSession] = useState<Session>(() => cache.getQueryData<Session>(key) ?? { text: "", used: [] })
  const [open, setOpen] = useState(false)
  const [autoExplain, setAutoExplain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [search, setSearch] = useState("")
  const operation = useRef(false)
  const request = useRef<{ signature: string; id: string } | undefined>(undefined)
  useEffect(() => {
    cache.setQueryDefaults(["workflow-assistant-session"], { gcTime: Infinity })
    cache.setQueryData(["workflow-assistant-session", org, sessionId], session)
  }, [cache, org, sessionId, session])
  const settings = useQuery({ queryKey: ["workflow-assistant-settings", org], queryFn: () => api.workflowAssistantSettings(org), enabled: open, retry: false })
  const conversations = useQuery({ queryKey: ["workflow-assistant-conversations", org], queryFn: () => api.workflowAssistantConversations(org), enabled: open && Boolean(settings.data), retry: false })
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

  const explanationPrompt = "Explain this execution. What happened, which conditions were decisive, and what is known about action delivery? Cite the recorded evidence."
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
      setSession(current => ({ ...current, text: "" }))
      request.current = undefined
      await cache.fetchQuery({ queryKey: ["workflow-assistant", org, id], queryFn: () => api.workflowAssistantDetail<Detail>(org, id) })
    } catch (e) { setError(e) } finally { operation.current = false; setBusy(false) }
  }

  return <>
    <Button variant="outline" size={size} disabled={disabled} onClick={() => { setOpen(true); if (execution && !session.id) { setSession(current => ({ ...current, text: explanationPrompt })); setAutoExplain(true) } }}><SparklesIcon data-icon="inline-start" />{execution ? "Explain this execution" : "AI assistant"}</Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b p-4">
          <SheetTitle>{execution ? "Explain execution" : "Automation assistant"}</SheetTitle>
          <SheetDescription>{execution ? `Evaluation ${execution.id} · deployment ${execution.generation} · draft ${execution.draft_revision}. Follow the evidence or ask about a proposed fix.` : `Build or refine “${name}”. Review suggestions before using them in your draft.`}</SheetDescription>
        </SheetHeader>
        <div className="flex shrink-0 items-end gap-2 border-b p-4">
          <div className="min-w-0 flex-1"><SearchableSelect label="Automation conversation" value={session.id ?? ""} placeholder="New conversation" search={search} onSearchChange={setSearch} disabled={locked} options={(conversations.data ?? []).filter(item => item.workflow_uuid === (workflowId ?? null) && item.title.toLowerCase().includes(search.toLowerCase())).map(item => ({ value: item.id, label: `${item.title} · ${item.id.slice(-6)}` }))} onChange={id => { setSession({ id, text: "", used: [] }); setError(undefined) }} /></div>
          <Button variant="outline" disabled={locked || !session.id} onClick={() => { setSession({ text: "", used: [] }); setError(undefined) }}>New chat</Button>
        </div>
        <div className="min-h-0 flex-1">
          <MessageScrollerProvider autoScroll><MessageScroller><MessageScrollerViewport><MessageScrollerContent className="p-4">
            {!execution && <MessageScrollerItem messageId="intro">
              <Card><CardHeader><CardTitle>Describe the behavior you want</CardTitle><CardDescription>I can use available devices, their controls, and saved geofences to help configure this automation.</CardDescription></CardHeader>
                <CardContent><p className="text-sm text-muted-foreground">For example: “When GPS Demo Tracker enters GPS Demo Boundary, turn on the alarm for 3 seconds at 20% volume.”</p></CardContent>
                <CardFooter><Button variant="outline" disabled={locked} onClick={() => setSession(current => ({ ...current, text: "Explain this workflow and point out any missing configuration." }))}>Explain this workflow</Button></CardFooter>
              </Card>
            </MessageScrollerItem>}
            {detail.data?.runs.map(run => <MessageScrollerItem key={run.id} messageId={run.id}>
              <div className="flex flex-col gap-4">
                <Message align="end"><MessageContent><MessageHeader>You</MessageHeader><Bubble><BubbleContent className="whitespace-pre-wrap">{run.prompt}</BubbleContent></Bubble></MessageContent></Message>
                <Message><MessageContent><MessageHeader>Automation assistant</MessageHeader><Bubble variant="secondary"><BubbleContent className="whitespace-pre-wrap">{evidenceParts(run.answer || (run.status === "queued" ? "Waiting for the assistant…" : run.status === "running" ? "Inspecting the evidence…" : "No response text."), run.execution).map((part, index) => part.target ? <Button key={index} variant="outline" size="sm" className="h-auto whitespace-normal px-1 py-0" onClick={() => { onEvidence(part.target!); setOpen(false) }}>{part.text}</Button> : part.text)}</BubbleContent></Bubble>
                  {run.execution && <div className="flex flex-col gap-1">
                    <Button variant="outline" size="sm" onClick={() => { onEvidence({ evaluationId: run.execution!.evaluation_id }); setOpen(false) }}>View evaluation {run.execution.evaluation_id} · deployment {run.execution.generation} · draft {run.execution.draft_revision}</Button>
                    <p className="text-xs text-muted-foreground">Evidence captured {new Date(run.execution.captured_at).toLocaleString()}. Delivery may have progressed since this response.</p>
                    {run.execution.trace_truncated && <Alert><AlertDescription>This execution has a partial trace. The explanation can only cover retained evidence.</AlertDescription></Alert>}
                  </div>}
                  {run.error_message && <Alert><AlertDescription>{run.error_message}</AlertDescription></Alert>}
                </MessageContent></Message>
              </div>
            </MessageScrollerItem>)}
            {latest && proposed && before && <MessageScrollerItem messageId={latest.id}>
              <Card><CardHeader><CardTitle>Review proposed workflow</CardTitle><CardDescription>{latest.summary}</CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Badge variant="outline">Validated draft · {proposed.nodes.length} nodes · {proposed.edges.length} connections</Badge>
                  <ul className="flex flex-col gap-2 text-sm">{changedNodes(before.workflow, proposed).map(({ node, change }) => <li key={node.id}>{change} {registry.find(type => type.type === node.type)?.label ?? node.type} · {node.id}</li>)}</ul>
                  {proposed.nodes.filter(node => node.type === "action.command.v1").map(node => <DeviceStateReview key={node.id} org={org} node={node} graph={proposed} />)}
                  <details><summary className="cursor-pointer text-sm">Full proposed configuration</summary><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(proposed, null, 2)}</pre></details>
                  <p className="text-sm text-muted-foreground">Using this proposal updates your editable draft. Save and review activation when ready. Undo restores the previous graph.</p>
                  {stale && !used && <Alert><AlertDescription>Your draft changed after this request. Ask for an updated proposal to preserve your edits.</AlertDescription></Alert>}
                </CardContent>
                <CardFooter><Button disabled={locked || stale || Boolean(used)} onClick={() => {
                  if (draftSignature(before.name, before.workflow) !== draftSignature(name, graph)) return
                  onApply(proposed)
                  setSession(current => ({ ...current, used: [...current.used, latest.id] }))
                  setOpen(false)
                  toast.success("Proposal added to the draft. Review the canvas, then save when ready.")
                }}>{used ? "Added to draft" : "Use this draft"}</Button></CardFooter>
              </Card>
            </MessageScrollerItem>}
          </MessageScrollerContent></MessageScrollerViewport><MessageScrollerButton /></MessageScroller></MessageScrollerProvider>
        </div>
        <div className="flex shrink-0 flex-col gap-3 border-t p-4">
          <RequestError error={error ?? settings.error ?? detail.error ?? conversations.error} />
          {settings.data && !settings.data.enabled && <Alert><AlertDescription>The assistant is unavailable. You can continue editing manually.</AlertDescription></Alert>}
          <form onSubmit={event => { event.preventDefault(); void send() }}>
            <InputGroup><InputGroupTextarea aria-label="Message the automation assistant" placeholder={execution ? "Ask why a step or action behaved this way…" : "Describe a workflow or ask for a change…"} rows={3} maxLength={8000} value={session.text} onChange={event => setSession(current => ({ ...current, text: event.target.value }))} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
              <InputGroupAddon align="block-end"><span className="mr-auto text-xs text-muted-foreground">{execution ? `Using evaluation ${execution.id}` : "Suggestions for this draft"}</span>
                {active ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await api.assistantCancel(org, session.id!, active.id); await detail.refetch() } catch (e) { setError(e) } finally { setBusy(false) } }}><SquareIcon data-icon="inline-start" />Stop</Button> : <Button size="icon-sm" aria-label="Send automation message" disabled={locked || !settings.data?.enabled || !session.text.trim()}><SendIcon /></Button>}
              </InputGroupAddon></InputGroup>
          </form>
          <p className="text-xs text-muted-foreground">Your request, draft, {execution ? "selected execution evidence, " : ""}and relevant device and geofence configuration are sent to OpenAI. Nothing is saved or activated automatically.</p>
        </div>
      </SheetContent>
    </Sheet>
  </>
}
