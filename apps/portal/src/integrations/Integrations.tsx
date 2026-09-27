import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Route, Routes, useParams } from "react-router-dom";
import type {
  IntegrationAbility,
  IntegrationApplication,
  IntegrationGrants,
  IntegrationWebhook,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { Badge } from "@iot-os/ui/components/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@iot-os/ui/components/field";
import { Checkbox } from "@iot-os/ui/components/checkbox";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@iot-os/ui/components/table";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";
import { Confirm, RequestError, TextField } from "../components/forms";
import {
  DeviceEmpty,
  DevicePages,
  formatTime,
  useDeviceOrganization,
} from "../devices/shared";

const permissions: { value: IntegrationAbility; label: string }[] = [
  { value: "devices:read", label: "Device details" },
  { value: "telemetry:read", label: "Telemetry and location" },
  { value: "alerts:read", label: "Alerts" },
  { value: "events:read", label: "Alert and geofence event feed" },
  { value: "locations:read", label: "GPS locations and trails" },
  { value: "geofences:read", label: "Geofences" },
  { value: "geofences:manage", label: "Manage geofences" },
  { value: "geofences:activate", label: "Activate geofence assignments" },
];
const blank = (): IntegrationGrants => ({
  name: "",
  abilities: [],
  device_uuids: [],
});
const grants = (app: IntegrationApplication): IntegrationGrants => ({
  name: app.name,
  abilities: app.abilities,
  device_uuids: app.device_uuids,
});
const valid = (draft: IntegrationGrants) =>
  draft.name.trim() &&
  draft.device_uuids.length > 0 &&
  draft.abilities.length > 0 &&
  (!draft.abilities.includes("events:read") ||
    draft.abilities.includes("alerts:read"));

export default function IntegrationRoutes() {
  const { org, capabilities, query } = useDeviceOrganization();
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.error) return <RequestError error={query.error} />;
  if (!capabilities.view || !capabilities.manage)
    return (
      <DeviceEmpty
        title="Integrations unavailable"
        description="You need device viewing and management access in this organization."
      />
    );
  return (
    <Routes>
      <Route index element={<Directory key={org} org={org} />} />
      <Route path=":applicationUuid" element={<Detail key={org} org={org} />} />
    </Routes>
  );
}

function AbilityFields({
  value,
  onChange,
  disabled,
  allowed = permissions.map((p) => p.value),
  label = "Read permissions",
}: {
  value: IntegrationAbility[];
  onChange: (next: IntegrationAbility[]) => void;
  disabled?: boolean;
  allowed?: IntegrationAbility[];
  label?: string;
}) {
  const id = useId();
  return (
    <FieldSet disabled={disabled}>
      <FieldLegend>{label}</FieldLegend>
      <FieldGroup>
        {permissions
          .filter((item) => allowed.includes(item.value))
          .map((item) => (
            <Field orientation="horizontal" key={item.value}>
              <Checkbox
                id={id + item.value}
                checked={value.includes(item.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...value, item.value]
                      : value.filter((v) => v !== item.value),
                  )
                }
              />
              <FieldLabel htmlFor={id + item.value}>{item.label}</FieldLabel>
            </Field>
          ))}
      </FieldGroup>
    </FieldSet>
  );
}

