import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdapterCandidate,
  AssistantAnswer,
  AssistantProposal,
  DeviceAdapter,
  OnboardingDetail,
  OnboardingProposal,
  OnboardingState,
} from "@iot-os/api-client";
import { ApiError } from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@iot-os/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@iot-os/ui/components/dialog";
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
} from "@iot-os/ui/components/input-group";
import { Badge } from "@iot-os/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import { JsonEditor } from "@iot-os/ui/components/json-editor";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Message, MessageContent, MessageHeader } from "@iot-os/ui/components/message";
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble";
import { Marker, MarkerContent } from "@iot-os/ui/components/marker";
import { Markdown } from "@iot-os/ui/components/markdown";
import { Thinking } from "@iot-os/ui/components/thinking";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { keepToastsAbove } from "@iot-os/ui/components/sonner";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@iot-os/ui/components/message-scroller";
import {
  CheckIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { api } from "../lib/api";
import { useDirtyContext } from "../lib/unsaved";
import { usePanel } from "../panel/context";
import { Confirm, RequestError } from "../components/forms";
import { Questions } from "../assistant/AssistantPanel";
import { ProposalReview, evidenceLabel } from "../assistant/ProposalReview";
import { conversationCost, formatCost } from "../assistant/cost";
import { ActivateAdapterDevice } from "./ActivateDevice";

export type OnboardingStep = NonNullable<OnboardingState["next_step"]>["step"];

const SOURCE_LABELS: Record<string, string> = {
  platform: "Devices publish to our broker",
  vendor: "Vendor MQTT broker",
  webhook: "Vendor cloud sends webhooks",
  poll: "Poll a vendor API",
};
const STEP_LABELS: Record<OnboardingStep, string> = {
  credentials: "Enter credentials",
  secret: "Create a webhook secret",
  test: "Run tests",
  deploy: "Deploy",
  activate: "Activate devices",
  cursor: "Choose where polling starts",
};
// The workbench tab where each suggested step happens.
const STEP_TABS: Record<OnboardingStep, string> = {
  credentials: "source",
  secret: "source",
  test: "decoder",
  deploy: "deploy",
  activate: "devices",
  cursor: "activity",
};
// A suggested step disappears once the setup checklist says it is done.
const CHECKLIST_STEPS: Record<OnboardingStep, string | null> = {
  credentials: "connect",
  secret: "connect",
  test: "deploy",
  deploy: "deploy",
  activate: "activate",
  cursor: null,
};
const STARTERS = [
  "Our trackers report position and battery, but the data is only in the vendor’s REST API.",
  "The vendor’s cloud can send our sensor readings to a webhook.",
  "The devices speak Sparkplug B over MQTT.",
];
const time = (value?: string | null) => (value ? Date.parse(value) : Infinity);
// A reply waiting for a profile section's approval is not active: the person reviews the card or writes.
const isActive = (detail?: OnboardingDetail) =>
  detail?.runs.some((run) => ["queued", "running"].includes(run.status)) ?? false;
const isWaiting = (detail?: OnboardingDetail) =>
  detail?.runs.some((run) => ["queued", "running", "awaiting_approval"].includes(run.status)) ?? false;

/**
 * The device onboarding assistant (spec 020): one conversation from "what is this
 * device" to activated devices, in the workspace panel beside the page. On an adapter
 * it continues that adapter's conversation; elsewhere it starts unbound and follows the
 * adapter that a reuse or create proposal picks. Each proposal opens for review and is
 * applied by the person; the assistant never sees credentials.
 */
export default function OnboardingAssistantBody({
  org,
  adapterUuid,
  canEdit,
}: {
  org: string;
  /** The adapter whose workbench is open, if any. */
  adapterUuid?: string;
  canEdit: boolean;
}) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const { closePanel, handoff, takeHandoff, setAskMode } = usePanel();
  const { dirty } = useDirtyContext();
  // Below xl the workspace panel is a full-height sheet: toasts clear the composer, and
  // opening a workbench step closes the sheet so the step is visible.
  const [sheet] = useState(() => !window.matchMedia("(min-width: 1280px)").matches);
  const [selected, setSelectedState] = useState<string | null>(
    () => cache.getQueryData<string | null>(["onboarding-selected", org]) ?? null,
  );
  const setSelected = (id: string | null, park = true) => {
    // A waiting message belongs to its conversation: switching away puts it back in that composer.
    if (park && queued && id !== selected) {
      restore(queued);
      setQueued(null);
    }
    cache.setQueryData(["onboarding-selected", org], id);
    setSelectedState(id);
  };
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => cache.getQueryData<Record<string, string>>(["onboarding-drafts", org]) ?? {},
  );
  const draftKey = selected ?? "new";
  const draft = drafts[draftKey] ?? "";
  const setDraft = (text: string, key = draftKey) =>
    setDrafts((current) => {
      const next = { ...current, [key]: text };
      cache.setQueryData(["onboarding-drafts", org], next);
      return next;
    });
  const [sources, setSources] = useState<string[]>([]);
  // A message written while the assistant answers; it is sent when the answer ends.
  const [queued, setQueued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // The message being sent, shown at once until its run appears in the conversation.
  const [sending, setSending] = useState<{ prompt: string; runs: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState<AssistantProposal | null>(null);
  const [adapterReview, setAdapterReview] = useState<OnboardingProposal | null>(null);
  const [search, setSearch] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const requests = useRef(new Map<string, string>());
  const fileInput = useRef<HTMLInputElement>(null);
  // The adapter whose latest conversation was picked; picked once per page, so a choice in the list sticks.
  const followed = useRef<string | null>(null);
  // Set by "Ask the assistant" on an adapter's page: open that adapter's conversation even mid-setup.
  const forceFollow = useRef(false);
  useEffect(() => {
    for (const key of ["onboarding-selected", "onboarding-drafts"])
      cache.setQueryDefaults([key], { gcTime: Infinity });
  }, [cache]);

  const settings = useQuery({
    queryKey: ["onboarding-ai-settings", org],
    queryFn: () => api.onboardingAssistantSettings(org),
  });
  const conversations = useQuery({
    queryKey: ["onboarding-ai-conversations", org],
    queryFn: () => api.onboardingConversations(org),
  });
  const detail = useQuery({
    queryKey: ["onboarding-ai", org, selected],
    queryFn: () => api.workflowAssistantDetail<OnboardingDetail>(org, selected!),
    enabled: !!selected,
    refetchInterval: (query) => (isWaiting(query.state.data) ? 1500 : 5000),
  });
  const data = detail.data;
  const state = data?.onboarding_state ?? null;
  const boundAdapter = data?.adapter_uuid ?? null;
  const adapterQuery = useQuery({
    queryKey: ["adapter", org, boundAdapter ?? adapterUuid],
    queryFn: () => api.deviceAdapter(org, (boundAdapter ?? adapterUuid)!),
    enabled: !!(boundAdapter ?? adapterUuid),
  });
  const adapter: DeviceAdapter | undefined = adapterQuery.data;
  // Serials the running adapter decoded that no device owns yet: activated right here,
  // for the conversation's adapter or, before there is one, the adapter page open.
  const subject = boundAdapter ?? adapterUuid ?? null;
  const candidates = useQuery({
    queryKey: ["adapter-candidates", org, subject],
    queryFn: () => api.adapterCandidates(org, subject!),
    enabled: !!subject && adapter?.status === "running",
    refetchInterval: 5000,
  });
  const waiting = (candidates.data ?? []).filter((c) => !c.device && !c.preview.retained);
  const [activating, setActivating] = useState<AdapterCandidate | null>(null);

  // The adapter a conversation is bound to, from its loaded detail first: the list can lag
  // behind a proposal the person just applied.
  const bindingOf = (id: string) =>
    cache.getQueryData<OnboardingDetail>(["onboarding-ai", org, id])?.adapter_uuid ??
    conversations.data?.find((item) => item.id === id)?.adapter_uuid ??
    null;
  // "Onboard a device" starts a new conversation; "Ask the assistant" on an adapter's page
  // opens that adapter's conversation; other hand-offs only open the panel here.
  useEffect(() => {
    if (handoff?.to !== "onboarding") return;
    takeHandoff();
    if (handoff.fresh) {
      followed.current = adapterUuid ?? null;
      setSelected(null);
      setReview(null);
    } else if (adapterUuid) {
      followed.current = null;
      forceFollow.current = true;
    }
  }, [handoff, takeHandoff]);
  // On an adapter's page, continue its latest conversation, unless the open conversation is
  // this adapter's or a setup in progress that has no adapter yet: one setup keeps one
  // conversation across pages.
  useEffect(() => {
    if (!adapterUuid || !conversations.data || followed.current === adapterUuid) return;
    followed.current = adapterUuid;
    const force = forceFollow.current;
    forceFollow.current = false;
    if (selected) {
      const bound = bindingOf(selected);
      const inProgress =
        bound === null && !!cache.getQueryData<OnboardingDetail>(["onboarding-ai", org, selected])?.runs.length;
      if (bound === adapterUuid || (inProgress && !force)) return;
    }
    const latest = conversations.data.find((item) => item.adapter_uuid === adapterUuid);
    setSelected(latest?.id ?? null);
  }, [adapterUuid, conversations.data, handoff]);

  const active = isActive(data);
  const enabled = settings.data?.enabled ?? false;
  const locked = busy || uploading || active || !canEdit || !enabled;

  /**
   * Opens a page from the conversation. Ask stays on this conversation there, so a step
   * on another page never starts a new one. On a phone the sheet closes to show the step,
   * unless the page only follows a decision made in the chat.
   */
  function keepConversation(adapter?: string) {
    if (adapter) followed.current = adapter;
    setAskMode("onboarding");
  }
  function openAdapter(uuid: string, tab?: string, close = true) {
    keepConversation(uuid);
    navigate(`/organizations/${encodeURIComponent(org)}/device-adapters/${encodeURIComponent(uuid)}`, {
      state: tab ? { tab } : undefined,
    });
    if (sheet && close) closePanel();
  }
  async function refresh(id = selected) {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["onboarding-ai", org, id] }),
      cache.invalidateQueries({ queryKey: ["onboarding-ai-conversations", org] }),
    ]);
  }
  async function target() {
    if (selected) return selected;
    const result = await api.createOnboardingConversation(org, adapterUuid);
    // The conversation that was "new" is this one now, so a waiting message stays with it.
    setSelected(result.id, false);
    followed.current = adapterUuid ?? null;
    await cache.invalidateQueries({ queryKey: ["onboarding-ai-conversations", org] });
    return result.id;
  }
  // Gives an unsent message back to the composer, ahead of anything written since.
  const restore = (text: string, key = draftKey) =>
    setDrafts((current) => {
      const next = { ...current, [key]: current[key]?.trim() ? `${text}\n\n${current[key]}` : text };
      cache.setQueryData(["onboarding-drafts", org], next);
      return next;
    });
  async function send(text = draft, answers: AssistantAnswer[] = []) {
    const prompt = text.trim();
    if (!prompt || !canEdit || !enabled) return;
    const typed = text === draft;
    if (busy || uploading || active) {
      // Written while the assistant answers: it waits here and goes out when the answer ends.
      if (typed) setDraft("");
      setQueued((current) => (current ? `${current}\n\n${prompt}` : prompt));
      return;
    }
    setBusy(true);
    setError(null);
    setSending({ prompt, runs: data?.runs.length ?? 0 });
    const key = draftKey;
    if (typed) setDraft("", key);
    try {
      const id = await target();
      await api.assistantMessage(org, id, {
        request_id: crypto.randomUUID(),
        text: prompt,
        source_ids: sources,
        answers,
      });
      setSources([]);
      await refresh(id);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && !answers.length) {
        // Another reply started first (a decision starts one): wait for it, then send.
        setQueued((current) => (current ? `${prompt}\n\n${current}` : prompt));
        await refresh();
      } else {
        setError(reason);
        // Give the unsent message back so it can be retried or edited.
        if (!answers.length) restore(prompt, key);
      }
    } finally {
      setBusy(false);
      setSending(null);
    }
  }
  useEffect(() => {
    if (!queued || busy || uploading || active || (selected && (!detail.isSuccess || detail.isFetching))) return;
    setQueued(null);
    void send(queued);
  }, [queued, busy, uploading, active, selected, detail.isSuccess, detail.isFetching]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const id = await target();
      for (const file of Array.from(files)) {
        const result = await api.assistantUpload(org, id, file);
        setSources((current) => [...current, result.id].slice(-5));
      }
      await refresh(id);
    } catch (reason) {
      setError(reason);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function stop() {
    const run = data?.runs.find((item) => item.status === "queued" || item.status === "running");
    if (!run || !selected) return;
    setBusy(true);
    try {
      await api.assistantCancel(org, selected, run.id);
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  function requestId(key: string) {
    const existing = requests.current.get(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    requests.current.set(key, id);
    return id;
  }
  async function decide(proposal: OnboardingProposal, action: "apply" | "reject") {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.decideOnboardingProposal(org, selected, proposal.uuid, {
        action,
        content_hash: proposal.content_hash,
        request_id: requestId(proposal.uuid + ":" + action),
      });
      setAdapterReview(null);
      if (result.adapter) {
        const bound = result.adapter.uuid;
        // The workbench reads this query, so an applied draft shows there at once.
        cache.setQueryData(["adapter", org, bound], result.adapter);
        // The conversation is now this adapter's; it stays open when the adapter's page opens.
        if (action === "apply")
          cache.setQueryData<OnboardingDetail>(["onboarding-ai", org, selected], (current) =>
            current ? { ...current, adapter_uuid: bound } : current,
          );
        if (action === "apply" && bound !== adapterUuid)
          openAdapter(bound, proposal.kind === "create" ? "source" : undefined, false);
      }
      await refresh();
      await cache.invalidateQueries({ queryKey: ["adapters", org] });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  async function decideSection(proposal: AssistantProposal, decision: "approve" | "reject") {
    if (!selected) return;
    if (decision === "approve" && dirty)
      throw new Error("Save or discard your edits on the page before saving this section.");
    await api.assistantDecision(org, selected, proposal.id, {
      decision,
      content_hash: proposal.content_hash,
      request_id: requestId(proposal.id + ":" + decision),
    });
    setReview(null);
    await refresh();
    await cache.invalidateQueries({ queryKey: ["profiles", org] });
  }

  const stepDone = (step: OnboardingStep) =>
    adapter?.uuid === state?.next_step?.adapter_uuid &&
    (adapter?.checklist?.some((item) => item.step === CHECKLIST_STEPS[step] && item.state === "done") ?? false);
  const nextStep =
    state?.next_step && state.next_step.adapter_uuid === boundAdapter && !stepDone(state.next_step.step)
      ? state.next_step
      : null;
  const changeBlocked = (proposal: OnboardingProposal) =>
    proposal.kind === "change" && (dirty || proposal.draft_revision !== adapter?.draft_revision);

  // The conversation, with decided proposals as markers in time order and what waits on the person last.
  const items: { id: string; at: number; anchor?: boolean; content: ReactNode }[] = [];
  for (const run of data?.runs ?? []) {
    items.push({
      id: run.id + "-user",
      at: time(run.created_at),
      anchor: true,
      content: (
        <Message align="end">
          <MessageContent>
            <MessageHeader>You</MessageHeader>
            <Bubble align="end">
              <BubbleContent className="whitespace-pre-wrap">{run.prompt}</BubbleContent>
            </Bubble>
            {run.source_ids?.map((id) => {
              const source = data?.sources.find((item) => item.id === id);
              return source ? (
                <a
                  key={id}
                  href={api.assistantSourceUrl(org, selected!, id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-meta text-primary underline"
                >
                  {source.name}
                </a>
              ) : null;
            })}
          </MessageContent>
        </Message>
      ),
    });
    items.push({
      id: run.id + "-assistant",
      at: time(run.created_at),
      content: (
        <Message>
          <MessageContent>
            <MessageHeader>Onboarding assistant</MessageHeader>
            {run.answer && (
              <Bubble variant="ghost">
                <BubbleContent>
                  <Markdown>{run.answer}</Markdown>
                </BubbleContent>
              </Bubble>
            )}
            {run.status === "queued" ? (
              <Thinking>Waiting for the assistant…</Thinking>
            ) : run.status === "running" ? (
              <Thinking>Working on the next step…</Thinking>
            ) : null}
            {run.status === "cancelled" && (
              <Marker>
                <MarkerContent>Response stopped.</MarkerContent>
              </Marker>
            )}
            {run.error_message && run.status !== "cancelled" && (
              <Alert>
                <AlertDescription>{run.error_message}</AlertDescription>
              </Alert>
            )}
          </MessageContent>
        </Message>
      ),
    });
  }
  for (const proposal of data?.adapter_proposals ?? [])
    if (proposal.status !== "pending")
      items.push({
        id: proposal.uuid,
        at: time(proposal.created_at),
        content: <Decided text={decidedText(proposal)} applied={proposal.status === "applied"} />,
      });
  for (const proposal of data?.proposals ?? [])
    if (proposal.status === "applied")
      items.push({
        id: proposal.id,
        at: time(proposal.created_at),
        content: <Decided text={`Saved ${proposal.section} to the profile draft`} applied />,
      });
  if (state?.last_fetch && state.last_fetch.adapter_uuid === boundAdapter)
    items.push({
      id: "fetch-" + state.last_fetch.at,
      at: time(state.last_fetch.at),
      content: (
        <Decided
          applied={!state.last_fetch.error}
          text={
            state.last_fetch.error
              ? `Fetch now failed: ${state.last_fetch.error}`
              : `Ran Fetch now: HTTP ${state.last_fetch.status}, ${state.last_fetch.record_count} records. The stored cursor did not move.`
          }
        />
      ),
    });
  items.sort((a, b) => a.at - b.at);
  if (sending && (data?.runs.length ?? 0) === sending.runs)
    items.push({
      id: "sending",
      at: Infinity,
      anchor: true,
      content: (
        <div className="flex flex-col gap-4">
          <Message align="end">
            <MessageContent>
              <MessageHeader>You</MessageHeader>
              <Bubble align="end">
                <BubbleContent className="whitespace-pre-wrap">{sending.prompt}</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <Message>
            <MessageContent>
              <MessageHeader>Onboarding assistant</MessageHeader>
              <Thinking>Sending…</Thinking>
            </MessageContent>
          </Message>
        </div>
      ),
    });
  if (queued)
    items.push({
      id: "queued",
      at: Infinity,
      anchor: true,
      content: (
        <Message align="end">
          <MessageContent>
            <MessageHeader>You</MessageHeader>
            <Bubble align="end">
              <BubbleContent className="whitespace-pre-wrap">{queued}</BubbleContent>
            </Bubble>
            <div className="flex items-center justify-end gap-2 text-meta text-muted-foreground">
              Sends when the assistant finishes.
              <Button
                size="sm"
                variant="link"
                className="h-auto px-0"
                onClick={() => {
                  restore(queued);
                  setQueued(null);
                }}
              >
                Edit
              </Button>
            </div>
          </MessageContent>
        </Message>
      ),
    });
  if (!active && state?.questions?.length)
    items.push({
      id: "questions-" + JSON.stringify(state.questions),
      at: Infinity,
      content: (
        <Questions
          key={JSON.stringify(state.questions)}
          questions={state.questions}
          busy={locked}
          onAnswer={(answers) =>
            send(
              answers
                .map((answer) => `${state.questions!.find((q) => q.id === answer.id)?.prompt}\n${answer.answer}`)
                .join("\n\n"),
              answers,
            )
          }
        />
      ),
    });
  if (state?.path === "direct" || state?.path === "gateway")
    items.push({ id: "path", at: Infinity, content: <PathCard org={org} direct={state.path === "direct"} /> });
  for (const proposal of data?.proposals ?? [])
    if (proposal.status === "pending")
      items.push({
        id: proposal.id,
        at: Infinity,
        content: (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Device profile: {proposal.section}</CardTitle>
              <CardDescription>{proposal.summary}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button size="sm" disabled={busy || active} onClick={() => setReview(proposal)}>
                Review section
              </Button>
            </CardFooter>
          </Card>
        ),
      });
  for (const proposal of data?.adapter_proposals ?? [])
    if (proposal.status === "pending")
      items.push({
        id: proposal.uuid,
        at: Infinity,
        content: (
          <AdapterProposalCard
            org={org}
            proposal={proposal}
            disabled={busy || active || !canEdit || changeBlocked(proposal)}
            onReview={() => setAdapterReview(proposal)}
            onDecide={(action) => void decide(proposal, action)}
          />
        ),
      });
  if (waiting.length && subject)
    items.push({
      id: "activate-" + waiting.map((c) => c.uuid).join(","),
      at: Infinity,
      content: (
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              {waiting.length === 1 ? "A device is ready to activate" : `${waiting.length} devices are ready to activate`}
            </CardTitle>
            <CardDescription>Activating maps every reading from the profile and starts storing them.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {waiting.slice(0, 5).map((c) => (
              <div key={c.uuid} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-code">{c.source_device_id}</span>
                <Button size="sm" disabled={!canEdit} onClick={() => setActivating(c)}>
                  Activate
                </Button>
              </div>
            ))}
            {waiting.length > 5 && (
              <Button size="sm" variant="link" className="self-start px-0" onClick={() => openAdapter(subject, "devices")}>
                See all {waiting.length} in the adapter
              </Button>
            )}
          </CardContent>
        </Card>
      ),
    });
  // The card above already covers activation, so the step is not suggested twice.
  if (nextStep && !(nextStep.step === "activate" && waiting.length))
    items.push({
      id: "next-" + nextStep.at,
      at: Infinity,
      content: (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Next: {STEP_LABELS[nextStep.step]}</CardTitle>
            <CardDescription>{nextStep.message}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button size="sm" onClick={() => openAdapter(nextStep.adapter_uuid, STEP_TABS[nextStep.step])}>
              {STEP_LABELS[nextStep.step]}
            </Button>
          </CardFooter>
        </Card>
      ),
    });

  const conversation = conversations.data?.find((item) => item.id === selected);
  const cost = conversationCost(data?.runs);
  return (
    <>
      <div className="flex h-full min-h-0 flex-col" role="region" aria-label="Onboarding assistant">
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <SearchableSelect
                label="Conversation"
                value={selected ?? ""}
                selectedLabel={data?.title ?? conversation?.title}
                options={(conversations.data ?? [])
                  .filter((item) => item.title.toLowerCase().includes(search.toLowerCase()))
                  .map((item) => ({ value: item.id, label: item.title }))}
                search={search}
                onSearchChange={setSearch}
                onChange={(id) => {
                  setSelected(id);
                  setReview(null);
                  setSources([]);
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
                followed.current = adapterUuid ?? null;
                setSelected(null);
                setReview(null);
                setSources([]);
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
          {(boundAdapter || state?.source_type || data?.profile_uuid) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
              {boundAdapter && (
                boundAdapter === adapterUuid ? (
                  <Badge variant="secondary">{adapter?.name ?? "This adapter"}</Badge>
                ) : (
                  <Link
                    className="text-primary underline"
                    to={`/organizations/${encodeURIComponent(org)}/device-adapters/${encodeURIComponent(boundAdapter)}`}
                    onClick={() => {
                      keepConversation(boundAdapter);
                      if (sheet) closePanel();
                    }}
                  >
                    Open {adapter?.name ?? "the adapter"}
                  </Link>
                )
              )}
              {state?.path === "adapter" && state.source_type && (
                <Badge variant="outline">{SOURCE_LABELS[state.source_type]}</Badge>
              )}
              {data?.profile_uuid && (
                <Link
                  className="text-primary underline"
                  to={`/organizations/${encodeURIComponent(org)}/device-profiles/${data.profile_uuid}/review`}
                  onClick={() => {
                    keepConversation();
                    if (sheet) closePanel();
                  }}
                >
                  Publish {data.profile_name ?? "the profile draft"}
                </Link>
              )}
            </div>
          )}
        </div>
        {(error || settings.error || conversations.error || detail.error) && (
          <div className="p-3">
            <RequestError error={error || settings.error || conversations.error || detail.error} />
          </div>
        )}
        {settings.data && !enabled && (
          <div className="p-3">
            <Alert>
              <AlertTitle>Assistant unavailable</AlertTitle>
              <AlertDescription>
                The setup checklist and every step still work without it.
              </AlertDescription>
            </Alert>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {settings.isPending || (selected && detail.isPending && !sending) ? (
            <div className="flex flex-col gap-4 p-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-32" />
            </div>
          ) : (
            <MessageScrollerProvider key={selected ?? "new"} autoScroll>
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent className="p-4">
                    {!data?.runs.length && !sending && (
                      <MessageScrollerItem messageId="welcome">
                        <Welcome
                          adapter={adapterUuid ? adapter : undefined}
                          disabled={locked}
                          onPick={(text) => setDraft(text)}
                        />
                      </MessageScrollerItem>
                    )}
                    {items.map((item) => (
                      <MessageScrollerItem key={item.id} messageId={item.id} scrollAnchor={item.anchor}>
                        {item.content}
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
          {dirty && (data?.adapter_proposals.some((item) => item.status === "pending") || data?.proposals.some((item) => item.status === "pending")) && (
            <p className="text-meta text-muted-foreground">
              Save or discard your edits on the page before applying a proposal.
            </p>
          )}
          {sources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data?.sources
                .filter((source) => sources.includes(source.id))
                .map((source) => (
                  <Badge key={source.id} variant="secondary">
                    {source.name}
                  </Badge>
                ))}
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            aria-label="Attach vendor documentation"
            accept=".pdf,.txt,.md,.json,.csv,.png,.jpg,.jpeg,.webp"
            onChange={(event) => void upload(event.target.files)}
            disabled={locked}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <InputGroup>
              <InputGroupTextarea
                aria-label="Message the onboarding assistant"
                placeholder="What are you connecting?"
                value={draft}
                rows={3}
                maxLength={8000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <InputGroupAddon align="block-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Attach vendor documentation"
                  disabled={locked}
                  onClick={() => fileInput.current?.click()}
                >
                  <PaperclipIcon />
                </Button>
                <span className="mr-auto text-meta text-muted-foreground">
                  {uploading
                    ? "Uploading…"
                    : sources.length
                      ? `${sources.length} attached`
                      : "Vendor docs, samples · up to five"}
                </span>
                {active ? (
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void stop()}>
                    <SquareIcon data-icon="inline-start" />
                    Stop
                  </Button>
                ) : (
                  <Button size="icon-sm" aria-label="Send message" disabled={locked || !draft.trim()}>
                    <SendIcon />
                  </Button>
                )}
              </InputGroupAddon>
            </InputGroup>
          </form>
          <p className="text-meta text-muted-foreground">
            Credentials go in the adapter’s form, never in the chat. Files are sent to{" "}
            {settings.data?.provider?.label ?? "the AI provider"}.
            {cost > 0 && <span className="tabular-nums"> · Estimated cost {formatCost(cost)}</span>}
          </p>
        </div>
      </div>
      {review && selected && (
        <ProposalReview
          key={review.id}
          org={org}
          conversation={selected}
          proposal={review}
          sources={data?.sources ?? []}
          dirty={dirty}
          busy={active}
          onClose={() => setReview(null)}
          onPreview={(next) => {
            setReview(next);
            void refresh();
          }}
          onDecision={decideSection}
        />
      )}
      {activating && subject && (
        <ActivateAdapterDevice
          key={activating.uuid}
          org={org}
          adapter={{ uuid: subject, name: adapter?.name ?? "The adapter" }}
          candidate={activating.uuid}
          serial={activating.source_device_id}
          onClose={() => setActivating(null)}
          onActivated={(device) => {
            keepConversation();
            navigate(`/organizations/${encodeURIComponent(org)}/devices/${encodeURIComponent(device.uuid)}/overview`);
            if (sheet) closePanel();
          }}
        />
      )}
      {adapterReview && (
        <AdapterProposalReview
          org={org}
          proposal={adapterReview}
          adapter={adapter}
          busy={busy}
          disabled={busy || active || !canEdit || changeBlocked(adapterReview)}
          blocked={changeBlocked(adapterReview) ? (dirty ? "dirty" : "stale") : null}
          onClose={() => setAdapterReview(null)}
          onDecide={(action) => void decide(adapterReview, action)}
        />
      )}
      <Confirm
        open={deleteOpen}
        title="Delete this conversation?"
        description="This permanently deletes the conversation and its uploaded files. Adapters and profile drafts it created are kept."
        action="Delete conversation"
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          if (!selected) return;
          await api.deleteAssistantConversation(org, selected);
          cache.removeQueries({ queryKey: ["onboarding-ai", org, selected] });
          setSelected(null);
          setReview(null);
          await cache.invalidateQueries({ queryKey: ["onboarding-ai-conversations", org] });
        }}
      />
    </>
  );
}

function Welcome({
  adapter,
  disabled,
  onPick,
}: {
  adapter?: DeviceAdapter;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const starters = adapter
    ? ["What is left to set up?", "Draft the decoder from the captured samples."]
    : STARTERS;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{adapter ? `Continue setting up ${adapter.name}` : "What are you connecting?"}</CardTitle>
        <CardDescription>
          {adapter
            ? "I read its samples and checklist, draft the decoder and settings, and say what is left."
            : "Describe the device or attach the vendor’s documentation. I work out how it connects and propose each step for your review."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {starters.map((text) => (
          <Button
            key={text}
            variant="outline"
            className="h-auto justify-start whitespace-normal py-2 text-left"
            disabled={disabled}
            onClick={() => onPick(text)}
          >
            {text}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function Decided({ text, applied }: { text: string; applied: boolean }) {
  return (
    <Marker>
      <MarkerContent>
        <span className="flex items-center gap-2">
          {applied && <CheckIcon className="size-4" />}
          {text}
        </span>
      </MarkerContent>
    </Marker>
  );
}

function decidedText(proposal: OnboardingProposal) {
  const name = proposal.adapter_name ?? proposal.name ?? "the adapter";
  if (proposal.status === "rejected")
    return proposal.kind === "change" ? "Dismissed a change to the draft" : `Dismissed: ${name}`;
  return proposal.kind === "reuse"
    ? `Using the adapter ${name}`
    : proposal.kind === "create"
      ? `Created the draft adapter ${name}`
      : "Applied a change to the adapter draft";
}

function PathCard({ org, direct }: { org: string; direct: boolean }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{direct ? "Connect the device directly" : "Connect through a gateway"}</CardTitle>
        <CardDescription>
          {direct
            ? "The device speaks Sparkplug B, so it needs no adapter. Add it and download its connection kit."
            : "The gateway speaks Sparkplug B for the devices behind it. Add the gateway and download its connection kit."}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button size="sm" asChild>
          <Link to={`/organizations/${encodeURIComponent(org)}/devices/onboard?mode=${direct ? "direct" : "gateway"}`}>
            Open Add device
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

const proposalTitle = (proposal: OnboardingProposal) =>
  proposal.kind === "reuse"
    ? `Use the adapter “${proposal.adapter_name ?? proposal.name}”`
    : proposal.kind === "create"
      ? `Create the adapter “${proposal.name}”`
      : "Change the adapter draft";
const applyLabel = (proposal: OnboardingProposal) =>
  proposal.kind === "reuse" ? "Use this adapter" : proposal.kind === "create" ? "Create draft" : "Apply to draft";

/** A proposal in the chat: what it changes, with the code and settings one click away. */
function AdapterProposalCard({
  org,
  proposal,
  disabled,
  onReview,
  onDecide,
}: {
  org: string;
  proposal: OnboardingProposal;
  disabled: boolean;
  onReview: () => void;
  onDecide: (action: "apply" | "reject") => void;
}) {
  const sourceType = (proposal.source?.type as string | undefined) ?? null;
  const parts = [
    proposal.code && "Decoder",
    proposal.source && "Source settings",
    proposal.fixtures?.length &&
      `${proposal.fixtures.length} test ${proposal.fixtures.length === 1 ? "sample" : "samples"}`,
  ].filter(Boolean) as string[];
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{proposalTitle(proposal)}</CardTitle>
        <CardDescription>{proposal.summary}</CardDescription>
      </CardHeader>
      {(sourceType || parts.length > 0 || proposal.kind === "reuse") && (
        <CardContent className="flex flex-wrap items-center gap-2">
          {sourceType && <Badge variant="outline">{SOURCE_LABELS[sourceType] ?? sourceType}</Badge>}
          {parts.map((part) => (
            <Badge key={part} variant="secondary">
              {part}
            </Badge>
          ))}
          {proposal.kind === "reuse" && proposal.adapter_uuid && (
            <Link
              className="text-meta text-primary underline"
              to={`/organizations/${encodeURIComponent(org)}/device-adapters/${encodeURIComponent(proposal.adapter_uuid)}`}
            >
              See the adapter
            </Link>
          )}
        </CardContent>
      )}
      <CardFooter className="gap-2">
        {parts.length > 0 ? (
          <Button size="sm" onClick={onReview}>
            Review
          </Button>
        ) : (
          <Button size="sm" disabled={disabled} onClick={() => onDecide("apply")}>
            {applyLabel(proposal)}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onDecide("reject")}>
          Dismiss
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The proposal's code, settings and samples, beside the current draft for a change. */
function AdapterProposalReview({
  org,
  proposal,
  adapter,
  busy,
  disabled,
  blocked,
  onClose,
  onDecide,
}: {
  org: string;
  proposal: OnboardingProposal;
  adapter?: DeviceAdapter;
  busy: boolean;
  disabled: boolean;
  blocked: "dirty" | "stale" | null;
  onClose: () => void;
  onDecide: (action: "apply" | "reject") => void;
}) {
  const change = proposal.kind === "change" && adapter;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[92svh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{proposalTitle(proposal)}</DialogTitle>
          <DialogDescription>{proposal.summary}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {proposal.code && (
            <div className="grid gap-3 lg:grid-cols-2">
              {change && <JsonEditor label="Current decoder" language="javascript" value={adapter.code} readOnly />}
              <JsonEditor label="Proposed decoder" language="javascript" value={proposal.code} readOnly />
            </div>
          )}
          {proposal.source && (
            <div className="grid gap-3 lg:grid-cols-2">
              {change && (
                <JsonEditor label="Current source settings" value={JSON.stringify(adapter.source, null, 2)} readOnly />
              )}
              <JsonEditor label="Proposed source settings" value={JSON.stringify(proposal.source, null, 2)} readOnly />
            </div>
          )}
          {proposal.fixtures?.length ? (
            <JsonEditor
              label={`${proposal.fixtures.length} test ${proposal.fixtures.length === 1 ? "sample" : "samples"} to add`}
              value={JSON.stringify(proposal.fixtures, null, 2)}
              readOnly
            />
          ) : null}
          {proposal.evidence.map((evidence, index) => (
            <p key={index} className="text-meta text-muted-foreground">
              {evidenceLabel(evidence.origin)}
              {evidence.location ? ` · ${evidence.location}` : ""}
              {evidence.note ? ` · ${evidence.note}` : ""}
            </p>
          ))}
          {blocked && (
            <Alert>
              <AlertDescription>
                {blocked === "dirty"
                  ? "Save or discard your edits on the adapter before applying this change."
                  : "The draft changed since this was proposed. Ask the assistant to update the proposal."}
              </AlertDescription>
            </Alert>
          )}
          <p className="text-meta text-muted-foreground">
            {proposal.kind === "create" ? (
              "Applying creates a draft adapter without credentials. Enter them in its Connection tab."
            ) : proposal.kind === "change" ? (
              "Applying saves a new draft revision. Tests and deployment stay with you."
            ) : (
              <>
                Applying points this conversation at{" "}
                <Link className="underline" to={`/organizations/${encodeURIComponent(org)}/device-adapters/${proposal.adapter_uuid}`}>
                  the adapter
                </Link>
                . Nothing changes in it.
              </>
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Keep reviewing later
          </Button>
          <Button variant="outline" disabled={disabled} onClick={() => onDecide("reject")}>
            Dismiss proposal
          </Button>
          <Button disabled={disabled} onClick={() => onDecide("apply")}>
            {applyLabel(proposal)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
