import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AssistantAnswer,
  AssistantConversation,
  AssistantDetail,
  AssistantProposal,
  AssistantQuestion,
} from "@iot-os/api-client"
import { ApiError } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
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
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
} from "@iot-os/ui/components/input-group"
import { Textarea } from "@iot-os/ui/components/textarea"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import {
  Attachment,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentGroup,
} from "@iot-os/ui/components/attachment"
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@iot-os/ui/components/message"
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble"
import { Marker, MarkerContent } from "@iot-os/ui/components/marker"
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@iot-os/ui/components/message-scroller"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { keepToastsAbove } from "@iot-os/ui/components/sonner"
import {
  FileTextIcon,
  PlusIcon,
  SendIcon,
  SquareIcon,
  Trash2Icon,
  PaperclipIcon,
  CheckIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useDirtyContext } from "../lib/unsaved"
import { Choice, Confirm, RequestError } from "../components/forms"
import { ProposalReview } from "./ProposalReview"
import { applyTextEvents } from "./state"
import { conversationCost, formatCost } from "./cost"

type Draft = { text: string; sources: string[] }
const emptyDraft: Draft = { text: "", sources: [] }
const isActive = (detail: AssistantDetail | null) =>
  detail?.runs.some(
    (run) => run.status === "running" || run.status === "queued",
  ) ?? false

function Questions({
  questions,
  busy,
  onAnswer,
}: {
  questions: AssistantQuestion[]
  busy: boolean
  onAnswer: (answers: AssistantAnswer[]) => Promise<void>
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  return (
    <Card>
      <CardHeader>
        <CardTitle>A few details</CardTitle>
        <CardDescription>
          Answer what you know. “I don’t know yet” keeps uncertainty visible.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {questions.map((question) => (
            <Field key={question.id}>
              <FieldLabel htmlFor={`question-${question.id}`}>
                {question.prompt}{" "}
                <Badge variant="outline">
                  {question.required ? "Required" : "Optional"}
                </Badge>
              </FieldLabel>
              {question.options.length > 0 && (
                <Choice
                  label="Suggested answer"
                  value={
                    question.options.includes(answers[question.id])
                      ? answers[question.id]
                      : ""
                  }
                  options={[
                    { value: "", label: "Choose or type below" },
                    ...question.options.map((value) => ({
                      value,
                      label: value,
                    })),
                  ]}
                  onChange={(value) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: value,
                    }))
                  }
                />
              )}
              <Textarea
                id={`question-${question.id}`}
                value={answers[question.id] ?? ""}
                maxLength={1000}
                rows={2}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
                disabled={busy}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: "I don’t know yet",
                    }))
                  }
                >
                  I don’t know yet
                </Button>
                {!question.required && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: "Skip for now",
                      }))
                    }
                  >
                    Skip for now
                  </Button>
                )}
              </div>
            </Field>
          ))}
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button
          disabled={
            busy || questions.some((question) => !answers[question.id]?.trim())
          }
          onClick={() =>
            void onAnswer(
              questions.map((question) => ({
                id: question.id,
                answer: answers[question.id].trim(),
              })),
            )
          }
        >
          Continue with these answers
        </Button>
      </CardFooter>
    </Card>
  )
}

/**
 * The device-profile authoring conversation. It is one body of the shared
 * workspace panel (see help/HelpPanel.tsx), which owns the frame, the tabs,
 * docking and the close control; this component owns the conversation.
 */
