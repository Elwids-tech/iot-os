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
import {
  ChevronDownIcon,
  MoreHorizontalIcon,
  PlugIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@iot-os/ui/components/collapsible";
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
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel";
import { PropertyList } from "@iot-os/ui/templates/entity-page";
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
import { Confirm, RequestError } from "../components/forms";
import { useDeviceOrganization } from "../devices/shared";
import { AdapterDevices, AdapterCredentials } from "./connections";
import { Activity } from "./Activity";
import { Samples } from "./Samples";
import { AdapterOverview, connectionStatus } from "./Overview";
import { SetupNext, StepMark, setupSteps, stepState } from "./SetupSteps";
import { SourceChoice, SourceChooser } from "./SourceChooser";
import { usePanel } from "../panel/context";
import {
  CursorStartField,
  cursorStartError,
  FetchNow,
  PollSource,
} from "./sources/PollSource";
import { OpcuaConnection } from "./sources/OpcuaConnection";
import { WebhookAuthentication, WebhookSecrets } from "./sources/WebhookSource";
import {
  appendFixture,
  authLabels,
  checklistSteps,
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

// What deleting removes, said before the person confirms. Only unused adapters get here.
const deletionDescription = (type: string) =>
  `The decoder, its revisions and samples, and the deployment are removed${
    type === "webhook" ? ", and the webhook URL stops accepting deliveries" : type === "poll" ? ", and polling stops" : ""
  }. No device uses it.`;

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
  const [deleting, setDeleting] = useState<AdapterRow | null>(null);
  const cache = useQueryClient();
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
        rowLabel={(a) => a.name}
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
        rowActions={(a) => (
          <>
            <DropdownMenuItem asChild>
              <Link to={path(org, a.uuid)}>Open</Link>
            </DropdownMenuItem>
            {manage && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!a.deletable} onSelect={() => setDeleting(a)}>
                  {a.deletable ? "Delete" : "Delete (devices use it)"}
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
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
      <Confirm
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "this adapter"}?`}
        description={deletionDescription(deleting?.source.type ?? "")}
        action="Delete adapter"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteDeviceAdapter(org, deleting.uuid);
          toast.success(`Deleted ${deleting.name}`);
          cache.removeQueries({ queryKey: ["adapter", org, deleting.uuid] });
          await cache.invalidateQueries({ queryKey: ["adapters", org] });
        }}
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
  // Setting an adapter up and running it are different pages: steps until the first
  // deployment, then a record that opens on its overview.
  const live = Boolean(adapter?.applied_revision_uuid);
  const [tab, setTab] = useState(() => {
    if (!adapter) return "source";
    if (live) return "overview";
    const next = adapter.checklist?.find((item) => item.state !== "done");
    return (next && checklistSteps[next.step]?.tab) || "source";
  });
  // A new adapter starts with the one question; its settings follow the answer.
  const [choosing, setChoosing] = useState(!adapter);
  // The onboarding assistant in the workspace panel opens the step it suggests.
  const location = useLocation();
  const { startTask } = usePanel();
  useEffect(() => {
    const wanted = (location.state as { tab?: string } | null)?.tab;
    // "type" was a tab of its own; the name and device type now sit with the source.
    if (adapter && wanted) setTab(wanted === "type" ? "source" : wanted);
  }, [adapter?.uuid, location.key]);
  // The first deployment turns the steps into the record; the overview tab exists only there.
  useEffect(() => {
    if (!live && tab === "overview") setTab("source");
  }, [live, tab]);
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
  const [deleteOpen, setDeleteOpen] = useState(false);
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
    adapter?.revisions.find((r) => r.uuid === adapter.applied_revision_uuid)?.revision ?? null;
  // The first deployment of a polling source chooses where its cursor starts (FR-033).
  const firstPoll =
    adapter?.source.type === "poll" &&
    (!adapter.polling || adapter.polling.state === "not_deployed");
  const webhookAvailable = adapter ? adapter.webhook?.available !== false : true;
  const ask = () => startTask("onboarding", { to: "onboarding" });
  // The header says what is wrong, never what is fine: a healthy source and publisher stay quiet.
  const trouble = adapter && live ? connectionTrouble(adapter) : [];
  const reports = (selected?.definition ?? adapter?.profile)?.parameters.filter(
    (p) => p.reports_state && p.kind !== "derived",
  );
  return (
    <WorkspacePage
      title={adapter ? adapter.name : "New device adapter"}
      back={{ to: path(org), label: "Device adapters" }}
      actions={
        adapter &&
        canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More adapter actions">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {live && (
                <>
                  <DropdownMenuItem onSelect={ask}>
                    <SparklesIcon />
                    Ask the assistant
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                variant="destructive"
                disabled={!adapter.deletion?.allowed}
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2Icon />
                Delete adapter
              </DropdownMenuItem>
              {adapter.deletion?.reason && (
                <p className="px-2 pb-1.5 text-meta text-muted-foreground">
                  {adapter.deletion.reason} Adapters in use cannot be deleted.
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
      draft={
        adapter && (
          <DraftBar
            tone={statusOf(adapter.status).tone}
            status={statusOf(adapter.status).label}
            revision={
              applied === null
                ? `Draft ${adapter.revision.revision}`
                : adapter.revision.uuid === adapter.applied_revision_uuid
                  ? `Revision ${applied}`
                  : `Revision ${applied} live · draft ${adapter.revision.revision}`
            }
            dirty={dirty}
          >
            {trouble.map((text) => (
              <StatusMark key={text} tone="warning" className="text-foreground">
                {text}
              </StatusMark>
            ))}
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
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        {/* Wraps on phones; the triggers drop their 100% height so a second row adds height instead of overlapping. */}
        <TabsList
          variant="line"
          aria-label={live ? "Adapter sections" : "Adapter setup"}
          className="flex-wrap justify-start *:h-auto *:flex-none group-data-[orientation=horizontal]/tabs:h-auto"
        >
          {live ? (
            <>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="devices">Devices</TabsTrigger>
              <TabsTrigger value="source">Source</TabsTrigger>
              <TabsTrigger value="decoder">Decoder</TabsTrigger>
              <TabsTrigger value="deploy">Deploy</TabsTrigger>
            </>
          ) : (
            setupSteps.map((step, index) => (
              <TabsTrigger
                key={step.tab}
                value={step.tab}
                disabled={!adapter && index > 1}
                className="gap-2"
              >
                <StepMark
                  number={index + 1}
                  state={
                    adapter?.checklist?.length
                      ? stepState(adapter.checklist, step.items)
                      : undefined
                  }
                />
                {step.label}
              </TabsTrigger>
            ))
          )}
          <TabsTrigger value="activity" disabled={!adapter}>
            Activity
          </TabsTrigger>
        </TabsList>
        {adapter && !live && (
          <SetupNext
            checklist={adapter.checklist ?? []}
            onOpen={setTab}
            onAsk={canEdit ? ask : undefined}
          />
        )}
        {adapter && live && (
          <TabsContent value="overview">
            <AdapterOverview
              adapter={adapter}
              applied={applied}
              tested={tested}
              summary={sourceSummary(adapter)}
              onOpen={setTab}
            />
          </TabsContent>
        )}
        <TabsContent value="source">
          {choosing ? (
            <SourceChooser
              value={draft.source.type}
              onChange={chooseSource}
              onContinue={() => setChoosing(false)}
              disabled={!canEdit}
              webhookAvailable={webhookAvailable}
            />
          ) : draft.source.type === "opcua" ? (
            <div className="flex flex-col gap-4">
              <SourceChoice
                type="opcua"
                onChange={canEdit ? () => setChoosing(true) : undefined}
              />
              <Alert>
                <AlertDescription>
                  Connect to the server and look through what it offers here.
                  Choosing which points to store, and saving this data source,
                  arrive with point maps in the next release.
                </AlertDescription>
              </Alert>
              <OpcuaConnection org={org} canEdit={canEdit} />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <SourceChoice
                type={draft.source.type}
                onChange={canEdit ? () => setChoosing(true) : undefined}
              />
              <Panel>
                <PanelHeader>
                  <PanelTitle>Name and device type</PanelTitle>
                  <PanelDescription>
                    A published device profile sets the readings this adapter stores.
                  </PanelDescription>
                </PanelHeader>
                <PanelContent>
                  <FieldGroup className="md:grid md:grid-cols-2 md:items-start">
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
                    <div className="flex min-w-0 flex-col gap-2">
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
                      {!!reports?.length && (
                        <FieldDescription>
                          Stores{" "}
                          {reports
                            .map((p) => `${p.key}${p.unit ? ` (${p.unit})` : ""}`)
                            .join(", ")}
                          .
                        </FieldDescription>
                      )}
                    </div>
                  </FieldGroup>
                </PanelContent>
              </Panel>
              {isMqtt(draft.source) && (
                <Panel>
                  <PanelHeader>
                    <PanelTitle>
                      {draft.source.type === "platform" ? "Topics" : "Vendor broker"}
                    </PanelTitle>
                    <PanelDescription>
                      {draft.source.type === "platform"
                        ? "Devices publish to your organization’s own broker."
                        : "An internet-reachable broker and the manufacturer’s credentials."}
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
                {!live && (
                  <Button
                    variant="outline"
                    onClick={() => setTab("decoder")}
                    disabled={!draft.artifact_uuid}
                  >
                    Continue to decode
                  </Button>
                )}
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
          )}
        </TabsContent>
        <TabsContent value="decoder">
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader>
                <PanelTitle>Decoder</PanelTitle>
                <PanelDescription>
                  Turns one manufacturer message into readings in the profile’s units.
                </PanelDescription>
              </PanelHeader>
              <PanelContent className="flex flex-col gap-4">
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
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="link"
                      size="sm"
                      className="link-target group/reference h-auto gap-1 p-0"
                    >
                      What the decoder receives and returns
                      <ChevronDownIcon
                        aria-hidden="true"
                        className="transition-transform group-data-[state=open]/reference:rotate-180"
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex max-w-reading flex-col gap-2 pt-2 text-body text-muted-foreground">
                      <p>
                        {decoderInput(draft.source)} Return one result or a list of up
                        to 500, each with sourceDeviceId and metrics. Add observedAt
                        from the device’s own time; without it readings are
                        receipt-timed and locations are untrusted. Helpers: uint16BE
                        and uint32BE. Each message runs in a fresh JavaScript sandbox:
                        use synchronous code; network, files, modules and persistent
                        state are unavailable.
                      </p>
                      <p>
                        A fixture contains a payload (or payload_base64), plus expected
                        metrics or expect_error. topic is optional for webhooks and
                        polling; source, received_at, http and poll reproduce a captured
                        input. Include at least one successful sample; tests run 1 to 10
                        fixtures.
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </PanelContent>
              <PanelFooter className="justify-start gap-2">
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
              </PanelFooter>
            </Panel>
            {adapter?.revision.test_result && (
              <Panel>
                <PanelHeader>
                  <PanelTitle>Test results</PanelTitle>
                  <StatusMark
                    tone={dirty ? "muted" : adapter.revision.test_result.valid ? "good" : "critical"}
                  >
                    {dirty
                      ? "Results belong to saved draft"
                      : adapter.revision.test_result.valid
                        ? "All samples passed"
                        : "Samples failed"}
                  </StatusMark>
                </PanelHeader>
                <PanelContent flush className="divide-y">
                  {adapter.revision.test_result.results.map((result, i) => (
                    <div key={i} className="flex flex-col">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                        <StatusMark tone={result.passed ? "good" : "critical"}>
                          Sample {i + 1} · {result.passed ? "Passed" : "Failed"}
                        </StatusMark>
                        <span className="text-muted-foreground">
                          {result.error || `Serial ${result.output?.sourceDeviceId}`}
                        </span>
                      </p>
                      {result.output && (
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
                      )}
                    </div>
                  ))}
                </PanelContent>
              </Panel>
            )}
            {adapter && <Samples org={org} adapter={adapter} onAdd={addFixture} />}
          </div>
        </TabsContent>
        <TabsContent value="deploy">
          {adapter && (
            <div className="flex flex-col gap-4">
              <Panel>
                <PanelHeader>
                  <PanelTitle>Deploy draft {adapter.revision.revision}</PanelTitle>
                  <PanelDescription>
                    The runtime switches once it acknowledges the deployment.
                  </PanelDescription>
                </PanelHeader>
                <PanelContent className="flex flex-col gap-4">
                  <PropertyList
                    items={[
                      { label: "Adapter", value: `${draft.name} · ${adapter.profile_name}` },
                      { label: "Source", value: sourceSummary(adapter) },
                      {
                        label: "Revision hash",
                        value: <code className="break-all text-code">{adapter.revision.content_hash}</code>,
                      },
                    ]}
                  />
                  <Alert>
                    <AlertDescription>
                      {tested
                        ? "Samples passed for this saved revision. Deploy to start discovery; review and activate each serial before its readings are stored."
                        : "Save and pass sample tests for this exact revision before deployment."}
                    </AlertDescription>
                  </Alert>
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
                </PanelContent>
                <PanelFooter className="justify-start gap-2">
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
                </PanelFooter>
              </Panel>
              {live && (
                <Panel>
                  <PanelHeader>
                    <PanelTitle>Roll back</PanelTitle>
                    <PanelDescription>
                      Return to an earlier revision that passed its tests.
                    </PanelDescription>
                  </PanelHeader>
                  <PanelContent className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1 basis-64">
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
                    </div>
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
                  </PanelContent>
                </Panel>
              )}
              {adapter.operations.length > 0 && (
                <Panel>
                  <PanelHeader>
                    <PanelTitle>Recent deployments</PanelTitle>
                  </PanelHeader>
                  <PanelContent>
                    <ul className="flex flex-col gap-2 text-body">
                      {adapter.operations.slice(0, 5).map((o) => (
                        <li key={o.uuid} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="capitalize">{o.action}</span>
                          <Status value={o.status} />
                          {o.diagnostic && (
                            <span className="text-muted-foreground">{o.diagnostic}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </PanelContent>
                </Panel>
              )}
            </div>
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
      {adapter && (
        <Confirm
          open={deleteOpen}
          title={`Delete ${adapter.name}?`}
          description={deletionDescription(adapter.source.type)}
          action="Delete adapter"
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            await api.deleteDeviceAdapter(org, adapter.uuid);
            toast.success(`Deleted ${adapter.name}`);
            // Unsaved edits belong to the deleted adapter, so leaving must not ask about them.
            setDirty(false);
            clearGlobalDirty(false);
            navigate(path(org), { replace: true });
            cache.removeQueries({ queryKey: ["adapter", org, adapter.uuid] });
            await cache.invalidateQueries({ queryKey: ["adapters", org] });
            await cache.invalidateQueries({ queryKey: ["onboarding-ai-conversations", org] });
          }}
        />
      )}
    </WorkspacePage>
  );
}

/** What is wrong with a live adapter's connections, in words; empty when nothing is. */
function connectionTrouble(adapter: DeviceAdapter) {
  const trouble: string[] = [];
  if (isMqtt(adapter.source)) {
    if (connectionStatus(adapter, "source_connected") === "not connected")
      trouble.push("Source not connected");
  } else {
    const state = statusOf(adapter.source_state?.state, "source");
    if (state.tone === "warning" || state.tone === "critical")
      trouble.push(`${sourceLabel(adapter.source.type)}: ${adapter.source_state?.label || state.label}`);
  }
  if (connectionStatus(adapter, "upstream_connected") === "not connected")
    trouble.push("Publisher not connected");
  return trouble;
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
    return `Your tenant MQTT broker. Topics: ${source.topics.join(", ")}`;
  if (source.type === "vendor")
    return `${source.url || "Vendor MQTT broker"}. Topics: ${source.topics.join(", ")}`;
  if (source.type === "webhook")
    return `HTTP webhook, ${authLabels[source.auth.mode].toLowerCase()}, at ${adapter.webhook?.ingest_url ?? "its ingest URL"}.`;
  if (source.type === "opcua") return "An OPC UA server.";
  const minutes = Math.round(source.interval_seconds / 60);
  return `Polls ${source.request.method} ${source.request.url} every ${minutes} min, up to ${source.page.max_pages} pages a run.`;
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
