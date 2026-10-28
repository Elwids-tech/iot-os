import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type {
  AdapterDraft,
  AdapterFixture,
  AdapterProfile,
  AdapterSource,
  AdapterSourceType,
  DeviceAdapter,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table";
import { EmptyState } from "@iot-os/ui/components/empty-state";
import { Status, StatusMark } from "@iot-os/ui/components/status-mark";
import { CollectionPage } from "@iot-os/ui/templates/collection-page";
import { PlugIcon, PlusIcon } from "lucide-react";
import { Badge } from "@iot-os/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field";
import { Input } from "@iot-os/ui/components/input";
import { Textarea } from "@iot-os/ui/components/textarea";
import { DraftBar } from "@iot-os/ui/components/draft-bar";
import { statusOf } from "@iot-os/ui/lib/status";
import { WorkspacePage } from "@iot-os/ui/templates/workspace-page";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { ChoiceCard } from "@iot-os/ui/components/choice-card";
import { RadioGroup } from "@iot-os/ui/components/radio-group";
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@iot-os/ui/components/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { JsonEditor } from "@iot-os/ui/components/json-editor";
import { api } from "../lib/api";
import { useDirtyContext, useUnsaved } from "../lib/unsaved";
import { RequestError } from "../components/forms";
import { useDeviceOrganization } from "../devices/shared";
import { AdapterDevices, AdapterCredentials } from "./connections";
import { Activity } from "./Activity";
import { Samples } from "./Samples";
import { SetupChecklist } from "./SetupChecklist";
import { usePanel } from "../panel/context";
import {
  CursorStartField,
  cursorStartError,
  FetchNow,
  PollSource,
} from "./sources/PollSource";
import { WebhookAuthentication, WebhookSecrets } from "./sources/WebhookSource";
import {
  appendFixture,
  authLabels,
  defaultSource,
  isMqtt,
  localInput,
  secretsForSave,
  sourceForSave,
  sourceLabel,
} from "./source";

const path = (org: string, id = "") =>
  `/organizations/${org}/device-adapters${id ? `/${id}` : ""}`;
const sample = [
  {
    topic: "meters/WM-1042/telemetry",
    payload: { serial: "WM-1042", flow_ml_min: 12000, total_ml: 8400000 },
    expected: [
      { name: "flow_rate", value: 12 },
      { name: "total_volume", value: 8400 },
    ],
  },
];
const waterCode = `function decode(input, helpers) {
  const payload = input.payload;
  if (!payload || typeof payload.serial !== "string") throw new Error("Missing meter serial");
  return {
    sourceDeviceId: payload.serial,
    metrics: [
      { name: "flow_rate", value: payload.flow_ml_min / 1000, unit: "L/min" },
      { name: "total_volume", value: payload.total_ml / 1000, unit: "L" }
    ]
  };
}`;
const emptyDraft: AdapterDraft = {
  name: "",
  artifact_uuid: "",
  source: { type: "platform", topics: ["meters/+/telemetry"] },
  code: waterCode,
  fixtures: sample,
};

export default function AdapterRoutes() {
  return (
    <Routes>
      <Route index element={<Directory />} />
      <Route path="new" element={<Workbench key="new" />} />
      <Route path=":adapterUuid" element={<Existing />} />
    </Routes>
  );
}

function Directory() {
  const { org } = useDeviceOrganization();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["adapters", org],
    queryFn: () => api.deviceAdapters(org),
    refetchInterval: 5000,
  });
  const manage = Boolean(query.data?.capabilities.manage && query.data.capabilities.connections);
  const columns = useMemo<DataColumn<AdapterRow>[]>(
    () => [
      {
        id: "adapter",
        header: "Adapter",
        mobile: "title",
        sortable: true,
        searchable: true,
        value: (a) => a.name,
        cell: (a) => <RowLink to={path(org, a.uuid)}>{a.name}</RowLink>,
      },
      { id: "type", header: "Device type", sortable: true, searchable: true, value: (a) => a.profile_name, cell: (a) => a.profile_name },
      {
        id: "source",
        header: "Source",
        mobile: "meta",
        value: (a) => sourceLabel(a.source.type),
        cell: (a) => (
          <span className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">{sourceLabel(a.source.type)}</span>
            {a.source_state && (
              <StatusMark tone={statusOf(a.source_state.state, "source").tone} className="text-meta">
                {a.source_state.label || statusOf(a.source_state.state, "source").label}
              </StatusMark>
            )}
          </span>
        ),
      },
      {
        id: "deployment",
        header: "Deployment",
        mobile: "badge",
        sortable: true,
        value: (a) => a.status,
        cell: (a) => (
          <>
            <Status value={a.status} />
            {a.diagnostic && <p className="text-meta text-destructive">{a.diagnostic}</p>}
          </>
        ),
      },
    ],
    [org],
  );
  return (
    <CollectionPage
      title="Device adapters"
      description="Decoders for manufacturer devices that publish MQTT, send webhooks from a vendor cloud or keep their data behind a vendor API, run in your organization's private Node-RED runtime."
      actions={
        manage && (
          <Button size="sm" asChild>
            <Link to={path(org, "new")}>
              <PlusIcon data-icon="inline-start" />
              New adapter
            </Link>
          </Button>
        )
      }
    >
      <DataTable
        id="device-adapters"
        label="Device adapters"
        noun={["adapter", "adapters"]}
        rows={query.data?.data}
        rowKey={(a) => a.uuid}
        rowHref={(a) => path(org, a.uuid)}
        columns={columns}
        defaultSort={[{ id: "adapter", desc: false }]}
        error={query.error ? <RequestError error={query.error} /> : undefined}
        search={{
          label: "Search device adapters",
          placeholder: "Search adapters or device types",
          value: search,
          onChange: setSearch,
        }}
        groups={[
          { id: "source", label: "Source", value: (a) => sourceLabel(a.source.type) },
          { id: "type", label: "Device type", value: (a) => a.profile_name },
        ]}
        refreshSeconds={5}
        empty={
          <EmptyState
            inset
            icon={<PlugIcon />}
            title="Connect your first manufacturer device"
            description="Choose a profile, connect the manufacturer's MQTT broker, webhook or API, and test how the decoder maps a real sample to platform readings. Credentials and secrets stay isolated to your organization."
            action={
              manage && (
                <Button size="sm" asChild>
                  <Link to={path(org, "new")}>New adapter</Link>
                </Button>
              )
            }
          />
        }
      />
    </CollectionPage>
  );
}

