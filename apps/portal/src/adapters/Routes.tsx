import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  AdapterDraft,
  AdapterProfile,
  DeviceAdapter,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table";
import { EmptyState } from "@iot-os/ui/components/empty-state";
import { Status } from "@iot-os/ui/components/status-mark";
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@iot-os/ui/components/toggle-group";
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
import { AdapterAssistant } from "./AdapterAssistant";
import { AdapterDevices, AdapterCredentials } from "./connections";

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
        mobile: "hidden",
        value: (a) => sourceLabel(a),
        cell: (a) => <span className="text-muted-foreground">{sourceLabel(a)}</span>,
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
      description="Decoders for manufacturer MQTT devices, run in your organization's private Node-RED runtime."
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
          { id: "source", label: "Source", value: sourceLabel },
          { id: "type", label: "Device type", value: (a) => a.profile_name },
        ]}
        refreshSeconds={5}
        empty={
          <EmptyState
            inset
            icon={<PlugIcon />}
            title="Connect your first manufacturer device"
            description="Choose a profile, provide a sample payload, and test how the decoder maps it to platform readings. Topics and MQTT credentials stay isolated to your organization."
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
const sourceLabel = (a: AdapterRow) =>
  a.source.type === "platform" ? "Tenant MQTT broker" : "Vendor MQTT broker";

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
  // The workspace assistant sends people here for the adapter's own assistant.
  const location = useLocation();
  useEffect(() => {
    if (adapter && (location.state as { tab?: string } | null)?.tab === "ai") setTab("ai");
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
  const [topicText, setTopicText] = useState(draft.source.topics.join("\n"));
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
      setTopicText(next.source.topics.join("\n"));
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
        source: {
          ...draft.source,
          topics: topicText
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean),
        },
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
  return (
    <WorkspacePage
      title={adapter ? adapter.name : "New device adapter"}
      back={{ to: path(org), label: "Device adapters" }}
      tools={
        <p className="text-body text-muted-foreground">
          One tested workflow per device type, with a stable platform device for each activated serial.
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
            <span>Source {connectionStatus(adapter, "source_connected")}</span>
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
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="type">1 · Device type</TabsTrigger>
          <TabsTrigger value="source">2 · Connection</TabsTrigger>
          <TabsTrigger value="decoder">3 · Decode & test</TabsTrigger>
          <TabsTrigger value="deploy" disabled={!adapter}>
            4 · Review & deploy
          </TabsTrigger>
          <TabsTrigger value="devices" disabled={!adapter}>
            5 · Devices
          </TabsTrigger>
          <TabsTrigger value="ai" disabled={!adapter}>
            AI assistant
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
            <Card>
              <CardHeader>
                <CardTitle>Where does the device publish?</CardTitle>
                <CardDescription>
                  Keep the manufacturer payload and topics. Select the broker
                  that receives them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel>MQTT source</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={draft.source.type}
                      onValueChange={(value) => {
                        if (value === "platform" || value === "vendor")
                          change({
                            source: { ...draft.source, type: value },
                            secrets: undefined,
                          });
                      }}
                      disabled={!canEdit}
                    >
                      <ToggleGroupItem value="platform">
                        Our tenant broker
                      </ToggleGroupItem>
                      <ToggleGroupItem value="vendor">
                        Vendor broker
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <FieldDescription>
                      {draft.source.type === "platform"
                        ? "Download a hardware connection kit after saving. Devices publish to your organization’s isolated broker."
                        : "The adapter subscribes to an internet-reachable broker using the manufacturer’s credentials."}
                    </FieldDescription>
                  </Field>
                  {draft.source.type === "vendor" && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="adapter-url">
                          Broker URL
                        </FieldLabel>
                        <Input
                          id="adapter-url"
                          value={draft.source.url ?? ""}
                          placeholder="mqtts://mqtt.vendor.example:8883"
                          disabled={!canEdit}
                          onChange={(e) =>
                            change({
                              source: { ...draft.source, url: e.target.value },
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="adapter-user">Username</FieldLabel>
                        <Input
                          id="adapter-user"
                          autoComplete="off"
                          value={draft.secrets?.username ?? ""}
                          disabled={!canEdit}
                          placeholder={
                            adapter?.credentials_configured
                              ? "Saved · enter to replace"
                              : "Vendor username"
                          }
                          onChange={(e) =>
                            change({
                              secrets: {
                                ...draft.secrets,
                                username: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="adapter-password">
                          Password
                        </FieldLabel>
                        <Input
                          id="adapter-password"
                          type="password"
                          autoComplete="new-password"
                          value={draft.secrets?.password ?? ""}
                          disabled={!canEdit}
                          placeholder={
                            adapter?.credentials_configured
                              ? "Saved · enter to replace"
                              : "Vendor password"
                          }
                          onChange={(e) =>
                            change({
                              secrets: {
                                ...draft.secrets,
                                password: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="adapter-ca" optional>
                          Custom CA certificate
                        </FieldLabel>
                        <Textarea
                          id="adapter-ca"
                          rows={3}
                          value={draft.secrets?.ca_certificate ?? ""}
                          disabled={!canEdit}
                          placeholder="PEM certificate. Leave blank to preserve the saved value."
                          onChange={(e) =>
                            change({
                              secrets: {
                                ...draft.secrets,
                                ca_certificate: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                    </>
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
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                <Button disabled={busy || !canEdit} onClick={() => void save()}>
                  Save connection
                </Button>
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
                <Button
                  variant="outline"
                  onClick={() => setTab("decoder")}
                  disabled={!draft.artifact_uuid}
                >
                  Continue to decoder
                </Button>
              </CardFooter>
            </Card>
            {adapter && draft.source.type === "platform" && (
              <AdapterCredentials
                org={org}
                adapter={adapter}
                disabled={dirty || !capabilities.connections}
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="decoder">
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
                  Input: payload, bytes, payloadBase64, topic, receivedAt,
                  retained and qos. Helpers: uint16BE and uint32BE. Use
                  synchronous code; network, files, modules and persistent state
                  are unavailable.
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
                A fixture contains topic and payload (or payload_base64), plus
                expected metrics or expect_error. Include at least one
                successful sample.
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
                  Source:{" "}
                  {adapter.source.type === "platform"
                    ? "Your tenant MQTT broker"
                    : adapter.source.url}
                  . Topics: {adapter.source.topics.join(", ")}
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
                {adapter.operations.map((o) => (
                  <p key={o.uuid} className="text-sm">
                    {o.action} · {o.status}
                    {o.diagnostic ? ` · ${o.diagnostic}` : ""}
                  </p>
                ))}
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                <Button
                  disabled={!tested || busy || pending || !canEdit}
                  onClick={() =>
                    void run(
                      () =>
                        api.deployDeviceAdapter(org, adapter.uuid, {
                          draft_revision: adapter.draft_revision,
                          action: "deploy",
                          request_uuid: crypto.randomUUID(),
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
        <TabsContent value="ai">
          {adapter && (
            <AdapterAssistant
              org={org}
              adapter={adapter}
              dirty={dirty}
              canEdit={canEdit}
              onApplied={adopt}
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

function connectionStatus(
  adapter: DeviceAdapter,
  field: "source_connected" | "upstream_connected",
) {
  const checked = Date.parse(adapter.health?.checked_at ?? "");
  if (!Number.isFinite(checked) || Date.now() - checked > 30000)
    return "unknown";
  return adapter.health?.[field] ? "connected" : "not connected";
}