function GrantFields({
  org,
  draft,
  change,
  disabled,
  devices = [],
}: {
  org: string;
  draft: IntegrationGrants;
  change: (next: IntegrationGrants) => void;
  disabled: boolean;
  devices?: IntegrationApplication["devices"];
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ["integration-device-options", org, search, page],
    queryFn: () => api.devices(org, { search, page }),
  });
  return (
    <FieldGroup>
      <TextField
        label="Application name"
        required
        maxLength={255}
        value={draft.name}
        disabled={disabled}
        onChange={(e) => change({ ...draft, name: e.target.value })}
      />
      <AbilityFields
        value={draft.abilities}
        disabled={disabled}
        onChange={(abilities) => change({ ...draft, abilities })}
      />
      {draft.abilities.includes("events:read") &&
        !draft.abilities.includes("alerts:read") && (
          <Alert>
            <AlertTitle>Alert permission required</AlertTitle>
            <AlertDescription>
              Select Alerts to use the alert event feed.
            </AlertDescription>
          </Alert>
        )}
      <SearchableSelect
        label="Add a device"
        value=""
        options={(query.data?.data ?? [])
          .filter((d) => !draft.device_uuids.includes(d.uuid))
          .map((d) => ({ value: d.uuid, label: `${d.name} · ${d.code}` }))}
        onChange={(id) => {
          const device = query.data?.data.find((d) => d.uuid === id);
          if (device)
            setLabels((current) => ({
              ...current,
              [id]: `${device.name} · ${device.code}`,
            }));
          change({ ...draft, device_uuids: [...draft.device_uuids, id] });
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        page={page}
        onPageChange={setPage}
        hasNextPage={Boolean(query.data && page < query.data.meta.last_page)}
        loading={query.isFetching}
        disabled={disabled || draft.device_uuids.length >= 100}
        help="Choose up to 100 devices. Access applies only to this selection."
      />
      <RequestError error={query.error} />
      <ul className="flex flex-col gap-2" aria-label="Granted devices">
        {draft.device_uuids.map((id) => (
          <li key={id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 break-words">
              {labels[id] ?? devices.find((d) => d.uuid === id)?.name ?? id}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={`Remove ${labels[id] ?? devices.find((d) => d.uuid === id)?.name ?? id}`}
              onClick={() =>
                change({
                  ...draft,
                  device_uuids: draft.device_uuids.filter(
                    (value) => value !== id,
                  ),
                })
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </FieldGroup>
  );
}

function Directory({ org }: { org: string }) {
  const query = useQuery({
    queryKey: ["integration-applications", org],
    queryFn: () => api.integrationApplications(org),
  });
  const [creating, setCreating] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useUnsavedContribution(
    creating && (busy || JSON.stringify(draft) !== JSON.stringify(blank())),
  );
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-muted-foreground">
          Give external applications access to selected devices, telemetry and
          alerts.
        </p>
      </div>
      <RequestError error={query.error} />
      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>
            Credentials are scoped to this organization. Revoked applications
            remain in the history.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {query.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : query.data?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>Devices</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((app) => (
                  <TableRow key={app.uuid}>
                    <TableCell>
                      <Link
                        className="underline underline-offset-4"
                        to={app.uuid}
                      >
                        {app.name}
                      </Link>
                    </TableCell>
                    <TableCell>{app.device_uuids.length}</TableCell>
                    <TableCell>
                      <Badge variant={app.revoked_at ? "secondary" : "success"}>
                        {app.revoked_at ? "Revoked" : "Active"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !query.error ? (
            <DeviceEmpty
              title="No applications yet"
              description="Create an application, choose its devices, then issue a token for its backend."
            />
          ) : null}
          <Button
            className="self-start"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            Refresh applications
          </Button>
          <Button
            className="self-start"
            disabled={creating || (query.data?.length ?? 0) >= 50}
            onClick={() => setCreating(true)}
          >
            Create application
          </Button>
        </CardContent>
      </Card>
      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>New application</CardTitle>
            <CardDescription>
              Start with the read permissions and devices this application
              needs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  await api.createIntegrationApplication(org, draft);
                  setCreating(false);
                  setDraft(blank());
                  await query.refetch();
                } catch (reason) {
                  setError(reason);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <GrantFields
                org={org}
                draft={draft}
                change={setDraft}
                disabled={busy}
              />
              <RequestError error={error} />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDiscard(true)}
                >
                  Cancel
                </Button>
                <Button disabled={busy || !valid(draft)}>
                  {busy ? "Creating…" : "Save application"}
                </Button>
              </div>
              {Boolean(error) && (
                <p className="text-sm text-muted-foreground">
                  If the response was lost, check the application list before
                  creating another application.
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}
      <Confirm
        open={discard}
        title="Discard new application?"
        description="Your unsaved application form will be cleared."
        action="Discard"
        onClose={() => setDiscard(false)}
        onConfirm={() => {
          setDraft(blank());
          setCreating(false);
          setError(null);
        }}
      />
    </div>
  );
}

function Detail({ org }: { org: string }) {
  const { applicationUuid = "" } = useParams();
  const query = useQuery({
    queryKey: ["integration-detail", org, applicationUuid],
    queryFn: async () => {
      const [applications, hook] = await Promise.all([
        api.integrationApplications(org),
        api.integrationWebhook(org, applicationUuid),
      ]);
      const app = applications.find((item) => item.uuid === applicationUuid);
      if (!app) throw new Error("Application not found in this organization.");
      return { app, hook };
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.error)
    return (
      <RequestError error={query.error}>
        <Button variant="outline" onClick={() => query.refetch()}>
          Retry
        </Button>
      </RequestError>
    );
  return (
    <Workspace key={org + applicationUuid} org={org} initial={query.data!} />
  );
}

function Workspace({
  org,
  initial,
}: {
  org: string;
  initial: { app: IntegrationApplication; hook: IntegrationWebhook | null };
}) {
  const cache = useQueryClient();
  const [app, setApp] = useState(initial.app);
  const [hook, setHook] = useState(initial.hook);
  const [draft, setDraft] = useState(() => grants(initial.app));
  const [url, setUrl] = useState(initial.hook?.url ?? "");
  const [days, setDays] = useState("30");
  const [tokenAbilities, setTokenAbilities] = useState(initial.app.abilities);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(
    null,
  );
  const [reveal, setReveal] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: string;
    run: () => Promise<void>;
  } | null>(null);
  const [page, setPage] = useState(1);
  const deliveries = useQuery({
    queryKey: ["integration-deliveries", org, app.uuid, page],
    queryFn: () => api.integrationDeliveries(org, app.uuid, page),
    enabled: Boolean(hook),
    refetchInterval: hook?.enabled ? 10000 : false,
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(grants(app));
  const hookDirty = url !== (hook?.url ?? "");
  useUnsavedContribution(dirty || hookDirty || Boolean(secret) || busy);
  useEffect(() => {
    const clear = () => {
      setSecret(null);
      setReveal(false);
    };
    window.addEventListener("iot-session-expired", clear);
    return () => window.removeEventListener("iot-session-expired", clear);
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(reason);
      throw reason;
    } finally {
      await cache.invalidateQueries({
        queryKey: ["integration-applications", org],
      });
      setBusy(false);
    }
  }
  function ask(
    title: string,
    description: string,
    action: string,
    run: () => Promise<void>,
  ) {
    setConfirm({ title, description, action, run });
  }
  function showSecret(label: string, value: string) {
    setReveal(false);
    setSecret({ label, value });
  }
  async function reload() {
    const [applications, webhook] = await Promise.all([
      api.integrationApplications(org),
      api.integrationWebhook(org, app.uuid),
    ]);
    const latest = applications.find((item) => item.uuid === app.uuid);
    if (!latest) throw new Error("Application is no longer available.");
    setApp(latest);
    setDraft(grants(latest));
    setTokenAbilities(latest.abilities);
    setHook(webhook);
    setUrl(webhook?.url ?? "");
    setSecret(null);
    setError(null);
    await deliveries.refetch();
  }
  const locked = busy || Boolean(secret) || Boolean(app.revoked_at);
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Link
        className="self-start underline underline-offset-4"
        to={`/organizations/${org}/integrations`}
      >
        All applications
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{app.name}</h1>
          <p className="text-muted-foreground">
            Application access and webhook delivery
          </p>
        </div>
        <Badge variant={app.revoked_at ? "secondary" : "success"}>
          {app.revoked_at ? "Revoked" : "Active"}
        </Badge>
      </div>
      <Button
        className="self-start"
        variant="outline"
        disabled={busy}
        onClick={() =>
          ask(
            "Reload application?",
            "Load the latest server state. Local edits and any displayed secret will be discarded.",
            "Reload",
            reload,
          )
        }
      >
        Reload latest state
      </Button>
      <RequestError error={error} />
      {Boolean(error) && (
        <Alert>
          <AlertTitle>
            Check the latest state before repeating an action
          </AlertTitle>
          <AlertDescription>
            A lost response may mean the change succeeded. Reload to review it.
            A lost token or signing secret must be rotated again.
          </AlertDescription>
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      {secret && (
        <Card>
          <CardHeader>
            <CardTitle>{secret.label}</CardTitle>
            <CardDescription>
              Store this in the application's backend secret store. It will not
              be shown again after you dismiss it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <TextField
              label={secret.label + " value"}
              type={reveal ? "text" : "password"}
              value={secret.value}
              readOnly
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setReveal(!reveal)}>
                {reveal ? "Hide secret" : "Reveal secret"}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret.value);
                    setNotice("Secret copied. Store it securely.");
                  } catch {
                    setNotice(
                      "Copy unavailable. Reveal and copy the secret manually.",
                    );
                  }
                }}
              >
                Copy secret
              </Button>
              <Button
                onClick={() => {
                  setSecret(null);
                  setReveal(false);
                  setNotice("");
                }}
              >
                I've stored it
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Access grants</CardTitle>
          <CardDescription>
            Saving changes invalidates the current token and disables webhook
            delivery. Issue a new token and reconfigure the webhook afterward.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              ask(
                "Replace access grants?",
                "The current token will stop working and pending webhook deliveries will be cancelled.",
                "Save grants",
                async () => {
                  const updated = await api.updateIntegrationApplication(
                    org,
                    app.uuid,
                    { ...draft, revision: app.revision },
                  );
                  setApp(updated);
                  setDraft(grants(updated));
                  setTokenAbilities(updated.abilities);
                  setHook(await api.integrationWebhook(org, app.uuid));
                  setNotice(
                    "Grants saved. Issue a new token and reconfigure the webhook as needed.",
                  );
                },
              );
            }}
          >
            <GrantFields
              org={org}
              draft={draft}
              change={setDraft}
              devices={app.devices}
              disabled={locked}
            />
            <Button
              className="self-start"
              disabled={locked || !dirty || !valid(draft)}
            >
              Save grants
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Application token</CardTitle>
          <CardDescription>
            {app.credential
              ? `Last issued token expires ${formatTime(app.credential.expires_at)}.`
              : "No token is currently issued."}{" "}
            Tokens belong in the application's backend, never browser code.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <AbilityFields
            label="Token permissions"
            value={tokenAbilities}
            allowed={app.abilities}
            disabled={locked || dirty}
            onChange={setTokenAbilities}
          />
          <TextField
            label="Token lifetime (days)"
            type="number"
            min={1}
            max={90}
            step={1}
            value={days}
            disabled={locked || dirty}
            onChange={(e) => setDays(e.target.value)}
            help="Choose 1–90 days. Issuing a token immediately invalidates the previous one."
          />
          <Button
            className="self-start"
            disabled={
              locked ||
              dirty ||
              !tokenAbilities.length ||
              (tokenAbilities.includes("events:read") &&
                !tokenAbilities.includes("alerts:read")) ||
              !Number.isInteger(Number(days)) ||
              Number(days) < 1 ||
              Number(days) > 90
            }
            onClick={() =>
              ask(
                "Issue a new token?",
                "The previous token will stop working immediately. Copy the replacement before leaving this page.",
                "Issue token",
                async () => {
                  const result = await api.issueIntegrationToken(
                    org,
                    app.uuid,
                    {
                      revision: app.revision,
                      abilities: tokenAbilities,
                      expires_in_days: Number(days),
                    },
                  );
                  setApp(result.application);
                  showSecret("Application token", result.token);
                },
              )
            }
          >
            Issue new token
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
          <CardDescription>
            Send new alert events to an approved HTTPS receiver. Requires Alerts
            and Alert event feed permissions. Your platform operator must
            allowlist the receiver hostname.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Badge
            className="self-start"
            variant={hook?.enabled ? "success" : "secondary"}
          >
            {hook?.enabled ? "Enabled" : "Disabled"}
          </Badge>
          {hook?.diagnostic && <p role="status">{hook.diagnostic}</p>}
          <TextField
            label="Receiver URL"
            type="url"
            value={url}
            disabled={locked || dirty}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://receiver.example.com/events"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                locked ||
                dirty ||
                !url.trim() ||
                !app.abilities.includes("alerts:read") ||
                !app.abilities.includes("events:read")
              }
              onClick={() =>
                ask(
                  "Configure webhook and rotate its key?",
                  "This replaces the signing secret, cancels pending deliveries and starts with new events. Existing events are not replayed. Update your receiver with the new secret.",
                  "Configure webhook",
                  async () => {
                    const { signing_secret, ...webhook } =
                      await api.configureIntegrationWebhook(org, app.uuid, {
                        revision: hook?.revision ?? 0,
                        url,
                      });
                    setHook(webhook);
                    setUrl(webhook.url);
                    showSecret("Webhook signing secret", signing_secret);
                    await deliveries.refetch();
                  },
                )
              }
            >
              Configure / rotate key
            </Button>
            <Button
              variant="outline"
              disabled={locked || dirty || !hook?.enabled}
              onClick={() =>
                ask(
                  "Disable webhook?",
                  "Pending deliveries will be cancelled. Re-enabling requires configuring the receiver and rotating its signing secret.",
                  "Disable webhook",
                  async () => {
                    setHook(
                      await api.disableIntegrationWebhook(
                        org,
                        app.uuid,
                        hook!.revision,
                      ),
                    );
                    setNotice("Webhook disabled.");
                    await deliveries.refetch();
                  },
                )
              }
            >
              Disable webhook
            </Button>
          </div>
        </CardContent>
      </Card>
      {hook && (
        <Card>
          <CardHeader>
            <CardTitle>Webhook deliveries</CardTitle>
            <CardDescription>
              Retries can repeat a delivery accepted before a network failure.
              Receivers must deduplicate events.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RequestError error={deliveries.error} />
            <Button
              className="self-start"
              variant="outline"
              disabled={deliveries.isFetching}
              onClick={() => deliveries.refetch()}
            >
              Refresh deliveries
            </Button>
            {deliveries.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : deliveries.data?.data.length ? (
              <ul className="flex flex-col gap-4">
                {deliveries.data.data.map((item) => (
                  <li key={item.uuid} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge
                        variant={
                          item.status === "failed" ? "destructive" : "secondary"
                        }
                      >
                        {item.status}
                      </Badge>
                      <span>
                        {item.attempts} attempts ·{" "}
                        {item.delivered_at
                          ? `Delivered ${formatTime(item.delivered_at)}`
                          : `Deadline ${formatTime(item.expires_at)}`}
                      </span>
                      {item.status === "failed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            locked || !hook.enabled || dirty || hookDirty
                          }
                          onClick={() =>
                            ask(
                              "Retry failed delivery?",
                              "Start up to five further attempts with the same delivery identity. The receiver may already have accepted an earlier attempt.",
                              "Retry delivery",
                              async () => {
                                await api.retryIntegrationDelivery(
                                  org,
                                  app.uuid,
                                  item.uuid,
                                  item.retry_revision,
                                );
                                await deliveries.refetch();
                                setNotice("Delivery queued for retry.");
                              },
                            )
                          }
                        >
                          Retry delivery
                        </Button>
                      )}
                    </div>
                    {item.diagnostic && (
                      <p className="text-sm text-muted-foreground">
                        {item.diagnostic}
                      </p>
                    )}
                    <details>
                      <summary>Attempt history</summary>
                      <ul>
                        {item.history.map((attempt) => (
                          <li key={attempt.attempt}>
                            Attempt {attempt.attempt} · {attempt.outcome} ·{" "}
                            {attempt.http_status
                              ? `HTTP ${attempt.http_status}`
                              : "No HTTP response"}{" "}
                            · {formatTime(attempt.created_at)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            ) : !deliveries.error ? (
              <DeviceEmpty
                title="No webhook deliveries"
                description="New alert events appear here after the webhook is configured."
              />
            ) : null}
            <DevicePages
              meta={deliveries.data?.meta}
              label="Webhook deliveries"
              onPage={setPage}
            />
          </CardContent>
        </Card>
      )}
      {!app.revoked_at && (
        <Card>
          <CardHeader>
            <CardTitle>Revoke application</CardTitle>
            <CardDescription>
              Permanently stop this application's API access and webhook
              delivery. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              disabled={locked || dirty || hookDirty}
              onClick={() =>
                ask(
                  "Permanently revoke application?",
                  "All credentials will stop working and pending webhook deliveries will be cancelled. Create a new application if access is needed again.",
                  "Revoke application",
                  async () => {
                    setApp(
                      await api.revokeIntegrationApplication(
                        org,
                        app.uuid,
                        app.revision,
                      ),
                    );
                    setHook(await api.integrationWebhook(org, app.uuid));
                    setNotice("Application revoked.");
                  },
                )
              }
            >
              Revoke application
            </Button>
          </CardContent>
        </Card>
      )}
      <Confirm
        open={Boolean(confirm)}
        title={confirm?.title ?? "Confirm change"}
        description={confirm?.description ?? ""}
        action={confirm?.action}
        onClose={() => setConfirm(null)}
        onConfirm={() => perform(confirm!.run)}
      />
    </div>
  );
}