type AdapterRow = NonNullable<Awaited<ReturnType<typeof api.deviceAdapters>>>["data"][number];

function Existing() {
  const { org } = useDeviceOrganization();
  const { adapterUuid = "" } = useParams();
  const query = useQuery({
    queryKey: ["adapter", org, adapterUuid],
    queryFn: () => api.deviceAdapter(org, adapterUuid),
    refetchInterval: 3000,
  });
  if (!query.data)
    return (
      <>
        <RequestError error={query.error} />
        {query.isPending && <Skeleton className="h-96" />}
      </>
    );
  return <Workbench key={adapterUuid} adapter={query.data} />;
}

function Workbench({ adapter }: { adapter?: DeviceAdapter }) {
  const { org, capabilities } = useDeviceOrganization();
  const cache = useQueryClient();
  const { setDirty: clearGlobalDirty } = useDirtyContext();
  const navigate = useNavigate();
  const [tab, setTab] = useState(adapter ? "source" : "type");
  // The onboarding assistant in the workspace panel opens the step it suggests.
  const location = useLocation();
  const { startTask } = usePanel();
  useEffect(() => {
    const wanted = (location.state as { tab?: string } | null)?.tab;
    if (adapter && wanted) setTab(wanted);
  }, [adapter?.uuid, location.key]);
  const [draft, setDraft] = useState<AdapterDraft>(
    adapter
      ? {
          name: adapter.name,
          artifact_uuid: adapter.artifact_uuid,
          code: adapter.code,
          fixtures: adapter.fixtures,
          source: adapter.source,
        }
      : emptyDraft,
  );
  const [fixtureText, setFixtureText] = useState(
    JSON.stringify(draft.fixtures, null, 2),
  );
  // Add as fixture reads the latest text without re-creating every table's columns.
  const fixtureRef = useRef(fixtureText);
  fixtureRef.current = fixtureText;
  const [topicText, setTopicText] = useState(topicsOf(draft.source));
  // Each source type keeps what was typed while the person compares types; only the chosen one is saved.
  const sourceMemory = useRef<Partial<Record<AdapterSourceType, AdapterSource>>>({});
  const [cursorStart, setCursorStart] = useState(() =>
    localInput(Date.now() - 3_600_000),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [profileSearch, setProfileSearch] = useState("");
  const [rollback, setRollback] = useState("");
  const [rollbackSearch, setRollbackSearch] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const revision = useRef(adapter?.draft_revision);
  const profiles = useQuery({
    queryKey: ["adapter-profiles", org],
    queryFn: () => api.adapterProfiles(org),
  });
  const selected = profiles.data?.find((p) => p.uuid === draft.artifact_uuid);
  const canEdit = capabilities.manage && capabilities.connections;

  const adopt = useCallback(
    (next: DeviceAdapter) => {
      setDraft({
        name: next.name,
        artifact_uuid: next.artifact_uuid,
        code: next.code,
        fixtures: next.fixtures,
        source: next.source,
      });
      setFixtureText(JSON.stringify(next.fixtures, null, 2));
      setTopicText(topicsOf(next.source));
      sourceMemory.current = {};
      setDirty(false);
      revision.current = next.draft_revision;
      cache.setQueryData(["adapter", org, next.uuid], next);
    },
    [cache, org],
  );
  useEffect(() => {
    if (adapter && !dirty && revision.current !== adapter.draft_revision)
      adopt(adapter);
  }, [adapter, dirty, adopt]);
  function change(patch: Partial<AdapterDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setNotice("");
  }
  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const fixtures = JSON.parse(fixtureText);
      if (!Array.isArray(fixtures))
        throw new Error("Samples must be an array of fixtures.");
      const values = {
        ...draft,
        fixtures,
        source: sourceForSave(
          draft.source,
          topicText
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
        secrets: secretsForSave(draft.source, draft.secrets),
      };
      const next = adapter
        ? await api.saveDeviceAdapter(org, adapter.uuid, {
            ...values,
            draft_revision: revision.current!,
          })
        : await api.createDeviceAdapter(org, {
            ...values,
            request_uuid: requestId.current,
          });
      adopt(next);
      setNotice("Draft saved. Test this revision before deploying.");
      if (!adapter) {
        clearGlobalDirty(false);
        navigate(path(org, next.uuid), { replace: true });
      }
      return true;
    } catch (reason) {
      setError(reason);
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    adapter,
    adopt,
    clearGlobalDirty,
    draft,
    fixtureText,
    navigate,
    org,
    topicText,
  ]);
  useUnsaved(dirty, save);
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await action();
      setNotice(message);
      if (adapter)
        await cache.invalidateQueries({
          queryKey: ["adapter", org, adapter.uuid],
        });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  function setSource(source: AdapterSource) {
    change({ source });
  }
  function chooseSource(type: AdapterSourceType) {
    if (type === draft.source.type) return;
    sourceMemory.current[draft.source.type] = draft.source;
    change({
      source: sourceMemory.current[type] ?? defaultSource(type),
      secrets: undefined,
    });
  }
  const addFixture = useCallback((fixture: AdapterFixture) => {
    try {
      const { text, count } = appendFixture(fixtureRef.current, fixture);
      setFixtureText(text);
      setDirty(true);
      setNotice("");
      toast.success(
        count > 10
          ? `Added as fixture ${count}. Tests run at most 10 fixtures: remove some before testing, then save the draft.`
          : `Added as fixture ${count}. Save the draft to keep it.`,
      );
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "The fixture could not be added.");
    }
  }, []);
  function selectProfile(value: string) {
    const profile = profiles.data?.find((p) => p.uuid === value);
    change({
      artifact_uuid: value,
      ...(!adapter && profile ? starter(profile) : {}),
    });
    if (!adapter && profile)
      setFixtureText(JSON.stringify(starter(profile).fixtures, null, 2));
  }
  const tested = !dirty && adapter?.revision.test_result?.valid === true;
  const pending = adapter?.status === "pending";
  // A deploy notice describes the request; once the runtime acknowledges it the
  // status badges say what is running, so the "waiting" text must not linger.
  const deployNotice = "Deployment requested. Waiting for the tenant runtime.";
  const shownNotice = notice === deployNotice && adapter?.status && !pending ? "" : notice;
  const applied =
    adapter?.revisions.find((r) => r.uuid === adapter.applied_revision_uuid)?.revision ?? "none";
  // The first deployment of a polling source chooses where its cursor starts (FR-033).
  const firstPoll =
    adapter?.source.type === "poll" &&
    (!adapter.polling || adapter.polling.state === "not_deployed");
  const webhookAvailable = adapter ? adapter.webhook?.available !== false : true;
  return (
    <WorkspacePage
      title={adapter ? adapter.name : "New device adapter"}
      back={{ to: path(org), label: "Device adapters" }}
      tools={
        <p className="text-body text-muted-foreground">
          One tested workflow per device type, from MQTT, webhooks or a vendor API, with a stable platform device for each activated serial.
        </p>
      }
      draft={
        adapter && (
          <DraftBar
            tone={statusOf(adapter.status).tone}
            status={statusOf(adapter.status).label}
            revision={`Draft ${adapter.draft_revision} · applied ${applied}`}
            dirty={dirty}
          >
            {isMqtt(adapter.source) ? (
              <span>Source {connectionStatus(adapter, "source_connected")}</span>
            ) : (
              <span>
                {sourceLabel(adapter.source.type)}:{" "}
                {adapter.source_state?.label ??
                  statusOf(adapter.source_state?.state, "source").label}
              </span>
            )}
            <span>Publisher {connectionStatus(adapter, "upstream_connected")}</span>
          </DraftBar>
        )
      }
    >
      {!canEdit && (
        <Alert>
          <AlertDescription>
            Device management and connection permissions are required to edit
            adapters.
          </AlertDescription>
        </Alert>
      )}
      {dirty && (
        <Alert>
          <AlertDescription>
            Unsaved changes. Save and test your draft before deployment; the
            applied revision continues running.
          </AlertDescription>
        </Alert>
      )}
      <RequestError error={error || profiles.error} />
      {shownNotice && (
        <Alert>
          <AlertDescription>{shownNotice}</AlertDescription>
        </Alert>
      )}
      {adapter?.diagnostic && (
        <Alert variant="destructive">
          <AlertTitle>Adapter needs attention</AlertTitle>
          <AlertDescription>{adapter.diagnostic}</AlertDescription>
        </Alert>
      )}
      {adapter && adapter.checklist?.length > 0 && (
        <SetupChecklist
          checklist={adapter.checklist}
          onOpen={setTab}
          onAsk={canEdit ? () => startTask("onboarding", { to: "onboarding" }) : undefined}
        />
      )}
      <Tabs value={tab} onValueChange={setTab}>
        {/* Wraps on phones; the triggers drop their 100% height so a second row adds height instead of overlapping. */}
        <TabsList className="flex-wrap *:h-auto group-data-[orientation=horizontal]/tabs:h-auto">
          <TabsTrigger value="type">1 · Device type</TabsTrigger>
          <TabsTrigger value="source">2 · Connection</TabsTrigger>
          <TabsTrigger value="decoder">3 · Decode & test</TabsTrigger>
          <TabsTrigger value="deploy" disabled={!adapter}>
            4 · Review & deploy
          </TabsTrigger>
          <TabsTrigger value="devices" disabled={!adapter}>
            5 · Devices
          </TabsTrigger>
          <TabsTrigger value="activity" disabled={!adapter}>
            Activity
          </TabsTrigger>
        </TabsList>
        <TabsContent value="type">
          <Card>
            <CardHeader>
              <CardTitle>Choose the readings this device reports</CardTitle>
              <CardDescription>
                A published device profile defines the metric names, types and
                target units.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="adapter-name">Adapter name</FieldLabel>
                  <Input
                    id="adapter-name"
                    value={draft.name}
                    onChange={(e) => change({ name: e.target.value })}
                    disabled={!canEdit}
                    placeholder="Manufacturer water meter"
                  />
                </Field>
                <SearchableSelect
                  label="Published device profile"
                  value={draft.artifact_uuid}
                  options={(profiles.data ?? [])
                    .filter((p) =>
                      p.name
                        .toLowerCase()
                        .includes(profileSearch.toLowerCase()),
                    )
                    .map((p) => ({
                      value: p.uuid,
                      label: `${p.name} · revision ${p.revision}`,
                    }))}
                  search={profileSearch}
                  onSearchChange={setProfileSearch}
                  onChange={selectProfile}
                  disabled={!canEdit}
                  loading={profiles.isPending}
                  selectedLabel={
                    selected
                      ? `${selected.name} · revision ${selected.revision}`
                      : adapter?.profile_name
                  }
                />
                {!profiles.isPending && !profiles.data?.length && (
                  <FieldDescription>
                    Publish a device profile before creating an adapter.
                  </FieldDescription>
                )}
              </FieldGroup>
              {(selected?.definition ?? adapter?.profile)?.parameters
                .filter((p) => p.reports_state && p.kind !== "derived")
                .map((p) => (
                  <p key={p.uuid} className="mt-3 text-sm">
                    <code>{p.key}</code> · {p.data_type} ·{" "}
                    {p.unit || "unitless"}
                  </p>
                ))}
            </CardContent>
            <CardFooter>
              <Button
                onClick={() => setTab("source")}
                disabled={!draft.artifact_uuid || !draft.name.trim()}
              >
                Continue to connection
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
        <TabsContent value="source">
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader>
                <PanelTitle>Where does the data come from?</PanelTitle>
                <PanelDescription>
                  Keep the manufacturer’s own format. Choose how it reaches the
                  adapter.
                </PanelDescription>
              </PanelHeader>
              <PanelContent>
                <RadioGroup
                  value={draft.source.type}
                  onValueChange={(value) =>
                    value && chooseSource(value as AdapterSourceType)
                  }
                  className="grid gap-3 md:grid-cols-2"
                  aria-label="Source type"
                  disabled={!canEdit}
                >
                  <ChoiceCard
                    value="platform"
                    checked={draft.source.type === "platform"}
                    disabled={!canEdit}
                    title="Devices publish to our broker"
                    description="Each device gets a connection kit for your organization’s isolated MQTT broker."
                  />
                  <ChoiceCard
                    value="vendor"
                    checked={draft.source.type === "vendor"}
                    disabled={!canEdit}
                    title="Vendor MQTT broker"
                    description="The adapter subscribes to the manufacturer’s internet-reachable broker with its credentials."
                  />
                  <ChoiceCard
                    value="webhook"
                    checked={draft.source.type === "webhook"}
                    disabled={!canEdit || !webhookAvailable}
                    title="Vendor cloud sends webhooks"
                    description={
                      webhookAvailable
                        ? "The vendor cloud posts each message to an HTTPS ingest URL with a secret you control."
                        : "This deployment does not accept webhooks yet: an operator has to configure a public ingest address first."
                    }
                  />
                  <ChoiceCard
                    value="poll"
                    checked={draft.source.type === "poll"}
                    disabled={!canEdit}
                    title="Poll a vendor API"
                    description="The adapter calls the vendor’s REST API on a schedule and resumes where the last run stopped."
                  />
                </RadioGroup>
              </PanelContent>
            </Panel>
            {isMqtt(draft.source) && (
              <Panel>
                <PanelHeader>
                  <PanelTitle>
                    {draft.source.type === "platform"
                      ? "Tenant broker topics"
                      : "Vendor broker"}
                  </PanelTitle>
                  <PanelDescription>
                    {draft.source.type === "platform"
                      ? "Download a hardware connection kit after saving. Devices publish to your organization’s isolated broker."
                      : "The adapter subscribes to an internet-reachable broker using the manufacturer’s credentials."}
                  </PanelDescription>
                </PanelHeader>
                <PanelContent>
                  <FieldGroup>
                    {draft.source.type === "vendor" && (
                      <VendorBroker
                        source={draft.source}
                        secrets={draft.secrets}
                        saved={!!adapter?.credentials_configured}
                        disabled={!canEdit}
                        onSource={setSource}
                        onSecrets={(secrets) => change({ secrets })}
                      />
                    )}
                    <Field>
                      <FieldLabel htmlFor="adapter-topics">
                        Manufacturer topic filters
                      </FieldLabel>
                      <Textarea
                        id="adapter-topics"
                        value={topicText}
                        disabled={!canEdit}
                        rows={3}
                        onChange={(e) => {
                          setTopicText(e.target.value);
                          setDirty(true);
                        }}
                      />
                      <FieldDescription>
                        One filter per line, for example meters/+/telemetry.
                        Sparkplug and broker control topics are reserved.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </PanelContent>
              </Panel>
            )}
            {draft.source.type === "webhook" && (
              <WebhookAuthentication
                auth={draft.source.auth}
                onChange={(auth) => setSource({ type: "webhook", auth })}
                disabled={!canEdit}
              />
            )}
            {draft.source.type === "poll" && (
              <PollSource
                adapter={adapter}
                source={draft.source}
                onChange={setSource}
                secrets={draft.secrets}
                onSecretsChange={(secrets) => change({ secrets })}
                canEdit={canEdit}
                error={error}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !canEdit} onClick={() => void save()}>
                Save connection
              </Button>
              {isMqtt(draft.source) && (
                <Button
                  variant="outline"
                  disabled={!adapter || dirty || busy || !canEdit}
                  onClick={() =>
                    void run(
                      () => api.testAdapterConnection(org, adapter!.uuid),
                      "Broker connection verified.",
                    )
                  }
                >
                  Test broker connection
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setTab("decoder")}
                disabled={!draft.artifact_uuid}
              >
                Continue to decoder
              </Button>
            </div>
            {adapter && draft.source.type === "platform" && adapter.source.type === "platform" && (
              <AdapterCredentials
                org={org}
                adapter={adapter}
                disabled={dirty || !capabilities.connections}
              />
            )}
            {draft.source.type === "webhook" &&
              (adapter?.source.type === "webhook" ? (
                <WebhookSecrets
                  org={org}
                  adapter={adapter}
                  canManage={capabilities.connections}
                />
              ) : (
                <Alert>
                  <AlertDescription>
                    Save the connection to get this adapter’s ingest URL, then
                    create the secret the vendor cloud signs or sends with each
                    delivery.
                  </AlertDescription>
                </Alert>
              ))}
            {draft.source.type === "poll" && (
              <FetchNow
                org={org}
                adapter={adapter}
                dirty={dirty}
                canConnect={capabilities.connections}
                onAddFixture={addFixture}
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="decoder">
          <div className="flex flex-col gap-4">
          {adapter && <Samples org={org} adapter={adapter} onAdd={addFixture} />}
          <Card>
            <CardHeader>
              <CardTitle>Decode a real manufacturer payload</CardTitle>
              <CardDescription>
                Return sourceDeviceId and metrics in the profile’s units. Each
                message runs in a fresh JavaScript sandbox.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Alert>
                <AlertDescription>
                  {decoderInput(draft.source)} Return one result or a list of up
                  to 500, each with sourceDeviceId and metrics. Add observedAt
                  from the device’s own time; without it readings are
                  receipt-timed and locations are untrusted. Helpers: uint16BE
                  and uint32BE. Use synchronous code; network, files, modules and
                  persistent state are unavailable.
                </AlertDescription>
              </Alert>
              <div className="grid gap-4 xl:grid-cols-2">
                <JsonEditor
                  label="JavaScript · function decode(input, helpers)"
                  language="javascript"
                  value={draft.code}
                  readOnly={!canEdit}
                  onChange={(code) => change({ code })}
                />
                <JsonEditor
                  label="Sample fixtures · JSON"
                  value={fixtureText}
                  readOnly={!canEdit}
                  onChange={(value) => {
                    setFixtureText(value);
                    setDirty(true);
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                A fixture contains a payload (or payload_base64), plus expected
                metrics or expect_error. topic is optional for webhooks and
                polling; source, received_at, http and poll reproduce a captured
                input. Include at least one successful sample; tests run 1 to 10
                fixtures.
              </p>
              {adapter?.revision.test_result && (
                <div className="flex flex-col gap-3">
                  <Badge variant={tested ? "secondary" : "outline"}>
                    {dirty
                      ? "Results belong to saved draft"
                      : adapter.revision.test_result.valid
                        ? "All samples passed"
                        : "Samples failed"}
                  </Badge>
                  {adapter.revision.test_result.results.map((result, i) => (
                    <Card key={i}>
                      <CardHeader>
                        <CardTitle>
                          Sample {i + 1} · {result.passed ? "Passed" : "Failed"}
                        </CardTitle>
                        <CardDescription>
                          {result.error ||
                            `Serial ${result.output?.sourceDeviceId}`}
                        </CardDescription>
                      </CardHeader>
                      {result.output && (
                        <CardContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Metric</TableHead>
                                <TableHead>Value</TableHead>
                                <TableHead>Unit</TableHead>
                                <TableHead>Type</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {result.output.metrics.map((m) => (
                                <TableRow key={m.name}>
                                  <TableCell>{m.name}</TableCell>
                                  <TableCell>{String(m.value)}</TableCell>
                                  <TableCell>{m.unit ?? "—"}</TableCell>
                                  <TableCell>{m.datatype}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex-wrap gap-2">
              <Button disabled={busy || !canEdit} onClick={() => void save()}>
                Save draft
              </Button>
              <Button
                variant="outline"
                disabled={!adapter || dirty || busy || !canEdit}
                onClick={() =>
                  void run(
                    () =>
                      api.testDeviceAdapter(
                        org,
                        adapter!.uuid,
                        adapter!.draft_revision,
                      ),
                    "Sample tests completed. Review the results below.",
                  )
                }
              >
                Run sample tests
              </Button>
              <Button
                variant="outline"
                disabled={!tested}
                onClick={() => setTab("deploy")}
              >
                Review deployment
              </Button>
            </CardFooter>
          </Card>
          </div>
        </TabsContent>
        <TabsContent value="deploy">
          {adapter && (
            <Card>
              <CardHeader>
                <CardTitle>Review the exact revision</CardTitle>
                <CardDescription>
                  Deployment is asynchronous. Applied revision changes only
                  after the tenant runtime acknowledges it.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p>
                  {draft.name} · {adapter.profile_name} · draft{" "}
                  {adapter.draft_revision}
                </p>
                <p className="text-sm text-muted-foreground">
                  Source: {sourceSummary(adapter)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Revision hash:{" "}
                  <code className="break-all">
                    {adapter.revision.content_hash}
                  </code>
                </p>
                <Alert>
                  <AlertDescription>
                    {tested
                      ? "Samples passed for this saved revision. Deploy to start discovery; review and activate each serial before its readings are stored."
                      : "Save and pass sample tests for this exact revision before deployment."}
                  </AlertDescription>
                </Alert>
                <SearchableSelect
                  label="Tested rollback revision"
                  value={rollback}
                  search={rollbackSearch}
                  onSearchChange={setRollbackSearch}
                  onChange={setRollback}
                  options={adapter.revisions
                    .filter(
                      (r) =>
                        r.test_result?.valid &&
                        String(r.revision).includes(rollbackSearch),
                    )
                    .map((r) => ({
                      value: r.uuid,
                      label: `Revision ${r.revision}`,
                    }))}
                  disabled={busy || pending || !canEdit}
                />
                {firstPoll && (
                  <FieldGroup>
                    <CursorStartField
                      value={cursorStart}
                      onChange={setCursorStart}
                      disabled={busy || pending || !canEdit}
                      label="Start polling from"
                      help="The first run reads records from this time. Up to 30 days back; 1 hour ago by default. You can reset the cursor later from Activity."
                    />
                  </FieldGroup>
                )}
                {adapter.operations.map((o) => (
                  <p key={o.uuid} className="text-sm">
                    {o.action} · {o.status}
                    {o.diagnostic ? ` · ${o.diagnostic}` : ""}
                  </p>
                ))}
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                <Button
                  disabled={
                    !tested ||
                    busy ||
                    pending ||
                    !canEdit ||
                    (firstPoll && !!cursorStartError(cursorStart))
                  }
                  onClick={() =>
                    void run(
                      () =>
                        api.deployDeviceAdapter(org, adapter.uuid, {
                          draft_revision: adapter.draft_revision,
                          action: "deploy",
                          request_uuid: crypto.randomUUID(),
                          ...(firstPoll
                            ? { cursor_start_at: new Date(cursorStart).toISOString() }
                            : {}),
                        }),
                      deployNotice,
                    )
                  }
                >
                  Deploy tested revision
                </Button>
                <Button
                  variant="outline"
                  disabled={!rollback || dirty || busy || pending || !canEdit}
                  onClick={() =>
                    void run(
                      () =>
                        api.deployDeviceAdapter(org, adapter.uuid, {
                          draft_revision: adapter.draft_revision,
                          action: "rollback",
                          revision_uuid: rollback,
                          request_uuid: crypto.randomUUID(),
                        }),
                      "Rollback requested.",
                    )
                  }
                >
                  Roll back
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    !adapter.applied_revision_uuid ||
                    busy ||
                    pending ||
                    !canEdit
                  }
                  onClick={() =>
                    void run(
                      () =>
                        api.deployDeviceAdapter(org, adapter.uuid, {
                          draft_revision: adapter.draft_revision,
                          action: "pause",
                          revision_uuid: adapter.applied_revision_uuid!,
                          request_uuid: crypto.randomUUID(),
                        }),
                      "Pause requested.",
                    )
                  }
                >
                  Pause adapter
                </Button>
              </CardFooter>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="devices">
          {adapter && (
            <AdapterDevices
              org={org}
              adapter={adapter}
              canActivate={
                capabilities.activate &&
                capabilities.manage &&
                capabilities.connections
              }
            />
          )}
        </TabsContent>
        <TabsContent value="activity">
          {adapter && (
            <Activity
              org={org}
              adapter={adapter}
              canReset={capabilities.manage && capabilities.connections}
              onAddFixture={addFixture}
            />
          )}
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}

function starter(
  profile: AdapterProfile,
): Pick<AdapterDraft, "code" | "fixtures"> {
  const metrics = profile.definition.parameters.filter(
    (p) => p.reports_state && p.kind !== "derived",
  );
  if (
    metrics.some((p) => p.key === "flow_rate" && p.unit === "L/min") &&
    metrics.some((p) => p.key === "total_volume" && p.unit === "L")
  )
    return { code: waterCode, fixtures: sample };
  return {
    code: `function decode(input, helpers) {\n  const payload = input.payload;\n  return {\n    sourceDeviceId: payload.serial,\n    metrics: [\n${metrics.map((p) => `      { name: ${JSON.stringify(p.key)}, value: payload[${JSON.stringify(p.key)}]${p.unit ? `, unit: ${JSON.stringify(p.unit)}` : ""} }`).join(",\n")}\n    ]\n  };\n}`,
    fixtures: [
      { topic: "sample/telemetry", payload: { serial: "REPLACE-WITH-SERIAL" } },
    ],
  };
}

function topicsOf(source: AdapterSource) {
  return isMqtt(source) ? source.topics.join("\n") : "";
}

function decoderInput(source: AdapterSource) {
  if (source.type === "webhook")
    return "Input: payload (parsed JSON or null), bytes, payloadBase64, topic (the path below the ingest URL, empty when none), receivedAt, source \"webhook\" and http with method, path, query, contentType, headers and deliveryId.";
  if (source.type === "poll")
    return "Input: one record as payload, its JSON as bytes and payloadBase64, an empty topic, receivedAt (when the page arrived), source \"poll\" and poll with page, index, count and cursor.";
  return "Input: payload, bytes, payloadBase64, topic, receivedAt, retained, qos and source \"mqtt\".";
}

function sourceSummary(adapter: DeviceAdapter) {
  const source = adapter.source;
  if (source.type === "platform")
    return `your tenant MQTT broker. Topics: ${source.topics.join(", ")}`;
  if (source.type === "vendor")
    return `${source.url || "vendor MQTT broker"}. Topics: ${source.topics.join(", ")}`;
  if (source.type === "webhook")
    return `HTTP webhook, ${authLabels[source.auth.mode].toLowerCase()}, at ${adapter.webhook?.ingest_url ?? "its ingest URL"}.`;
  const minutes = Math.round(source.interval_seconds / 60);
  return `polls ${source.request.method} ${source.request.url} every ${minutes} min, up to ${source.page.max_pages} pages a run.`;
}

function VendorBroker({
  source,
  secrets,
  saved,
  disabled,
  onSource,
  onSecrets,
}: {
  source: Extract<AdapterSource, { type: "vendor" }>;
  secrets: AdapterDraft["secrets"];
  saved: boolean;
  disabled: boolean;
  onSource: (source: AdapterSource) => void;
  onSecrets: (secrets: NonNullable<AdapterDraft["secrets"]>) => void;
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="adapter-url">Broker URL</FieldLabel>
        <Input
          id="adapter-url"
          value={source.url ?? ""}
          placeholder="mqtts://mqtt.vendor.example:8883"
          disabled={disabled}
          onChange={(e) => onSource({ ...source, url: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="adapter-user">Username</FieldLabel>
        <Input
          id="adapter-user"
          autoComplete="off"
          value={secrets?.username ?? ""}
          disabled={disabled}
          placeholder={saved ? "Saved · enter to replace" : "Vendor username"}
          onChange={(e) => onSecrets({ ...secrets, username: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="adapter-password">Password</FieldLabel>
        <Input
          id="adapter-password"
          type="password"
          autoComplete="new-password"
          value={secrets?.password ?? ""}
          disabled={disabled}
          placeholder={saved ? "Saved · enter to replace" : "Vendor password"}
          onChange={(e) => onSecrets({ ...secrets, password: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="adapter-ca" optional>
          Custom CA certificate
        </FieldLabel>
        <Textarea
          id="adapter-ca"
          rows={3}
          value={secrets?.ca_certificate ?? ""}
          disabled={disabled}
          placeholder="PEM certificate. Leave blank to preserve the saved value."
          onChange={(e) => onSecrets({ ...secrets, ca_certificate: e.target.value })}
        />
      </Field>
    </>
  );
}

function connectionStatus(
  adapter: DeviceAdapter,
  field: "source_connected" | "upstream_connected",
) {
  const checked = Date.parse(adapter.health?.checked_at ?? "");
  if (!Number.isFinite(checked) || Date.now() - checked > 30000)
    return "unknown";
  return adapter.health?.[field] ? "connected" : "not connected";
}
