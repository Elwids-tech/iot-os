import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssistantAnswer,
  AssistantProposal,
  DeviceAdapter,
  OnboardingDetail,
  OnboardingProposal,
  OnboardingState,
} from "@iot-os/api-client";
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
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@iot-os/ui/components/field";
import { Textarea } from "@iot-os/ui/components/textarea";
import { Input } from "@iot-os/ui/components/input";
import { Badge } from "@iot-os/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import { JsonEditor } from "@iot-os/ui/components/json-editor";
import { Message, MessageContent } from "@iot-os/ui/components/message";
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble";
import { Marker, MarkerContent } from "@iot-os/ui/components/marker";
import { Markdown } from "@iot-os/ui/components/markdown";
import { Thinking } from "@iot-os/ui/components/thinking";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@iot-os/ui/components/empty";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@iot-os/ui/components/message-scroller";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";
import { Questions } from "../assistant/AssistantPanel";
import { ProposalReview } from "../assistant/ProposalReview";

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

/**
 * The device onboarding assistant (spec 020): one conversation from "what is this
 * device" to activated devices. On Add device it starts unbound; once a person applies
 * a reuse or create proposal it continues on that adapter. Everything it proposes is
 * applied here by the person; it never sees credentials.
 */
export function OnboardingAssistant({
  org,
  adapter,
  dirty = false,
  canEdit,
  onApplied,
  onOpenStep,
}: {
  org: string;
  adapter?: DeviceAdapter;
  dirty?: boolean;
  canEdit: boolean;
  onApplied?: (adapter: DeviceAdapter) => void;
  onOpenStep?: (step: OnboardingStep) => void;
}) {
  const cache = useQueryClient();
  const [conversation, setConversation] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // The message being sent, shown at once until its run appears in the conversation.
  const [sending, setSending] = useState<{ prompt: string; runs: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState<AssistantProposal | null>(null);
  const requests = useRef(new Map<string, string>());
  const settings = useQuery({
    queryKey: ["onboarding-ai-settings", org],
    queryFn: () => api.onboardingAssistantSettings(org),
  });
  const conversations = useQuery({
    queryKey: ["onboarding-ai-conversations", org, adapter?.uuid ?? null],
    queryFn: () => api.onboardingConversations(org, adapter?.uuid),
  });
  useEffect(() => {
    // On an adapter, continue its latest conversation; on Add device, start fresh.
    if (!conversation && adapter && conversations.data?.length)
      setConversation(conversations.data[0].id);
  }, [adapter, conversation, conversations.data]);
  const detail = useQuery({
    queryKey: ["onboarding-ai", org, conversation],
    queryFn: () => api.workflowAssistantDetail<OnboardingDetail>(org, conversation!),
    enabled: !!conversation,
    refetchInterval: 2000,
  });
  const data = detail.data;
  const state = data?.onboarding_state ?? null;
  const active =
    data?.runs.some((run) =>
      ["queued", "running", "awaiting_approval"].includes(run.status),
    ) ?? false;
  const enabled = settings.data?.enabled ?? false;
  const locked = busy || active || !canEdit || !enabled;

  async function target() {
    if (conversation) return conversation;
    const result = await api.createOnboardingConversation(org, adapter?.uuid);
    setConversation(result.id);
    await cache.invalidateQueries({ queryKey: ["onboarding-ai-conversations", org] });
    return result.id;
  }
  async function send(text = prompt, answers: AssistantAnswer[] = []) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setSending({ prompt: text.trim(), runs: data?.runs.length ?? 0 });
    const typed = text === prompt;
    if (typed) setPrompt("");
    try {
      const id = await target();
      await api.assistantMessage(org, id, {
        request_id: crypto.randomUUID(),
        text: text.trim(),
        source_ids: sources,
        answers,
      });
      setSources([]);
      await cache.invalidateQueries({ queryKey: ["onboarding-ai", org, id] });
    } catch (reason) {
      setError(reason);
      // Give the unsent message back so it can be retried or edited.
      if (typed) setPrompt((current) => current || text);
    } finally {
      setBusy(false);
      setSending(null);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const id = await target();
      const result = await api.assistantUpload(org, id, file);
      setSources((current) => [...current, result.id].slice(-5));
      await cache.invalidateQueries({ queryKey: ["onboarding-ai", org, id] });
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
    if (!conversation) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.decideOnboardingProposal(org, conversation, proposal.uuid, {
        action,
        content_hash: proposal.content_hash,
        request_id: requestId(proposal.uuid + ":" + action),
      });
      if (result.adapter) {
        cache.setQueryData(["adapter", org, result.adapter.uuid], result.adapter);
        onApplied?.(result.adapter);
      }
      await cache.invalidateQueries({ queryKey: ["onboarding-ai", org, conversation] });
      await cache.invalidateQueries({ queryKey: ["adapters", org] });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  async function decideSection(proposal: AssistantProposal, decision: "approve" | "reject") {
    if (!conversation) return;
    if (decision === "approve" && dirty)
      throw new Error("Save or discard your edits before applying this section.");
    await api.assistantDecision(org, conversation, proposal.id, {
      decision,
      content_hash: proposal.content_hash,
      request_id: requestId(proposal.id + ":" + decision),
    });
    setReview(null);
    await cache.invalidateQueries({ queryKey: ["onboarding-ai", org, conversation] });
    await cache.invalidateQueries({ queryKey: ["profiles", org] });
  }

  const pendingAdapters = data?.adapter_proposals.filter((p) => p.status === "pending") ?? [];
  const pendingSections = data?.proposals.filter((p) => p.status === "pending") ?? [];
  const boundAdapter = data?.adapter_uuid ?? adapter?.uuid ?? null;
  // A suggested step disappears once the setup checklist says it is done.
  const checklistStep = { credentials: "connect", secret: "connect", test: "deploy", deploy: "deploy", activate: "activate", cursor: null } as const;
  const stepDone = (step: OnboardingStep) =>
    adapter?.checklist?.some((item) => item.step === checklistStep[step] && item.state === "done") ?? false;
  const nextStep =
    state?.next_step && state.next_step.adapter_uuid === boundAdapter && !stepDone(state.next_step.step) ? state.next_step : null;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Onboarding assistant</CardTitle>
          <CardDescription>
            Describe the device or attach the vendor’s documentation. The
            assistant works out how to connect it and proposes each step for
            you to review. Credentials always go in the form, never in the chat.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!enabled && settings.isFetched && (
            <Alert>
              <AlertDescription>
                The assistant is not configured for this platform. The setup
                checklist and every step still work without it.
              </AlertDescription>
            </Alert>
          )}
          {dirty && (
            <Alert>
              <AlertDescription>
                Save your current draft before applying a proposal.
              </AlertDescription>
            </Alert>
          )}
          <div className="h-96">
            <MessageScrollerProvider key={conversation ?? "new"} autoScroll>
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent>
                    {!data?.runs.length && !sending && (
                      <MessageScrollerItem messageId="empty">
                        <Empty>
                          <EmptyHeader>
                            <EmptyTitle>What are you connecting?</EmptyTitle>
                            <EmptyDescription>
                              For example: “Cellular asset trackers whose data is
                              only in the vendor’s REST API”, or “Sensors that
                              speak Sparkplug B”.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      </MessageScrollerItem>
                    )}
                    {data?.runs.map((run) => (
                      <MessageScrollerItem
                        key={run.id}
                        messageId={run.id}
                        scrollAnchor
                        className="flex flex-col gap-3"
                      >
                        <Message align="end">
                          <MessageContent>
                            <Bubble align="end">
                              <BubbleContent className="whitespace-pre-wrap">
                                {run.prompt}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                        <Message>
                          <MessageContent>
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
                            ) : run.status === "awaiting_approval" ? (
                              <Marker>
                                <MarkerContent>
                                  Waiting for your review.
                                </MarkerContent>
                              </Marker>
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
                      </MessageScrollerItem>
                    ))}
                    {sending && (data?.runs.length ?? 0) === sending.runs && (
                      <MessageScrollerItem
                        messageId="sending"
                        scrollAnchor
                        className="flex flex-col gap-3"
                      >
                        <Message align="end">
                          <MessageContent>
                            <Bubble align="end">
                              <BubbleContent className="whitespace-pre-wrap">
                                {sending.prompt}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                        <Message>
                          <MessageContent>
                            <Thinking>Sending…</Thinking>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="onboarding-ai-prompt">Message</FieldLabel>
              <Textarea
                id="onboarding-ai-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (!locked && prompt.trim()) void send();
                  }
                }}
                placeholder="Our trackers report position, temperature and battery to the vendor’s cloud…"
                rows={3}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="onboarding-ai-doc" optional>
                Vendor documentation
              </FieldLabel>
              <Input
                id="onboarding-ai-doc"
                type="file"
                accept=".pdf,.txt,.md,.json,.csv,.png,.jpg,.jpeg,.webp"
                disabled={locked}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
              <FieldDescription>
                Attached files go with your next message, up to five.
              </FieldDescription>
            </Field>
          </FieldGroup>
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
          <RequestError error={error || settings.error || detail.error} />
        </CardContent>
        <CardFooter>
          <Button disabled={locked || !prompt.trim()} onClick={() => void send()}>
            {active ? "Working…" : "Send"}
          </Button>
        </CardFooter>
      </Card>
      <div className="flex flex-col gap-4">
        {!active && state?.questions?.length ? (
          <Questions
            key={JSON.stringify(state.questions)}
            questions={state.questions}
            busy={locked}
            onAnswer={async (answers) => {
              const text = answers
                .map((answer) => `${state.questions!.find((q) => q.id === answer.id)?.prompt}\n${answer.answer}`)
                .join("\n\n");
              await send(text, answers);
            }}
          />
        ) : null}
        {state?.path && <PathCard org={org} state={state} />}
        {pendingSections.map((proposal) => (
          <Card key={proposal.id}>
            <CardHeader>
              <CardTitle>Device profile: {proposal.section}</CardTitle>
              <CardDescription>{proposal.summary}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button disabled={busy || active} onClick={() => setReview(proposal)}>
                Review section
              </Button>
            </CardFooter>
          </Card>
        ))}
        {data?.profile_uuid && (
          <Alert>
            <AlertTitle>Profile draft: {data.profile_name}</AlertTitle>
            <AlertDescription>
              Applied sections are saved to the draft.{" "}
              <Link className="underline" to={`/organizations/${org}/device-profiles/${data.profile_uuid}`}>
                Review and publish it
              </Link>{" "}
              before the adapter can use it.
            </AlertDescription>
          </Alert>
        )}
        {pendingAdapters.map((proposal) => (
          <AdapterProposalCard
            key={proposal.uuid}
            org={org}
            proposal={proposal}
            adapter={adapter}
            disabled={busy || active || !canEdit || (proposal.kind === "change" && (dirty || proposal.draft_revision !== adapter?.draft_revision))}
            onDecide={(action) => void decide(proposal, action)}
          />
        ))}
        {state?.last_fetch && state.last_fetch.adapter_uuid === boundAdapter && (
          <Alert>
            <AlertTitle>The assistant ran Fetch now</AlertTitle>
            <AlertDescription>
              {state.last_fetch.error
                ? `It failed: ${state.last_fetch.error}.`
                : `HTTP ${state.last_fetch.status}, ${state.last_fetch.record_count} records${state.last_fetch.next_cursor ? `, next cursor ${state.last_fetch.next_cursor}` : ""}.`}{" "}
              The stored cursor did not move.
            </AlertDescription>
          </Alert>
        )}
        {nextStep && (
          <Card>
            <CardHeader>
              <CardTitle>Next: {STEP_LABELS[nextStep.step]}</CardTitle>
              <CardDescription>{nextStep.message}</CardDescription>
            </CardHeader>
            <CardFooter>
              {onOpenStep ? (
                <Button onClick={() => onOpenStep(nextStep.step)}>{STEP_LABELS[nextStep.step]}</Button>
              ) : (
                <Button asChild>
                  <Link to={`/organizations/${org}/device-adapters/${nextStep.adapter_uuid}`}>Open the adapter</Link>
                </Button>
              )}
            </CardFooter>
          </Card>
        )}
        {boundAdapter && !adapter && (
          <Alert>
            <AlertTitle>Adapter ready</AlertTitle>
            <AlertDescription>
              The conversation continues on the adapter.{" "}
              <Link className="underline" to={`/organizations/${org}/device-adapters/${boundAdapter}`}>
                Open its workbench
              </Link>{" "}
              to enter credentials and follow the setup checklist.
            </AlertDescription>
          </Alert>
        )}
        {!pendingAdapters.length && !pendingSections.length && !state?.path && !state?.questions?.length && (
          <Card>
            <CardHeader>
              <CardTitle>Proposals appear here</CardTitle>
              <CardDescription>
                Each change the assistant suggests — an adapter, its settings,
                a decoder or test samples — waits here for you to review and
                apply.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
      {review && conversation && (
        <ProposalReview
          key={review.id}
          org={org}
          conversation={conversation}
          proposal={review}
          sources={data?.sources ?? []}
          dirty={dirty}
          busy={active}
          onClose={() => setReview(null)}
          onPreview={(next) => setReview(next)}
          onDecision={decideSection}
        />
      )}
    </div>
  );
}

function PathCard({ org, state }: { org: string; state: OnboardingState }) {
  if (state.path === "adapter")
    return (
      <Alert>
        <AlertTitle>Connect through an adapter</AlertTitle>
        <AlertDescription>
          {state.source_type ? SOURCE_LABELS[state.source_type] : "The source is still being chosen"}.
        </AlertDescription>
      </Alert>
    );
  const direct = state.path === "direct";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{direct ? "Connect the device directly" : "Connect through a gateway"}</CardTitle>
        <CardDescription>
          {direct
            ? "The device speaks Sparkplug B, so it needs no adapter. Add it and download its connection kit."
            : "The gateway speaks Sparkplug B for the devices behind it. Add the gateway and download its connection kit."}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild>
          <Link to={`/organizations/${org}/devices/onboard?mode=${direct ? "direct" : "gateway"}`}>Open Add device</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function AdapterProposalCard({
  org,
  proposal,
  adapter,
  disabled,
  onDecide,
}: {
  org: string;
  proposal: OnboardingProposal;
  adapter?: DeviceAdapter;
  disabled: boolean;
  onDecide: (action: "apply" | "reject") => void;
}) {
  const title =
    proposal.kind === "reuse"
      ? `Use the adapter “${proposal.adapter_name ?? proposal.name}”`
      : proposal.kind === "create"
        ? `Create the adapter “${proposal.name}”`
        : "Change the adapter draft";
  const sourceType = (proposal.source?.type as string | undefined) ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{proposal.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sourceType && <Badge variant="outline">{SOURCE_LABELS[sourceType] ?? sourceType}</Badge>}
        {proposal.kind === "reuse" && proposal.adapter_uuid && (
          <p className="text-sm text-muted-foreground">
            The conversation continues on{" "}
            <Link className="underline" to={`/organizations/${org}/device-adapters/${proposal.adapter_uuid}`}>
              this adapter
            </Link>
            . Nothing changes in it.
          </p>
        )}
        {proposal.code && (
          <div className="grid gap-3 lg:grid-cols-2">
            {adapter && proposal.kind === "change" && (
              <JsonEditor label="Current decoder" language="javascript" value={adapter.code} readOnly />
            )}
            <JsonEditor label="Proposed decoder" language="javascript" value={proposal.code} readOnly />
          </div>
        )}
        {proposal.source && (
          <div className="grid gap-3 lg:grid-cols-2">
            {adapter && proposal.kind === "change" && (
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
            {evidence.origin}
            {evidence.location ? ` · ${evidence.location}` : ""}
            {evidence.note ? ` · ${evidence.note}` : ""}
          </p>
        ))}
        <p className="text-meta text-muted-foreground">
          {proposal.kind === "create"
            ? "Applying creates a draft adapter without credentials. Enter them in its Source tab."
            : proposal.kind === "change"
              ? "Applying saves a new draft revision. Tests and deployment stay with you."
              : "Applying only points this conversation at the adapter."}
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button disabled={disabled} onClick={() => onDecide("apply")}>
          {proposal.kind === "reuse" ? "Use this adapter" : proposal.kind === "create" ? "Create draft" : "Apply to draft"}
        </Button>
        <Button variant="outline" disabled={disabled} onClick={() => onDecide("reject")}>
          Reject
        </Button>
      </CardFooter>
    </Card>
  );
}
