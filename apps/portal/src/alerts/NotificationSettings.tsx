import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  type NotificationSettings as Settings,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@iot-os/ui/components/field";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Switch } from "@iot-os/ui/components/switch";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";
import { Confirm, RequestError } from "../components/forms";
import {
  DeviceEmpty,
  DevicePages,
  useDeviceOrganization,
} from "../devices/shared";

export function NotificationDirectory() {
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["notification-workflows", org, page],
    queryFn: () => api.notificationWorkflows(org, page),
    enabled: capabilities.manage,
  });
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Link
        className="underline underline-offset-4"
        to={`/organizations/${org}/alerts`}
      >
        Back to alerts
      </Link>
      <h1 className="text-2xl font-semibold">Notification settings</h1>
      <RequestError error={organization.error ?? query.error} />
      {!organization.isPending && !capabilities.manage ? (
        <DeviceEmpty
          title="Settings unavailable"
          description="You need device management access in this organization."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Workflow notifications</CardTitle>
            <CardDescription>
              Choose who receives email for each workflow. Email is off by
              default.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {query.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : query.data?.data.length ? (
              <ul className="flex flex-col gap-4">
                {query.data.data.map((workflow) => (
                  <li key={workflow.uuid}>
                    <Link
                      className="underline underline-offset-4"
                      to={workflow.uuid}
                    >
                      {workflow.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : !query.error ? (
              <DeviceEmpty
                title="No workflows"
                description="Create a workflow through the core API before configuring notifications."
              />
            ) : null}
            <DevicePages
              meta={query.data?.meta}
              label="Workflows"
              onPage={setPage}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function NotificationSettingsRoute() {
  const { organizationUuid = "", workflowUuid = "" } = useParams();
  return (
    <NotificationSettings
      key={`${organizationUuid}:${workflowUuid}`}
      workflow={workflowUuid}
    />
  );
}
function NotificationSettings({ workflow }: { workflow: string }) {
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const query = useQuery({
    queryKey: ["workflow-notifications", org, workflow],
    queryFn: () => api.workflowNotifications(org, workflow),
    enabled: capabilities.manage,
  });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        className="underline underline-offset-4"
        to={`/organizations/${org}/alerts/notifications`}
      >
        Back to notification settings
      </Link>
      <h1 className="text-2xl font-semibold">Workflow email notifications</h1>
      <RequestError error={organization.error ?? query.error} />
      {!organization.isPending && !capabilities.manage ? (
        <DeviceEmpty
          title="Settings unavailable"
          description="You need device management access in this organization."
        />
      ) : query.data ? (
        <SettingsForm org={org} workflow={workflow} initial={query.data} />
      ) : query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : null}
    </div>
  );
}
function SettingsForm({
  org,
  workflow,
  initial,
}: {
  org: string;
  workflow: string;
  initial: Settings;
}) {
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial.workflow_name}</CardTitle>
        <CardDescription>
          Applies to future transitions. Existing episodes are not sent again.
          Pending emails recheck these preferences before sending.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <FieldGroup>
            <Field orientation="horizontal">
              <Switch
                id="email-enabled"
                checked={draft.enabled}
                disabled={save.isPending}
                onCheckedChange={(enabled) => change({ ...draft, enabled })}
              />
              <FieldLabel htmlFor="email-enabled">
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
              <FieldLabel htmlFor="email-recovery">
                Email when the condition clears
              </FieldLabel>
            </Field>
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
              help="Choose up to 20 verified members with device viewing access."
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
            <Field>
              <FieldLabel>
                Selected recipients ({draft.recipient_ids.length}/20)
              </FieldLabel>
              {draft.recipient_ids.length ? (
                <ul className="flex flex-col gap-3">
                  {draft.recipient_ids.map((id) => {
                    const name =
                      draft.recipients.find((item) => item.id === id)?.name ??
                      `Unavailable member (${id})`;
                    return (
                      <li
                        className="flex items-center justify-between gap-3"
                        key={id}
                      >
                        <span className="min-w-0 break-words">{name}</span>
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
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <FieldDescription>No recipients selected.</FieldDescription>
              )}
            </Field>
            <RequestError error={save.error} />
          </FieldGroup>
          {saved && !dirty ? (
            <p role="status" className="text-sm">
              Notification settings saved.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                save.isPending ||
                !dirty ||
                (draft.enabled && !draft.recipient_ids.length)
              }
            >
              {save.isPending ? "Saving…" : "Save notification settings"}
            </Button>
            {save.error instanceof ApiError && save.error.status === 409 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDiscard(true)}
              >
                Reload saved settings
              </Button>
            ) : null}
          </div>
        </form>
        <Confirm
          open={discard}
          title="Reload saved settings?"
          description="This replaces your unsaved preferences with the latest saved settings."
          action="Reload settings"
          onClose={() => setDiscard(false)}
          onConfirm={async () => {
            const value = await api.workflowNotifications(org, workflow);
            setBaseline(value);
            setDraft(value);
            save.reset();
            setSaved(false);
            cache.setQueryData(
              ["workflow-notifications", org, workflow],
              value,
            );
          }}
        />
      </CardContent>
    </Card>
  );
}
