import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  type NotificationSettings as Settings,
  type AutomationWorkflow,
  type WorkflowDeployment,
  type WorkflowDeploymentInput,
  type WorkflowDeploymentStatus,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { Field, FieldLabel } from "@iot-os/ui/components/field";
import { PageHeader } from "@iot-os/ui/components/page-header";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark";
import { Switch } from "@iot-os/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table";
import { cn } from "@iot-os/ui/lib/utils";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";
import { Confirm, RequestError } from "../components/forms";
import {
  DeviceEmpty,
  DevicePages,
  useDeviceOrganization,
} from "../devices/shared";
import { useWide } from "./shared";

/**
 * Workflow list and settings side by side when wide; below 1280px the settings route shows the settings alone.
 * Both layouts are one tree so crossing the breakpoint keeps unsaved settings mounted.
 */
export function NotificationsPage() {
  const { workflowUuid: selected } = useParams();
  const wide = useWide();
  const narrowDetail = Boolean(selected) && !wide;
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["notification-workflows", org, page],
    queryFn: () => api.notificationWorkflows(org, page),
    enabled: capabilities.manage && !narrowDetail,
  });
  const rows = narrowDetail ? [] : (query.data?.data ?? []);
  // ponytail: one settings request per listed workflow (25 per page); move email state into the workflow list API if pages grow.
  const settings = useQueries({
    queries: rows.map((workflow) => ({
      queryKey: ["workflow-notifications", org, workflow.uuid],
      queryFn: () => api.workflowNotifications(org, workflow.uuid),
    })),
  });
  const denied = !organization.isPending && !capabilities.manage;
  const listPath = `/organizations/${org}/alerts/notifications`;
  return (
    <>
      {(!narrowDetail || denied) && (
        <PageHeader
          title="Notification settings"
          back={{ to: `/organizations/${org}/alerts`, label: "Alerts" }}
        />
      )}
      {denied ? (
        <div className="p-4 md:p-6">
          <DeviceEmpty
            title="Settings unavailable"
            description="You need device management access in this organization."
          />
        </div>
      ) : (
        <div className="flex-1 xl:grid xl:grid-cols-[480px_minmax(0,1fr)]">
          {!narrowDetail && (
            <div className="min-w-0 xl:border-r">
              {(organization.error || query.error) && (
                <div className="p-4">
                  <RequestError error={organization.error ?? query.error} />
                </div>
              )}
              {query.isPending || organization.isPending ? (
                <div className="p-4">
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : rows.length ? (
                <Table aria-label="Workflows">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4 md:pl-6">Workflow</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-right">Recipients</TableHead>
                      <TableHead className="pr-4 md:pr-6">On clear</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((workflow, index) => {
                      const value = settings[index]?.data;
                      const [tone, label] = states[workflow.deployment_status] ?? [
                        "muted",
                        workflow.deployment_status,
                      ];
                      const current = workflow.uuid === selected;
                      return (
                        <TableRow
                          key={workflow.uuid}
                          data-state={current ? "selected" : undefined}
                          className={cn(
                            "relative",
                            current && "shadow-[inset_2px_0_0_var(--primary)]",
                          )}
                        >
                          <TableCell className="pl-4 md:pl-6">
                            <Link
                              to={`/organizations/${org}/alerts/notifications/${workflow.uuid}`}
                              aria-current={current ? "page" : undefined}
                              className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                            >
                              {workflow.name}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <StatusMark tone={tone}>{label}</StatusMark>
                          </TableCell>
                          <TableCell>
                            {value ? (
                              <StatusMark tone={value.enabled ? "good" : "muted"}>
                                {value.enabled ? "On" : "Off"}
                              </StatusMark>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {value?.recipient_ids.length}
                          </TableCell>
                          <TableCell className="pr-4 text-muted-foreground md:pr-6">
                            {value
                              ? value.notify_on_clear
                                ? "Email"
                                : "No email"
                              : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : !query.error ? (
                <div className="p-4">
                  <DeviceEmpty
                    title="No workflows yet"
                    description="Create a workflow through the core API before configuring notifications."
                  />
                </div>
              ) : null}
              <div className="px-4 pb-4 md:px-6">
                <DevicePages
                  meta={query.data?.meta}
                  label="Workflows"
                  onPage={setPage}
                />
              </div>
            </div>
          )}
          {selected ? (
            <WorkflowSettings
              key={`${org}:${selected}`}
              workflow={selected}
              back={narrowDetail ? listPath : undefined}
            />
          ) : wide ? (
            <p className="p-6 text-sm text-muted-foreground">
              Select a workflow to change its notifications.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

const states: Record<WorkflowDeploymentStatus, [StatusTone, string]> = {
  applied: ["good", "Active"],
  inactive: ["muted", "Inactive"],
  pending: ["info", "Pending"],
  failed: ["critical", "Failed"],
  suspended: ["warning", "Suspended"],
};

function WorkflowSettings({
  workflow,
  back,
}: {
  workflow: string;
  back?: string;
}) {
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const query = useQuery({
    queryKey: ["workflow-notifications", org, workflow],
    queryFn: () => api.workflowNotifications(org, workflow),
    enabled: capabilities.manage,
  });
  const episodes = new URLSearchParams({ workflow, per_page: "1" }).toString();
  const count = useQuery({
    queryKey: ["alerts", org, "count", episodes],
    queryFn: () => api.alerts(org, episodes),
    enabled: capabilities.view,
  });
  const name = query.data?.workflow_name ?? "Workflow";
  const total = count.data?.meta.total;
  const body = (
    <div className="flex min-w-0 flex-col gap-6">
      <RequestError error={organization.error ?? query.error} />
      {!organization.isPending && !capabilities.manage ? (
        <DeviceEmpty
          title="Settings unavailable"
          description="You need device management access in this organization."
        />
      ) : query.data ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {!back && (
              <h2 className="mr-auto min-w-0 text-base font-semibold">{name}</h2>
            )}
            {total !== undefined && (
              <Link
                className="text-sm underline underline-offset-4"
                to={`/organizations/${org}/alerts?condition=all&workflow=${encodeURIComponent(workflow)}`}
              >
                {total} {total === 1 ? "alert" : "alerts"}
              </Link>
            )}
          </div>
          <WorkflowState org={org} uuid={workflow} name={name} level={back ? 2 : 3} />
          <SettingsForm
            org={org}
            workflow={workflow}
            initial={query.data}
            level={back ? 2 : 3}
          />
        </>
      ) : query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : null}
    </div>
  );
  // The header comes and goes with the layout; the section stays so the form keeps its draft.
  return (
    <>
      {back && (
        <PageHeader
          title={name}
          back={{ to: back, label: "Notification settings" }}
        />
      )}
      <section
        aria-label="Workflow notifications"
        className="min-w-0 p-4 md:p-6 xl:max-w-3xl"
      >
        {body}
      </section>
    </>
  );
}

/** Activate and disable (A1) through the deployments endpoint, polling the operation until it settles. */
function WorkflowState({
  org,
  uuid,
  name,
  level,
}: {
  org: string;
  uuid: string;
  name: string;
  level: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const { capabilities } = useDeviceOrganization();
  const cache = useQueryClient();
  const key = ["workflow", org, uuid];
  // Others can deploy too, so the state that enables Activate and Disable is refetched on refocus.
  const workflow = useQuery({
    queryKey: key,
    queryFn: () => api.workflow(org, uuid),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  // A request without a server answer (lost response, 5xx) is kept verbatim, whatever refetches
  // happen meanwhile; the next attempt resolves that operation before sending anything new.
  const unresolved = useRef<WorkflowDeploymentInput | null>(null);
  // Our operation until it settles; after that, polling follows the workflow's pending operation.
  const [mine, setMine] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WorkflowDeployment | null>(null);
  const [confirm, setConfirm] = useState<"active" | "inactive" | null>(null);
  const data = workflow.data;
  const polled = mine ?? data?.pending_operation_uuid ?? null;
  const deployment = useQuery({
    queryKey: ["workflow-deployment", org, uuid, polled],
    queryFn: () => api.workflowDeployment(org, uuid, polled!),
    enabled: Boolean(polled),
    refetchInterval: (item) =>
      item.state.data?.deployment.status === "pending" ? 1000 : false,
  });
  useEffect(() => {
    const result = deployment.data;
    if (!result) return;
    cache.setQueryData(key, result.data);
    if (result.deployment.status === "pending") return;
    void cache.invalidateQueries({ queryKey: ["notification-workflows", org] });
    if (result.deployment.uuid === mine) {
      setOutcome(result.deployment);
      setMine(null);
    } else setOutcome(null);
  }, [deployment.data]);
  function track(result: {
    data: AutomationWorkflow;
    deployment: WorkflowDeployment;
  }) {
    cache.setQueryData(key, result.data);
    cache.setQueryData(
      ["workflow-deployment", org, uuid, result.deployment.uuid],
      result,
    );
    if (result.deployment.status === "pending") setMine(result.deployment.uuid);
    else {
      setOutcome(result.deployment);
      setMine(null);
      void cache.invalidateQueries({ queryKey: ["notification-workflows", org] });
    }
  }
  async function deploy(target: "active" | "inactive") {
    if (!data) return;
    setOutcome(null);
    let input = unresolved.current;
    if (input) {
      try {
        const earlier = await api.workflowDeployment(
          org,
          uuid,
          input.operation_uuid,
        );
        unresolved.current = null;
        track(earlier);
        if (earlier.deployment.target === target) return;
        throw new Error(
          "An earlier request reached the runtime. Review the workflow state before trying again.",
        );
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        // Never recorded: resend the identical request if it asked for the same state.
        if (input.target_state !== target) input = null;
      }
    }
    input ??= {
      operation_uuid: crypto.randomUUID(),
      target_state: target,
      draft_revision: data.draft_revision,
      expected_generation: data.deployment_generation,
    };
    unresolved.current = input;
    try {
      const result = await api.deployWorkflow(org, uuid, input);
      unresolved.current = null;
      track(result);
    } catch (error) {
      // A 4xx is a definite answer; only a lost or failed response stays unresolved.
      if (error instanceof ApiError && error.status < 500)
        unresolved.current = null;
      throw error;
    }
  }
  if (workflow.isPending) return <Skeleton className="h-16 w-full" />;
  if (!data) return <RequestError error={workflow.error} />;
  const pending =
    Boolean(data.pending_operation_uuid) ||
    deployment.data?.deployment.status === "pending";
  const canActivate = data.deployment_status !== "applied";
  const canDisable = data.applied_deployment_uuid !== null;
  const why = !capabilities.activate
    ? "Needs device activation access"
    : pending
      ? "Waiting for the runtime"
      : !canDisable
        ? "Not running"
        : !canActivate
          ? "Already active"
          : null;
  const [tone, label] = states[data.deployment_status] ?? [
    "muted",
    data.deployment_status,
  ];
  return (
    <section aria-labelledby="workflow-state" className="flex flex-col gap-3 border-t pt-4">
      <Heading id="workflow-state" className="text-sm font-semibold">
        Workflow
      </Heading>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <StatusMark tone={tone}>{label}</StatusMark>
        <span className="text-muted-foreground">
          Draft revision {data.draft_revision}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {why && <span className="text-xs text-muted-foreground">{why}</span>}
          <Button
            variant="outline"
            disabled={!capabilities.activate || pending || !canDisable}
            onClick={() => setConfirm("inactive")}
          >
            Disable workflow
          </Button>
          <Button
            variant="outline"
            disabled={!capabilities.activate || pending || !canActivate}
            onClick={() => setConfirm("active")}
          >
            Activate
          </Button>
        </div>
      </div>
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Waiting for the runtime to confirm…
        </p>
      ) : outcome?.status === "succeeded" ? (
        <p role="status" className="text-sm">
          {outcome.target === "active" ? "Workflow activated." : "Workflow disabled."}
        </p>
      ) : outcome?.status === "failed" ? (
        <RequestError
          error={new Error(outcome.diagnostic ?? "The runtime rejected the deployment.")}
        />
      ) : null}
      <RequestError error={workflow.error ?? deployment.error} />
      <Confirm
        open={confirm === "inactive"}
        title={`Disable ${name}?`}
        description="The workflow stops evaluating. Open episodes keep their last condition, and no new episodes or emails are created."
        action="Disable workflow"
        onClose={() => setConfirm(null)}
        onConfirm={() => deploy("inactive")}
        onRefresh={() => workflow.refetch()}
      />
      <Confirm
        open={confirm === "active"}
        title={`Activate ${name}?`}
        description={`Deploys draft revision ${data.draft_revision}. Evaluation starts with the next reading.`}
        action="Activate"
        destructive={false}
        onClose={() => setConfirm(null)}
        onConfirm={() => deploy("active")}
        onRefresh={() => workflow.refetch()}
      />
    </section>
  );
}

function SettingsForm({
  org,
  workflow,
  initial,
  level,
}: {
  org: string;
  workflow: string;
  initial: Settings;
  level: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const cache = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [discard, setDiscard] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useUnsavedContribution(dirty);
  const recipients = useQuery({
    queryKey: ["notification-recipients", org, workflow, search, page],
    queryFn: () => api.notificationRecipients(org, workflow, search, page),
  });
  const save = useMutation({
    mutationFn: () => api.saveWorkflowNotifications(org, workflow, draft),
    onSuccess: (value) => {
      setBaseline(value);
      setDraft(value);
      setSaved(true);
      cache.setQueryData(["workflow-notifications", org, workflow], value);
    },
  });
  const change = (value: Settings) => {
    setDraft(value);
    setSaved(false);
  };
  const needsRecipient = draft.enabled && !draft.recipient_ids.length;
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <section aria-labelledby="email-heading" className="flex flex-col gap-3 border-t pt-4">
        <Heading id="email-heading" className="text-sm font-semibold">
          Email
        </Heading>
        <Field orientation="horizontal">
          <Switch
            id="email-enabled"
            checked={draft.enabled}
            disabled={save.isPending}
            onCheckedChange={(enabled) => change({ ...draft, enabled })}
          />
          <FieldLabel htmlFor="email-enabled" className="font-normal">
            Enable email notifications
          </FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="email-recovery"
            checked={draft.notify_on_clear}
            disabled={save.isPending}
            onCheckedChange={(notify_on_clear) =>
              change({ ...draft, notify_on_clear })
            }
          />
          <FieldLabel htmlFor="email-recovery" className="font-normal">
            Email when the condition clears
          </FieldLabel>
        </Field>
        <p className="text-xs text-muted-foreground">
          Applies to future transitions. Existing episodes are not emailed
          again.
        </p>
      </section>
      <section aria-labelledby="recipients-heading" className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <Heading id="recipients-heading" className="text-sm font-semibold">
            Recipients
          </Heading>
          <span className="text-xs text-muted-foreground tabular-nums">
            {draft.recipient_ids.length} of 20
          </span>
        </div>
        <SearchableSelect
          label="Add recipient"
          value=""
          placeholder="Choose a member"
          options={(recipients.data?.data ?? [])
            .filter((item) => !draft.recipient_ids.includes(item.id))
            .map((item) => ({
              value: String(item.id),
              label: `${item.name} · ${item.email}`,
            }))}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          page={page}
          onPageChange={setPage}
          hasNextPage={page < (recipients.data?.meta.last_page ?? 1)}
          loading={recipients.isFetching}
          disabled={save.isPending || draft.recipient_ids.length >= 20}
          help={
            draft.recipient_ids.length >= 20
              ? "The limit of 20 recipients is reached."
              : "Verified members with device viewing access."
          }
          onChange={(value) => {
            const member = recipients.data?.data.find(
              (item) => item.id === Number(value),
            );
            if (member)
              change({
                ...draft,
                recipient_ids: [...draft.recipient_ids, member.id],
                recipients: [...draft.recipients, member],
              });
          }}
        />
        <RequestError error={recipients.error} />
        {draft.recipient_ids.length ? (
          <Table aria-label="Selected recipients">
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.recipient_ids.map((id) => {
                const name =
                  draft.recipients.find((item) => item.id === id)?.name ??
                  `Unavailable member (${id})`;
                return (
                  <TableRow key={id}>
                    <TableCell className="whitespace-normal break-words">
                      {name}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={save.isPending}
                        aria-label={`Remove ${name}`}
                        onClick={() =>
                          change({
                            ...draft,
                            recipient_ids: draft.recipient_ids.filter(
                              (value) => value !== id,
                            ),
                            recipients: draft.recipients.filter(
                              (item) => item.id !== id,
                            ),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No recipients selected.</p>
        )}
      </section>
      <RequestError error={save.error} />
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background px-4 py-3 md:-mx-6 md:px-6">
        <span role="status" className="mr-auto text-sm text-muted-foreground">
          {save.isPending
            ? "Saving…"
            : dirty
              ? needsRecipient
                ? "Add at least one recipient to turn email on"
                : "Unsaved changes"
              : saved
                ? "Notification settings saved."
                : "No unsaved changes"}
        </span>
        {save.error instanceof ApiError && save.error.status === 409 ? (
          <Button type="button" variant="outline" onClick={() => setDiscard(true)}>
            Reload saved settings
          </Button>
        ) : null}
        <Button disabled={save.isPending || !dirty || needsRecipient}>
          {save.isPending ? "Saving…" : "Save notification settings"}
        </Button>
      </div>
      <Confirm
        open={discard}
        title="Reload saved settings?"
        description="This replaces your unsaved preferences with the latest saved settings."
        action="Reload settings"
        destructive={false}
        onClose={() => setDiscard(false)}
        onConfirm={async () => {
          const value = await api.workflowNotifications(org, workflow);
          setBaseline(value);
          setDraft(value);
          save.reset();
          setSaved(false);
          cache.setQueryData(["workflow-notifications", org, workflow], value);
        }}
      />
    </form>
  );
}
