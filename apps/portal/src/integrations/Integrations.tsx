import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Route, Routes, useParams } from "react-router-dom";
import type {
  IntegrationAbility,
  IntegrationApplication,
  IntegrationGrants,
  IntegrationWebhook,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
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
import { PageHeader } from "@iot-os/ui/components/page-header";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@iot-os/ui/components/sheet";
import { StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@iot-os/ui/components/table";
import { formatDateTime } from "@iot-os/ui/lib/format";
import { cn } from "@iot-os/ui/lib/utils";
import { CopyIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";
import { Confirm, RequestError, TextField } from "../components/forms";
import {
  DeviceEmpty,
  DevicePages,
  useDeviceOrganization,
} from "../devices/shared";
import { Age, useWide } from "../alerts/shared";

const permissions: { value: IntegrationAbility; label: string }[] = [
  { value: "devices:read", label: "Device details" },
  { value: "telemetry:read", label: "Telemetry and location" },
  { value: "alerts:read", label: "Alerts" },
  { value: "events:read", label: "Alert event feed" },
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
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

export default function IntegrationRoutes() {
  const { org, capabilities, query } = useDeviceOrganization();
  const blocked = query.isPending ? (
    <Skeleton className="h-64 w-full" />
  ) : query.error ? (
    <RequestError error={query.error} />
  ) : !capabilities.view || !capabilities.manage ? (
    <DeviceEmpty
      title="Integrations unavailable"
      description="You need device viewing and management access in this organization."
    />
  ) : null;
  if (blocked)
    return (
      <>
        <PageHeader title="Integrations" />
        <div className="p-4 md:p-6">{blocked}</div>
      </>
    );
  return (
    <Routes>
      <Route index element={<Directory key={org} org={org} />} />
      <Route
        path=":applicationUuid"
        element={<Directory key={org} org={org} />}
      />
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
      <FieldLegend variant="label">{label}</FieldLegend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {permissions
          .filter((item) => allowed.includes(item.value))
          .map((item) => (
            <Field orientation="horizontal" className="w-auto" key={item.value}>
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
              <FieldLabel htmlFor={id + item.value} className="font-normal">
                {item.label}
              </FieldLabel>
            </Field>
          ))}
      </div>
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
  const label = (id: string) =>
    labels[id] ??
    (() => {
      const device = devices.find((d) => d.uuid === id);
      return device ? `${device.name} · ${device.code}` : id;
    })();
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
        help={
          draft.device_uuids.length >= 100
            ? "The limit of 100 devices is reached."
            : `${draft.device_uuids.length} of 100 devices. Access applies only to this selection.`
        }
      />
      <RequestError error={query.error} />
      {draft.device_uuids.length > 0 && (
        <ul className="flex flex-col divide-y border-y" aria-label="Granted devices">
          {draft.device_uuids.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 text-sm break-words">{label(id)}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-label={`Remove ${label(id)}`}
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
      )}
    </FieldGroup>
  );
}

/**
 * Applications and the selected application side by side when wide; below 1280px the detail route
 * shows the detail alone. Both layouts are one tree so crossing the breakpoint keeps a displayed
 * one-time secret and unsaved edits mounted.
 */
function Directory({ org }: { org: string }) {
  const { applicationUuid: selected } = useParams();
  const wide = useWide();
  const narrowDetail = Boolean(selected) && !wide;
  const query = useQuery({
    queryKey: ["integration-applications", org],
    queryFn: () => api.integrationApplications(org),
  });
  const [creating, setCreating] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const edited = JSON.stringify(draft) !== JSON.stringify(blank());
  useUnsavedContribution(creating && (busy || edited));
  const count = query.data?.length ?? 0;
  const full = count >= 50;
  const close = () => {
    setDraft(blank());
    setCreating(false);
    setError(null);
  };
  const requestClose = () => {
    if (busy) return;
    if (edited) setDiscard(true);
    else close();
  };
  return (
    <>
      {!narrowDetail && (
        <PageHeader
          title="Integrations"
          actions={
            <>
              {query.data && (
                <span className="text-sm text-muted-foreground max-sm:hidden">
                  {full ? "Limit of 50 applications reached" : `${count} of 50 applications`}
                </span>
              )}
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh applications"
                title="Refresh applications"
                disabled={query.isFetching}
                onClick={() => query.refetch()}
              >
                <RefreshCwIcon />
              </Button>
              <Button
                disabled={creating || full}
                title={full ? "Limit of 50 applications reached" : undefined}
                onClick={() => setCreating(true)}
              >
                <PlusIcon data-icon="inline-start" />
                Create application
              </Button>
            </>
          }
        />
      )}
      <div className="flex-1 xl:grid xl:grid-cols-[400px_minmax(0,1fr)]">
        {!narrowDetail && (
          <div className="min-w-0 xl:border-r">
            {query.error && (
              <div className="p-4">
                <RequestError error={query.error} />
              </div>
            )}
            {query.isPending ? (
              <div className="p-4">
                <Skeleton className="h-32 w-full" />
              </div>
            ) : query.data?.length ? (
              <ul aria-label="Applications" className="border-b">
                {query.data.map((app) => {
                  const current = app.uuid === selected;
                  return (
                    <li
                      key={app.uuid}
                      className={cn(
                        "relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b px-4 py-3 last:border-b-0 hover:bg-muted/50 md:px-6",
                        current && "bg-muted shadow-[inset_2px_0_0_var(--primary)]",
                      )}
                    >
                      <Link
                        to={`/organizations/${org}/integrations/${app.uuid}`}
                        aria-current={current ? "page" : undefined}
                        className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                      >
                        {app.name}
                      </Link>
                      <span className="text-xs">
                        {app.revoked_at ? (
                          <StatusMark tone="muted">Revoked</StatusMark>
                        ) : (
                          <StatusMark tone="good">Active</StatusMark>
                        )}
                      </span>
                      <span className="col-span-2 truncate text-xs text-muted-foreground">
                        {plural(app.device_uuids.length, "device")} ·{" "}
                        {plural(app.abilities.length, "permission")} ·{" "}
                        {app.revoked_at ? (
                          <>
                            revoked <Age value={app.revoked_at} />
                          </>
                        ) : app.credential ? (
                          <>
                            token expires{" "}
                            <time
                              dateTime={app.credential.expires_at}
                              title={formatDateTime(app.credential.expires_at)}
                            >
                              {new Date(app.credential.expires_at).toLocaleDateString()}
                            </time>
                          </>
                        ) : (
                          "no token issued"
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : !query.error ? (
              <div className="p-4">
                <DeviceEmpty
                  title="No applications yet"
                  description="Create an application, choose its devices, then issue a token for its backend."
                />
              </div>
            ) : null}
          </div>
        )}
        {selected ? (
          <Detail
            key={selected}
            org={org}
            id={selected}
            back={narrowDetail ? `/organizations/${org}/integrations` : undefined}
          />
        ) : wide ? (
          <p className="p-6 text-sm text-muted-foreground">
            Select an application to manage its access.
          </p>
        ) : null}
      </div>
      <Sheet
        open={creating}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>New application</SheetTitle>
            <SheetDescription>
              Choose the read permissions and devices it needs.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api.createIntegrationApplication(org, draft);
                close();
                await query.refetch();
              } catch (reason) {
                setError(reason);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
              <GrantFields
                org={org}
                draft={draft}
                change={setDraft}
                disabled={busy}
              />
              <RequestError error={error} />
              {Boolean(error) && (
                <p className="text-sm text-muted-foreground">
                  If the response was lost, check the application list before
                  creating another application.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4">
              {!valid(draft) && (
                <span className="mr-auto text-xs text-muted-foreground">
                  Add a name, a permission and a device
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={requestClose}
              >
                Cancel
              </Button>
              <Button disabled={busy || !valid(draft)}>
                {busy ? "Creating…" : "Save application"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <Confirm
        open={discard}
        title="Discard new application?"
        description="Your unsaved application form will be cleared."
        action="Discard"
        onClose={() => setDiscard(false)}
        onConfirm={close}
      />
    </>
  );
}

function Detail({ org, id, back }: { org: string; id: string; back?: string }) {
  const query = useQuery({
    queryKey: ["integration-detail", org, id],
    queryFn: async () => {
      const [applications, hook] = await Promise.all([
        api.integrationApplications(org),
        api.integrationWebhook(org, id),
      ]);
      const app = applications.find((item) => item.uuid === id);
      if (!app) throw new Error("Application not found in this organization.");
      return { app, hook };
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const state = query.isPending ? (
    <Skeleton className="h-64 w-full" />
  ) : query.error ? (
    <RequestError error={query.error}>
      <Button variant="outline" onClick={() => query.refetch()}>
        Retry
      </Button>
    </RequestError>
  ) : null;
  if (state)
    return back ? (
      <>
        <PageHeader title="Application" back={{ to: back, label: "Integrations" }} />
        <div className="p-4 md:p-6">{state}</div>
      </>
    ) : (
      <div className="p-4 md:p-6">{state}</div>
    );
  return (
    <Workspace key={org + id} org={org} initial={query.data!} back={back} />
  );
}

/** One-time secret next to the action that created it; takes focus once the confirm dialog has closed (I1). */
function SecretPanel({
  label,
  value,
  level,
  onDismiss,
  onNotice,
}: {
  label: string;
  value: string;
  level: 2 | 3;
  onDismiss: () => void;
  onNotice: (notice: string) => void;
}) {
  const Heading = level === 2 ? "h3" : "h4";
  const ref = useRef<HTMLDivElement>(null);
  const heading = useId();
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    // The confirm dialog's focus trap would pull focus back while it is still open.
    let frame = 0;
    const focus = () => {
      if (document.querySelector("[role=alertdialog]"))
        frame = requestAnimationFrame(focus);
      else ref.current?.focus();
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-labelledby={heading}
      className="flex flex-col gap-3 rounded-(--radius) border bg-muted/30 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading id={heading} className="text-sm font-semibold">
          New {label.toLowerCase()}
        </Heading>
        <span className="text-xs text-muted-foreground">
          Shown once. Store it in the application's backend.
        </span>
      </div>
      <TextField
        label={label + " value"}
        type={reveal ? "text" : "password"}
        value={value}
        readOnly
        autoComplete="off"
        className="font-mono"
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setReveal(!reveal)}>
          {reveal ? "Hide secret" : "Reveal secret"}
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              onNotice("Secret copied. Store it securely.");
            } catch {
              onNotice("Copy unavailable. Reveal and copy the secret manually.");
            }
          }}
        >
          Copy secret
        </Button>
        <Button onClick={onDismiss}>I've stored it</Button>
      </div>
    </div>
  );
}

/** Detail sections use h2 under a page h1 (narrow) and h3 under the pane's h2 (wide). */
function Section({
  title,
  level,
  aside,
  children,
}: {
  title: string;
  level: 2 | 3;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id={id} className="text-sm font-semibold">
          {title}
        </Heading>
        <div className="text-sm">{aside}</div>
      </div>
      {children}
    </section>
  );
}

const deliveryTones: Record<string, StatusTone> = {
  delivered: "good",
  failed: "critical",
  pending: "info",
  cancelled: "muted",
};

function Workspace({
  org,
  initial,
  back,
}: {
  org: string;
  initial: { app: IntegrationApplication; hook: IntegrationWebhook | null };
  back?: string;
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
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: string;
    destructive: boolean;
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
    const clear = () => setSecret(null);
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
    destructive = true,
  ) {
    setConfirm({ title, description, action, destructive, run });
  }
  function showSecret(label: string, value: string) {
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
  const level = back ? 2 : 3;
  const Heading = back ? "h2" : "h3";
  const locked = busy || Boolean(secret) || Boolean(app.revoked_at);
  const lockReason = app.revoked_at
    ? "Application revoked"
    : secret
      ? "Store the secret first"
      : null;
  const grantsWhy =
    lockReason ??
    (!dirty ? "No changes" : !valid(draft) ? "Add a name, a permission and a device" : null);
  const daysValid =
    Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 90;
  const tokenWhy =
    lockReason ??
    (dirty
      ? "Save or reset grant changes first"
      : !tokenAbilities.length
        ? "Choose at least one permission"
        : tokenAbilities.includes("events:read") &&
            !tokenAbilities.includes("alerts:read")
          ? "Alert event feed needs Alerts"
          : !daysValid
            ? "Choose 1 to 90 days"
            : null);
  const hookAllowed =
    app.abilities.includes("alerts:read") && app.abilities.includes("events:read");
  const hookWhy =
    lockReason ??
    (dirty
      ? "Save or reset grant changes first"
      : !hookAllowed
        ? "Needs the Alerts and Alert event feed permissions"
        : null);
  const secretPanel = (label: string) =>
    secret?.label === label && (
      <SecretPanel
        key={secret.value}
        label={secret.label}
        value={secret.value}
        level={level}
        onNotice={setNotice}
        onDismiss={() => {
          setSecret(null);
          setNotice("");
        }}
      />
    );
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice("Copy unavailable. Select the value and copy it manually.");
    }
  };
  const connection = [
    { label: "API base URL", value: api.integrationApiUrl() },
    { label: "Organization ID", value: org },
    { label: "Application ID", value: app.uuid },
  ];
  const status = app.revoked_at ? (
    <StatusMark tone="muted">Revoked</StatusMark>
  ) : (
    <StatusMark tone="good">Active</StatusMark>
  );
  const reloadButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() =>
        ask(
          "Reload application?",
          "Load the latest server state. Local edits and any displayed secret will be discarded.",
          "Reload",
          reload,
          false,
        )
      }
    >
      <RefreshCwIcon data-icon="inline-start" />
      Reload latest state
    </Button>
  );
  const body = (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!back && (
          <h2 className="min-w-0 text-base font-semibold break-words">
            {app.name}
          </h2>
        )}
        {status}
        <div className="ml-auto">{reloadButton}</div>
      </div>
      {!confirm && Boolean(error) && (
        <>
          <RequestError error={error} />
          <Alert>
            <AlertTitle>
              Check the latest state before repeating an action
            </AlertTitle>
            <AlertDescription>
              A lost response may mean the change succeeded. Reload to review
              it. A lost token or signing secret must be rotated again.
            </AlertDescription>
          </Alert>
        </>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-6 gap-y-3 border-y py-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Devices</dt>
          <dd className="tabular-nums">{app.device_uuids.length} of 100</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Permissions</dt>
          <dd className="tabular-nums">{app.abilities.length} of 4</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Token</dt>
          <dd>
            {app.credential ? (
              <>
                expires{" "}
                <time
                  dateTime={app.credential.expires_at}
                  title={formatDateTime(app.credential.expires_at)}
                >
                  {new Date(app.credential.expires_at).toLocaleDateString()}
                </time>
              </>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Webhook</dt>
          <dd>
            {hook?.enabled ? (
              <StatusMark tone="good">Enabled</StatusMark>
            ) : hook ? (
              <StatusMark tone="muted">Disabled</StatusMark>
            ) : (
              "Not configured"
            )}
          </dd>
        </div>
      </dl>
      <Section
        level={level}
        title="Connection details"
      >
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 text-sm">
          {connection.map((item) => (
            <div key={item.label} className="contents">
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <code className="min-w-0 truncate font-mono text-xs">
                  {item.value}
                </code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Copy ${item.label}`}
                  title={`Copy ${item.label}`}
                  onClick={() => void copy(item.label, item.value)}
                >
                  <CopyIcon />
                </Button>
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section level={level} title="Access grants">
        <form
          className="flex flex-col gap-4"
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
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={locked || !dirty || !valid(draft)}>
              Save grants
            </Button>
            {grantsWhy && (
              <span className="text-xs text-muted-foreground">{grantsWhy}</span>
            )}
          </div>
        </form>
      </Section>
      <Section level={level} title="Application token">
        <p className="text-sm text-muted-foreground">
          {app.credential ? (
            <>
              Last issued token expires{" "}
              {formatDateTime(app.credential.expires_at)}.
            </>
          ) : (
            "No token is currently issued."
          )}{" "}
          Tokens belong in the application's backend, never browser code.
        </p>
        <AbilityFields
          label="Token permissions"
          value={tokenAbilities}
          allowed={app.abilities}
          disabled={locked || dirty}
          onChange={setTokenAbilities}
        />
        <div className="max-w-48">
          <TextField
            label="Token lifetime (days)"
            type="number"
            min={1}
            max={90}
            step={1}
            value={days}
            disabled={locked || dirty}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={locked || Boolean(tokenWhy)}
            onClick={() =>
              ask(
                "Issue a new token?",
                "The previous token will stop working immediately. Copy the replacement before leaving this page.",
                "Issue token",
                async () => {
                  const result = await api.issueIntegrationToken(org, app.uuid, {
                    revision: app.revision,
                    abilities: tokenAbilities,
                    expires_in_days: Number(days),
                  });
                  setApp(result.application);
                  showSecret("Application token", result.token);
                },
                false,
              )
            }
          >
            Issue new token
          </Button>
          <span className="text-xs text-muted-foreground">
            {tokenWhy ?? "Issuing a token invalidates the previous one."}
          </span>
        </div>
        {secretPanel("Application token")}
      </Section>
      <Section
        level={level}
        title="Webhook"
        aside={
          hook?.enabled ? (
            <StatusMark tone="good">Enabled</StatusMark>
          ) : (
            <StatusMark tone="muted">Disabled</StatusMark>
          )
        }
      >
        {hook?.diagnostic && (
          <p role="status" className="text-sm">
            {hook.diagnostic}
          </p>
        )}
        <TextField
          label="Receiver URL"
          type="url"
          value={url}
          disabled={locked || dirty}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://receiver.example.com/events"
          help="HTTPS only. Your platform operator must allowlist the host."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={locked || dirty || !url.trim() || !hookAllowed}
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
          {(hookWhy ?? (!url.trim() ? "Enter a receiver URL" : null)) && (
            <span className="text-xs text-muted-foreground">
              {hookWhy ?? "Enter a receiver URL"}
            </span>
          )}
        </div>
        {secretPanel("Webhook signing secret")}
      </Section>
      {hook && (
        <Section
          level={level}
          title="Deliveries"
          aside={
            <Button
              variant="outline"
              size="sm"
              disabled={deliveries.isFetching}
              onClick={() => deliveries.refetch()}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Refresh deliveries
            </Button>
          }
        >
          <p className="text-xs text-muted-foreground">
            Receivers must deduplicate events; a retry can repeat a delivery
            accepted before a network failure.
          </p>
          <RequestError error={deliveries.error} />
          {deliveries.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : deliveries.data?.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.data.data.map((item) => (
                  <TableRow key={item.uuid} className="align-top">
                    <TableCell className="whitespace-normal">
                      <StatusMark tone={deliveryTones[item.status] ?? "muted"}>
                        {item.status.charAt(0).toUpperCase() +
                          item.status.slice(1).replaceAll("_", " ")}
                      </StatusMark>
                      {item.diagnostic && (
                        <span className="block text-xs text-muted-foreground">
                          {item.diagnostic}
                        </span>
                      )}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Attempt history
                        </summary>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {item.history.map((attempt) => (
                            <li key={attempt.attempt}>
                              Attempt {attempt.attempt} · {attempt.outcome} ·{" "}
                              {attempt.http_status
                                ? `HTTP ${attempt.http_status}`
                                : "No HTTP response"}{" "}
                              · {formatDateTime(attempt.created_at)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.attempts}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.delivered_at ? (
                        <>
                          Delivered <Age value={item.delivered_at} />
                        </>
                      ) : (
                        <>Deadline {formatDateTime(item.expires_at)}</>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.status === "failed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={locked || !hook.enabled || dirty || hookDirty}
                          title={
                            !hook.enabled
                              ? "Webhook is disabled"
                              : dirty || hookDirty
                                ? "Save or reset your changes first"
                                : undefined
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
                              false,
                            )
                          }
                        >
                          Retry delivery
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !deliveries.error ? (
            <p className="text-sm text-muted-foreground">
              New alert events appear here after the webhook is configured.
            </p>
          ) : null}
          <DevicePages
            meta={deliveries.data?.meta}
            label="Webhook deliveries"
            onPage={setPage}
          />
        </Section>
      )}
      {!app.revoked_at && (
        <section
          aria-labelledby="revoke-application"
          className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
        >
          <div>
            <Heading id="revoke-application" className="text-sm font-semibold">
              Revoke application
            </Heading>
            <p className="text-xs text-muted-foreground">
              Stops API access and webhook delivery permanently.
            </p>
          </div>
          <Button
            variant="destructive"
            disabled={locked || dirty || hookDirty}
            title={
              dirty || hookDirty ? "Save or reset your changes first" : undefined
            }
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
        </section>
      )}
      <Confirm
        open={Boolean(confirm)}
        title={confirm?.title ?? "Confirm change"}
        description={confirm?.description ?? ""}
        action={confirm?.action}
        destructive={confirm?.destructive ?? true}
        onClose={() => setConfirm(null)}
        onConfirm={() => perform(confirm!.run)}
      />
    </div>
  );
  // The header comes and goes with the layout; the section stays so its subtree keeps its state.
  return (
    <>
      {back && (
        <PageHeader
          title={app.name}
          back={{ to: back, label: "Integrations" }}
        />
      )}
      <section
        aria-label="Application detail"
        className="min-w-0 p-4 md:p-6 xl:max-w-4xl"
      >
        {body}
      </section>
    </>
  );
}
