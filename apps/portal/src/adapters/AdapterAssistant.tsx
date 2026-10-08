import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterProposal, DeviceAdapter } from "@iot-os/api-client";
import type { AssistantDetail } from "@iot-os/api-client";
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
import { Alert, AlertDescription } from "@iot-os/ui/components/alert";
import { JsonEditor } from "@iot-os/ui/components/json-editor";
import {
  Message,
  MessageContent,
  MessageGroup,
} from "@iot-os/ui/components/message";
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble";
import {
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerButton,
} from "@iot-os/ui/components/message-scroller";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";

export function AdapterAssistant({
  org,
  adapter,
  dirty,
  canEdit,
  onApplied,
}: {
  org: string;
  adapter: DeviceAdapter;
  dirty: boolean;
  canEdit: boolean;
  onApplied: (adapter: DeviceAdapter) => void;
}) {
  const cache = useQueryClient();
  const [conversation, setConversation] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const settings = useQuery({
    queryKey: ["adapter-ai-settings", org],
    queryFn: () => api.adapterAssistantSettings(org),
  });
  const conversations = useQuery({
    queryKey: ["adapter-ai-conversations", org, adapter.uuid],
    queryFn: () => api.adapterAssistantConversations(org, adapter.uuid),
  });
  useEffect(() => {
    if (!conversation && conversations.data?.length)
      setConversation(conversations.data[0].id);
  }, [conversation, conversations.data]);
  const detail = useQuery({
    queryKey: ["adapter-ai", org, conversation],
    queryFn: () =>
      api.workflowAssistantDetail<AssistantDetail>(org, conversation!),
    enabled: !!conversation,
    refetchInterval: 2000,
  });
  const proposals = useQuery({
    queryKey: ["adapter-proposals", org, adapter.uuid],
    queryFn: () => api.adapterProposals(org, adapter.uuid),
    refetchInterval: 2000,
  });
  const active =
    detail.data?.runs.some((run) =>
      ["queued", "running", "awaiting_approval"].includes(run.status),
    ) ?? false;
  async function target() {
    if (conversation) return conversation;
    const existing = conversations.data?.[0]?.id;
    if (existing) {
      setConversation(existing);
      return existing;
    }
    const result = await api.createAdapterConversation(org, adapter.uuid);
    setConversation(result.id);
    return result.id;
  }
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const id = await target();
      await api.assistantMessage(org, id, {
        request_id: crypto.randomUUID(),
        text: prompt,
        source_ids: sources,
      });
      setPrompt("");
      await cache.invalidateQueries({ queryKey: ["adapter-ai", org, id] });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const id = await target();
      const result = await api.assistantUpload(org, id, file);
      setSources((current) => [...current, result.id].slice(-5));
      await cache.invalidateQueries({ queryKey: ["adapter-ai", org, id] });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  async function decide(proposal: AdapterProposal, action: "apply" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const result = await api.decideAdapterProposal(
        org,
        adapter.uuid,
        proposal.uuid,
        action,
        proposal.content_hash,
      );
      if ("uuid" in result) onApplied(result);
      await cache.invalidateQueries({
        queryKey: ["adapter-proposals", org, adapter.uuid],
      });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Describe the device</CardTitle>
          <CardDescription>
            Use manufacturer documentation and samples to propose a decoder.
            Review and test every edit before deployment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!settings.data?.enabled && (
            <Alert>
              <AlertDescription>
                The AI assistant is currently unavailable. You can continue
                editing and testing JavaScript manually.
              </AlertDescription>
            </Alert>
          )}
          {dirty && (
            <Alert>
              <AlertDescription>
                Save your current draft before requesting an AI change or
                applying a proposal.
              </AlertDescription>
            </Alert>
          )}
          <div className="h-80">
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent>
                  <MessageGroup>
                    {detail.data?.runs.map((run) => (
                      <div key={run.id} className="flex flex-col gap-3">
                        <Message align="end">
                          <MessageContent>
                            <Bubble>
                              <BubbleContent className="whitespace-pre-wrap">
                                {run.prompt}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                        <Message>
                          <MessageContent>
                            <Bubble variant="ghost">
                              <BubbleContent className="whitespace-pre-wrap">
                                {run.answer ||
                                  run.error_message ||
                                  (run.status === "queued"
                                    ? "Waiting for the assistant…"
                                    : "Preparing a decoder proposal…")}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </div>
                    ))}
                  </MessageGroup>
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="adapter-ai-doc">
                Manufacturer documentation
              </FieldLabel>
              <Input
                id="adapter-ai-doc"
                type="file"
                accept=".pdf,.txt,.md,.json,.csv,.png,.jpg,.jpeg,.webp"
                disabled={busy || !canEdit || dirty || !settings.data?.enabled}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
              <FieldDescription>
                Up to five selected sources are included in the next message.
                Keep broker passwords in connection settings.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="adapter-ai-prompt">
                Request a decoder or an edit
              </FieldLabel>
              <Textarea
                id="adapter-ai-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="The meter sends flow in mL/min and total volume in mL. Decode these fields into the selected profile…"
                rows={4}
              />
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            {detail.data?.sources
              .filter((source) => sources.includes(source.id))
              .map((source) => (
                <Badge key={source.id} variant="secondary">
                  {source.name}
                </Badge>
              ))}
          </div>
          <RequestError error={error || settings.error || detail.error} />
        </CardContent>
        <CardFooter>
          <Button
            disabled={
              busy ||
              active ||
              !canEdit ||
              dirty ||
              !settings.data?.enabled ||
              !prompt.trim()
            }
            onClick={() => void send()}
          >
            {busy || active ? "Preparing proposal…" : "Ask AI"}
          </Button>
        </CardFooter>
      </Card>
      <div className="flex flex-col gap-4">
        {proposals.data
          ?.filter((proposal) => proposal.status === "pending")
          .map((proposal) => (
            <Card key={proposal.uuid}>
              <CardHeader>
                <CardTitle>Review decoder proposal</CardTitle>
                <CardDescription>{proposal.summary}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Badge variant="outline">
                  Based on draft {proposal.draft_revision}
                </Badge>
                <div className="grid gap-3 lg:grid-cols-2">
                  <JsonEditor
                    label="Current JavaScript"
                    language="javascript"
                    value={adapter.code}
                    readOnly
                  />
                  <JsonEditor
                    label="Proposed JavaScript"
                    language="javascript"
                    value={proposal.code}
                    readOnly
                  />
                </div>
                {proposal.evidence.map((evidence, index) => (
                  <p key={index} className="text-sm text-muted-foreground">
                    {evidence.origin}
                    {evidence.source_id
                      ? ` · Source ${evidence.source_id}`
                      : ""}
                    {evidence.location ? ` · ${evidence.location}` : ""}
                    {evidence.note ? ` · ${evidence.note}` : ""}
                  </p>
                ))}
                <p className="text-sm text-muted-foreground">
                  Applying creates a new draft and clears its deployment tests.
                  It does not change the running adapter.
                </p>
              </CardContent>
              <CardFooter className="gap-2">
                <Button
                  disabled={
                    busy ||
                    dirty ||
                    !canEdit ||
                    proposal.draft_revision !== adapter.draft_revision
                  }
                  onClick={() => void decide(proposal, "apply")}
                >
                  Apply to draft
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !canEdit}
                  onClick={() => void decide(proposal, "reject")}
                >
                  Reject
                </Button>
              </CardFooter>
            </Card>
          ))}
        {!proposals.data?.some((proposal) => proposal.status === "pending") && (
          <Card>
            <CardHeader>
              <CardTitle>Proposals appear here</CardTitle>
              <CardDescription>
                Compare the current decoder with the suggested code and its
                evidence before applying an edit.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