export default function ProfileAssistantBody({
  org,
  organizationName,
  viewedProfile,
}: {
  org: string
  organizationName: string
  viewedProfile?: string
}) {
  const cache = useQueryClient()
  const { dirty } = useDirtyContext()
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  // Below xl the workspace panel is a full-height sheet, so toasts must clear the composer.
  const [sheet] = useState(() => !window.matchMedia("(min-width: 1280px)").matches)
  const [selected, setSelected] = useState<string | null>(
    () => cache.getQueryData<string>(["assistant-selected", org]) ?? null,
  )
  const [detail, setDetail] = useState<AssistantDetail | null>(null)
  const detailRef = useRef(detail)
  detailRef.current = detail
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    () =>
      cache.getQueryData<Record<string, Draft>>(["assistant-drafts", org]) ??
      {},
  )
  const [review, setReview] = useState<AssistantProposal | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [connectionError, setConnectionError] = useState<unknown>(null)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const operation = useRef(false)
  const decisionRequestIds = useRef(new Map<string, string>())
  useEffect(() => {
    for (const key of [
      "assistant-drafts",
      "assistant-selected",
      "assistant-review-draft",
    ])
      cache.setQueryDefaults([key], { gcTime: Infinity })
  }, [cache])
  const fileInput = useRef<HTMLInputElement>(null)
  const settings = useQuery({
    queryKey: ["assistant-settings", org],
    queryFn: () => api.assistantSettings(org),
    staleTime: 60000,
    retry: false,
  })
  const conversations = useQuery({
    queryKey: ["assistant-conversations", org],
    queryFn: () => api.assistantConversations(org),
    enabled: !!settings.data,
    retry: false,
  })
  const draftKey = selected ?? "new"
  const draft = drafts[draftKey] ?? emptyDraft
  const active = isActive(detail)
  const locked = busy || active || loading || uploading
  const available = settings.data?.enabled ?? false
  function updateDraft(change: Partial<Draft>, key = draftKey) {
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? emptyDraft), ...change },
    }))
  }
  useEffect(() => {
    cache.setQueryData(["assistant-drafts", org], drafts)
  }, [cache, org, drafts])
  useEffect(() => {
    cache.setQueryData(["assistant-selected", org], selected)
  }, [cache, org, selected])
  useEffect(() => {
    const restored = () => setSessionEpoch((value) => value + 1)
    window.addEventListener("iot-session-restored", restored)
    return () => window.removeEventListener("iot-session-restored", restored)
  }, [])
  // Use an isolated cursor per conversation. Polling continues when the panel is closed.
  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      cursor = 0
    const current = selected
    setLoading(true)
    setDetail(null)
    setConnectionError(null)
    async function snapshot() {
      const next = await api.assistantConversation(org, current)
      if (stopped) return
      cursor = next.cursor
      detailRef.current = next
      setDetail(next)
      setLoading(false)
      setConnectionError(null)
    }
    async function poll() {
      try {
        cursor = Math.max(
          cursor,
          detailRef.current?.id === current ? detailRef.current.cursor : 0,
        )
        const result = await api.assistantEvents(org, current, cursor)
        if (stopped) return
        setConnectionError(null)
        if (result.events.length) {
          cursor = result.events[result.events.length - 1].id
          // Full snapshots on structural events include durable question and proposal cards.
          if (result.events.some((event) => event.type !== "text_delta"))
            await snapshot()
          else
            setDetail(
              (previous) =>
                previous && applyTextEvents(previous, result.events),
            )
        }
        if (!stopped) timer = setTimeout(poll, result.active ? 500 : 3000)
      } catch (error) {
        if (!stopped) {
          setConnectionError(error)
          if (
            !(
              error instanceof ApiError &&
              [401, 403, 404, 419].includes(error.status)
            )
          )
            timer = setTimeout(poll, 5000)
        }
      }
    }
    void snapshot()
      .then(() => {
        if (!stopped) timer = setTimeout(poll, 500)
      })
      .catch((error) => {
        if (!stopped) {
          setConnectionError(error)
          setLoading(false)
        }
      })
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [org, selected, sessionEpoch])
  async function refresh(id = selectedRef.current) {
    if (!id) return
    const next = await api.assistantConversation(org, id)
    if (selectedRef.current === id) {
      detailRef.current = next
      setDetail(next)
    }
    await cache.invalidateQueries({
      queryKey: ["assistant-conversations", org],
    })
  }
  async function create(profile?: string): Promise<AssistantConversation> {
    const conversation = await api.createAssistantConversation(org, profile)
    selectedRef.current = conversation.id
    setSelected(conversation.id)
    setReview(null)
    await cache.invalidateQueries({
      queryKey: ["assistant-conversations", org],
    })
    return conversation
  }
  async function perform(action: () => Promise<void>) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (error) {
      setError(error)
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  async function send(text = draft.text, answers: AssistantAnswer[] = []) {
    if (!text.trim() || locked || !available) return
    await perform(async () => {
      const previousKey = draftKey
      const id = selected ?? (await create()).id
      await api.assistantMessage(org, id, {
        request_id: crypto.randomUUID(),
        text: text.trim(),
        source_ids: draft.sources,
        answers,
      })
      updateDraft(emptyDraft, previousKey)
      await refresh(id)
    })
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return
    if (files.length + draft.sources.length > 5) {
      setError(new Error("Choose up to five files per message."))
      return
    }
    const chosen = [...files]
    if (
      chosen.some(
        (file) => file.size > (settings.data?.max_file_bytes ?? 10485760),
      )
    ) {
      setError(new Error("Each file must be 10 MiB or smaller."))
      return
    }
    setUploading(true)
    await perform(async () => {
      const id = selected ?? (await create()).id
      const sourceIds = [...draft.sources]
      for (const file of chosen)
        sourceIds.push((await api.assistantUpload(org, id, file)).id)
      updateDraft({ text: draft.text, sources: sourceIds }, id)
      await refresh(id)
    })
    setUploading(false)
    if (fileInput.current) fileInput.current.value = ""
  }
  async function decide(
    proposal: AssistantProposal,
    decision: "approve" | "reject",
  ) {
    if (!selected || (decision === "approve" && dirtyRef.current))
      throw new Error(
        "Save or discard your form edits before applying this section.",
      )
    const key = proposal.id + ":" + decision
    const requestId = decisionRequestIds.current.get(key) ?? crypto.randomUUID()
    decisionRequestIds.current.set(key, requestId)
    const result = await api.assistantDecision(org, selected, proposal.id, {
      decision,
      content_hash: proposal.content_hash,
      request_id: requestId,
    })
    if (result.result) {
      toast.success(
        `Saved ${proposal.section} to draft ${result.result.draft_revision}`,
      )
      await cache.invalidateQueries({
        queryKey: ["profiles", org],
        refetchType: dirtyRef.current ? "none" : "active",
      })
      await cache.invalidateQueries({
        queryKey: ["profile", org, result.result.profile_uuid],
        refetchType: dirtyRef.current ? "none" : "active",
      })
    }
    if (result.notice) toast.info(result.notice)
    await refresh()
  }
  const scope = `Creates and edits device profiles · Private to you · ${organizationName}`
  const pending =
    detail?.proposals.filter((proposal) => proposal.status === "pending") ?? []
  const saved =
    detail?.proposals.filter((proposal) => proposal.status === "applied") ?? []
  // Runs and proposal cards interleave by time; the open questions card stays last.
  const messages: { id: string; at: number; content: ReactNode }[] = []
  const proposalTime = (proposal: AssistantProposal) =>
    proposal.created_at ? Date.parse(proposal.created_at) : Infinity
  for (const run of detail?.runs ?? []) {
    const at = Date.parse(run.created_at)
    messages.push({
      id: run.id + "-user",
      at,
      content: (
        <Message align="end">
          <MessageContent>
            <MessageHeader>You</MessageHeader>
            <Bubble align="end">
              <BubbleContent className="whitespace-pre-wrap">
                {run.prompt}
              </BubbleContent>
            </Bubble>
            {run.source_ids?.map((id) => {
              const source = detail?.sources.find((source) => source.id === id)
              return source ? (
                <a
                  key={id}
                  href={api.assistantSourceUrl(org, selected!, id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  {source.name}
                </a>
              ) : null
            })}
          </MessageContent>
        </Message>
      ),
    })
    messages.push({
      id: run.id + "-assistant",
      at,
      content: (
        <Message>
          <MessageContent>
            <MessageHeader>Profile assistant</MessageHeader>
            {run.answer && (
              <Bubble variant="ghost">
                <BubbleContent className="whitespace-pre-wrap">
                  {run.answer}
                </BubbleContent>
              </Bubble>
            )}
            {(run.status === "queued" || run.status === "running") && (
              <Marker>
                <MarkerContent>
                  <span role="status">
                    {run.status === "queued"
                      ? "Waiting for the assistant…"
                      : "Working on your profile…"}
                  </span>
                </MarkerContent>
              </Marker>
            )}
            {run.status === "cancelled" && (
              <Marker>
                <MarkerContent>
                  Response stopped. Saved sections are kept.
                </MarkerContent>
              </Marker>
            )}
            {run.error_message && (
              <Alert>
                <AlertTitle>Response interrupted</AlertTitle>
                <AlertDescription>
                  {run.error_message} Your conversation and saved sections are
                  kept.
                </AlertDescription>
              </Alert>
            )}
          </MessageContent>
        </Message>
      ),
    })
  }
  for (const proposal of saved)
    messages.push({
      id: proposal.id,
      at: proposalTime(proposal),
      content: (
        <Marker>
          <MarkerContent>
            <span className="flex items-center gap-2">
              <CheckIcon className="size-4" />
              Saved {proposal.section} · draft {proposal.result?.draft_revision}
            </span>
          </MarkerContent>
        </Marker>
      ),
    })
  for (const proposal of pending)
    messages.push({
      id: proposal.id,
      at: proposalTime(proposal),
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Review {proposal.section}</CardTitle>
            <CardDescription>{proposal.summary}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">
              {proposal.changes.length}{" "}
              {proposal.changes.length === 1 ? "change" : "changes"} · awaiting
              your review
            </Badge>
          </CardContent>
          <CardFooter>
            <Button disabled={locked} onClick={() => setReview(proposal)}>
              Review section
            </Button>
          </CardFooter>
        </Card>
      ),
    })
  messages.sort((a, b) => a.at - b.at)
  if (!active && detail?.onboarding_state?.questions?.length)
    messages.push({
      id: "questions-" + JSON.stringify(detail.onboarding_state.questions),
      at: Infinity,
      content: (
        <Questions
          key={JSON.stringify(detail.onboarding_state.questions)}
          questions={detail.onboarding_state.questions}
          busy={locked || !available}
          onAnswer={(answers) =>
            send(
              answers
                .map(
                  (answer) =>
                    `${detail.onboarding_state!.questions!.find((q) => q.id === answer.id)?.prompt}\n${answer.answer}`,
                )
                .join("\n\n"),
              answers,
            )
          }
        />
      ),
    })
  const content = (
    <div
      className="flex h-full min-h-0 flex-col"
      role="region"
      aria-label="Profile assistant"
      title={scope}
    >
      <div className="flex flex-col gap-3 border-b p-4">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <SearchableSelect
              label="Conversation"
              value={selected ?? ""}
              selectedLabel={detail?.title}
              options={(conversations.data ?? [])
                .filter((conversation) =>
                  conversation.title
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((conversation) => ({
                  value: conversation.id,
                  label: conversation.title,
                }))}
              search={search}
              onSearchChange={setSearch}
              onChange={(id) => {
                setSelected(id)
                setReview(null)
              }}
              placeholder="Start a conversation"
              disabled={busy || uploading}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="New conversation"
            disabled={busy || uploading}
            onClick={() => {
              setSelected(null)
              setReview(null)
            }}
          >
            <PlusIcon />
          </Button>
          {selected && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete conversation"
              disabled={locked}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
        {detail && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">
              {detail.profile_name ?? "New device profile"}
            </Badge>
            {detail.profile_uuid && (
              <Link
                className="text-primary underline"
                to={`/organizations/${org}/device-profiles/${detail.profile_uuid}/review`}
              >
                Review &amp; publish
              </Link>
            )}
          </div>
        )}
      </div>
      {(error || connectionError || settings.error || conversations.error) && (
        <div className="p-3">
          <RequestError
            error={
              error || connectionError || settings.error || conversations.error
            }
          />
        </div>
      )}
      {settings.data && !available && (
        <div className="p-3">
          <Alert>
            <AlertTitle>Assistant unavailable</AlertTitle>
            <AlertDescription>
              You can still read your conversations, review saved proposals, and
              edit profiles manually.
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {loading || settings.isPending ? (
          <div className="flex flex-col gap-4 p-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <MessageScrollerProvider key={selected ?? "new"} autoScroll>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="p-4">
                  {!messages.length && (
                    <MessageScrollerItem messageId="welcome">
                      <Card>
                        <CardHeader>
                          <CardTitle>Build a profile together</CardTitle>
                          <CardDescription>
                            Describe the device or share its datasheet. I’ll ask
                            for the missing details and prepare each section for
                            your review.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">
                            Start with its purpose, model, and what it measures
                            or reports. Units and data types come next. Groups,
                            display options, and freshness settings are
                            optional.
                          </p>
                        </CardContent>
                        <CardFooter className="flex flex-col items-stretch gap-2">
                          {!selected && (
                            <>
                              <Button
                                disabled={
                                  locked ||
                                  !available ||
                                  !settings.data?.capabilities.create
                                }
                                onClick={() =>
                                  void perform(async () => {
                                    await create()
                                  })
                                }
                              >
                                Create a device profile
                              </Button>
                              {viewedProfile && (
                                <Button
                                  variant="outline"
                                  disabled={locked || !available}
                                  onClick={() =>
                                    void perform(async () => {
                                      await create(viewedProfile)
                                    })
                                  }
                                >
                                  Improve the profile I’m viewing
                                </Button>
                              )}
                            </>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Only reviewed sections are saved. Nothing is
                            published automatically.
                          </p>
                        </CardFooter>
                      </Card>
                    </MessageScrollerItem>
                  )}
                  {messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.id.endsWith("-user")}
                    >
                      {message.content}
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>
      <div
        // The phone sheet fills the screen, so toasts stack above the composer instead.
        ref={sheet ? keepToastsAbove : undefined}
        className="flex flex-col gap-3 border-t bg-background p-4"
      >
        {!!detail?.sources.length && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Sources · {draft.sources.length} selected for the next message
            </summary>
            <AttachmentGroup className="mt-2 max-h-36 overflow-auto">
              {detail.sources.map((source) => (
                <Attachment key={source.id} state="done" size="sm">
                  <AttachmentMedia variant="icon">
                    <FileTextIcon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{source.name}</AttachmentTitle>
                    <AttachmentDescription>
                      {source.pages ? `${source.pages} pages · ` : ""}
                      {Math.ceil(source.size / 1024)} KB
                    </AttachmentDescription>
                  </AttachmentContent>
                  <Button
                    size="sm"
                    variant={
                      draft.sources.includes(source.id) ? "secondary" : "ghost"
                    }
                    aria-pressed={draft.sources.includes(source.id)}
                    disabled={locked}
                    onClick={() =>
                      updateDraft({
                        sources: draft.sources.includes(source.id)
                          ? draft.sources.filter((id) => id !== source.id)
                          : [...draft.sources, source.id].slice(0, 5),
                      })
                    }
                  >
                    {draft.sources.includes(source.id) ? "Selected" : "Select"}
                  </Button>
                </Attachment>
              ))}
            </AttachmentGroup>
          </details>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          aria-label="Attach device documentation"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.json,.csv"
          onChange={(event) => void upload(event.target.files)}
          disabled={locked || !available}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <InputGroup>
            <InputGroupTextarea
              aria-label="Message the profile assistant"
              placeholder="Tell me about your device…"
              value={draft.text}
              rows={3}
              maxLength={8000}
              onChange={(event) => updateDraft({ text: event.target.value })}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <InputGroupAddon align="block-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Attach files"
                disabled={locked || !available}
                onClick={() => fileInput.current?.click()}
              >
                <PaperclipIcon />
              </Button>
              <span className="mr-auto text-xs text-muted-foreground">
                {uploading
                  ? "Uploading…"
                  : draft.sources.length
                    ? `${draft.sources.length} attached`
                    : "PDF, images, text · 10 MiB each"}
              </span>
              {active ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const run = detail?.runs.find(
                        (run) =>
                          run.status === "running" || run.status === "queued",
                      )
                      if (run && selected) {
                        await api.assistantCancel(org, selected, run.id)
                        await refresh()
                      }
                    })
                  }
                >
                  <SquareIcon data-icon="inline-start" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  aria-label="Send message"
                  disabled={locked || !available || !draft.text.trim()}
                >
                  <SendIcon />
                </Button>
              )}
            </InputGroupAddon>
          </InputGroup>
        </form>
        <p className="text-xs text-muted-foreground">
          Selected files are sent to OpenAI. Chats and files stay private until
          you delete them. Check suggested values before saving.
          {conversationCost(detail?.runs) > 0 && (
            <span className="tabular-nums">
              {" "}· Estimated cost of this conversation {formatCost(conversationCost(detail?.runs))}
            </span>
          )}
        </p>
      </div>
    </div>
  )
  return (
    <>
      {content}
      {review && selected && (
        <ProposalReview
          key={review.id}
          org={org}
          conversation={selected}
          proposal={review}
          sources={detail?.sources ?? []}
          dirty={dirty}
          busy={active}
          onClose={() => setReview(null)}
          onPreview={(next) => {
            setReview(next)
            void refresh()
          }}
          onDecision={decide}
        />
      )}
      <Confirm
        open={deleteOpen}
        title="Delete this conversation?"
        description="This permanently deletes the conversation and its uploaded files. Saved profile sections and their audit history are kept."
        action="Delete conversation"
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          if (selected) {
            await api.deleteAssistantConversation(org, selected)
            const proposalIds = new Set(
              detail?.proposals.map((proposal) => proposal.id) ?? [],
            )
            cache.removeQueries({
              predicate: (query) =>
                query.queryKey[0] === "assistant-review-draft" &&
                query.queryKey[1] === org &&
                proposalIds.has(String(query.queryKey[2])),
            })
            setDrafts((current) => {
              const next = { ...current }
              delete next[selected]
              return next
            })
            setSelected(null)
            setDetail(null)
            setReview(null)
            await cache.invalidateQueries({
              queryKey: ["assistant-conversations", org],
            })
          }
        }}
      />
    </>
  )
}
