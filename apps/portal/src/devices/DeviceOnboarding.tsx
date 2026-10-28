import { RelativeTime } from "@iot-os/ui/components/freshness";
import { useEffect, useRef, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  DeviceDirectoryMeta,
  DeviceMapping,
  DeviceOnboarding as Setup,
  DeviceValidation,
  DiscoveryCandidate,
  OnboardingInput,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { PageHeader } from "@iot-os/ui/components/page-header";
import { ChoiceCard } from "@iot-os/ui/components/choice-card";
import { Field, FieldError, FieldGroup } from "@iot-os/ui/components/field";
import { Input } from "@iot-os/ui/components/input";
import { RadioGroup } from "@iot-os/ui/components/radio-group";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Stepper } from "@iot-os/ui/components/stepper";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@iot-os/ui/components/accordion";
import { StatusMark } from "@iot-os/ui/components/status-mark";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { Separator } from "@iot-os/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table";
import { Badge } from "@iot-os/ui/components/badge";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import { api } from "../lib/api";
import { usePanel } from "../panel/context";
import { RequestError, TextField } from "../components/forms";
import {
  DevicePages,
  discoveryPath,
  metricCount,
  useDeviceOrganization,
  devicePath,
} from "./shared";
import { ConnectionKit } from "./ConnectionKit";
import { OnboardSource, sourceLabel } from "./OnboardSource";

type Form = {
  name: string;
  /** direct and gateway start a guided setup; adapter and discovery hand off to their own flows. */
  mode: "direct" | "gateway" | "adapter" | "discovery";
  profile: string;
  gateway: string;
  source: string;
  requestUuid: string;
};
const emptyForm = (): Form => ({
  name: "",
  mode: "direct",
  profile: "",
  gateway: "",
  source: "",
  requestUuid: crypto.randomUUID(),
});
/** The wizard's four stops, named the way its own titles and buttons name them. */
const STEPS = [
  { label: "Device" },
  { label: "Connection details" },
  { label: "Check connection" },
  { label: "Activate" },
];
/** First-step fields reported as missing once Continue is pressed. */
type StepErrors = Partial<
  Record<"profile" | "name" | "gateway" | "source", string>
>;
const valueText = (v: unknown) =>
  v == null
    ? "No value yet"
    : typeof v === "number"
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(v)
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
export const onboardingPath = (org: string, id?: string) =>
  `${devicePath(org)}/onboard${id ? "/" + encodeURIComponent(id) : ""}`;
/** Profile directory with a way back to this wizard's first step, which keeps its form in session storage. */
export const profileSetupPath = (org: string) =>
  `/organizations/${encodeURIComponent(org)}/device-profiles?returnTo=${encodeURIComponent(onboardingPath(org))}`;

export function DeviceOnboarding() {
  const { organizationUuid, deviceUuid } = useParams();
  return <DeviceOnboardingForm key={`${organizationUuid}:${deviceUuid ?? "new"}`} />;
}

function DeviceOnboardingForm() {
  const { startTask } = usePanel();
  // The onboarding assistant opens in the workspace panel, beside this form.
  const askAssistant = () => startTask("onboarding", { to: "onboarding", fresh: true });
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const adaptersEnabled =
    organization.data?.capabilities?.features?.device_adapters === true;
  const { deviceUuid } = useParams(),
    navigate = useNavigate(),
    cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const storageKey = `device-onboarding-form.v1:${org}`;
  const [form, setForm] = useState<Form>(() => {
    try {
      return {
        ...emptyForm(),
        ...JSON.parse(sessionStorage.getItem(storageKey) ?? "{}"),
        ...(params.get("profile") ? { profile: params.get("profile")! } : {}),
        // The onboarding assistant links here with the path it recommended.
        ...(["direct", "gateway", "adapter", "discovery"].includes(params.get("mode") ?? "") ? { mode: params.get("mode") as Form["mode"] } : {}),
      };
    } catch {
      return emptyForm();
    }
  });
  const [profileSearch, setProfileSearch] = useState(""),
    [profilePage, setProfilePage] = useState(1);
  const [gatewaySearch, setGatewaySearch] = useState(""),
    [gatewayPage, setGatewayPage] = useState(1);
  const [sourceSearch, setSourceSearch] = useState(""),
    [sourcePage, setSourcePage] = useState(1),
    [source, setSource] = useState<DiscoveryCandidate | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [errors, setErrors] = useState<StepErrors>({});
  const lock = useRef(false);
  // A remembered adapter choice falls back once the organization turns out not to have adapters.
  const mode =
    form.mode === "adapter" && organization.data && !adaptersEnabled
      ? "direct"
      : form.mode;
  const setupQuery = useQuery({
    queryKey: ["device-onboarding", org, deviceUuid],
    queryFn: () => api.deviceOnboarding(org, deviceUuid!),
    enabled: !!deviceUuid,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });
  const setup = setupQuery.data;
  const profiles = useQuery({
    queryKey: ["onboarding-profiles", org, profileSearch, profilePage],
    queryFn: () =>
      api.deviceProfiles(org, {
        search: profileSearch,
        page: profilePage,
        perPage: 25,
      }),
    enabled: !deviceUuid,
    // Profiles are often published in another tab or just before returning here.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const profile = useQuery({
    queryKey: ["onboarding-profile", org, form.profile],
    queryFn: () => api.deviceProfile(org, form.profile),
    enabled: !deviceUuid && !!form.profile,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const artifact = useQuery({
    queryKey: [
      "onboarding-artifact",
      org,
      form.profile,
      profile.data?.revision,
    ],
    queryFn: () =>
      api.profileArtifact(org, form.profile, profile.data!.revision),
    enabled: !deviceUuid && !!profile.data?.revision,
  });
  const gateways = useQuery({
    queryKey: ["onboarding-gateways", org, gatewaySearch, gatewayPage],
    queryFn: () =>
      api.gatewaysPage(org, {
        search: gatewaySearch,
        page: gatewayPage,
        per_page: 25,
      }),
    enabled: !deviceUuid && mode === "gateway",
  });
  const sources = useQuery({
    queryKey: ["onboarding-sources", org, sourceSearch, sourcePage],
    queryFn: () =>
      api.discoveryPage(org, {
        available: 1,
        search: sourceSearch,
        page: sourcePage,
        per_page: 10,
      }),
    enabled: !deviceUuid,
    refetchInterval: mode === "discovery" ? 5000 : false,
    refetchIntervalInBackground: false,
  });
  const waiting = sourceSearch ? undefined : sources.data?.meta.total;
  const step = !deviceUuid
    ? 1
    : Math.min(4, Math.max(2, Number(params.get("step") || 2) || 2));
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<DeviceValidation | null>(null);
  const candidate = setup?.candidate;
  const online =
    candidate?.presence === "online" && setup?.gateway.presence === "online";
  const parameters =
    setup?.artifact.definition.parameters.filter(
      (p) => p.reports_state && p.kind !== "derived",
    ) ?? [];
  const applied =
    setup?.device.lifecycle === "active" &&
    setup.device.deployment_status === "applied";
  const pending = setup?.device.deployment_status === "pending";
  const configuredAt = setup?.device.configurations.find(
    (c) => c.uuid === setup.device.applied_configuration_uuid,
  )?.created_at;
  const stored = useQuery({
    queryKey: [
      "onboarding-stored",
      org,
      deviceUuid,
      setup?.device.applied_configuration_uuid,
    ],
    enabled: !!applied && !!configuredAt && parameters.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        parameters.map((p) =>
          api.deviceHistoryRecords(org, deviceUuid!, {
            parameter_uuid: p.uuid,
            from: configuredAt!,
            to: new Date().toISOString(),
            limit: 10,
            page_size: 10,
          }),
        ),
      );
      return results.map((r, i) => ({
        parameter: parameters[i],
        reading: r.data.find(
          (row) =>
            row.configuration_uuid ===
              setup!.device.applied_configuration_uuid &&
            row.quality === "good",
        ),
      }));
    },
    refetchInterval: (q) =>
      q.state.data?.every((row) => row.reading) ? false : 2000,
    refetchIntervalInBackground: false,
  });
  const complete =
    !!applied &&
    !!stored.data?.length &&
    stored.data.every((row) => row.reading);
  useEffect(() => {
    if (!deviceUuid) sessionStorage.setItem(storageKey, JSON.stringify(form));
  }, [form, deviceUuid, storageKey]);
  function update(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch, requestUuid: crypto.randomUUID() }));
    // A field's error clears as soon as it is edited; a new mode starts clean.
    setErrors((current) => {
      if (patch.mode) return {};
      const next = { ...current };
      for (const key of Object.keys(patch) as Array<keyof StepErrors>)
        delete next[key];
      return next;
    });
  }
  /** Names each missing first-step field under the field itself; true when Continue may proceed. */
  function validate() {
    const missing: StepErrors = {};
    if (!form.profile) missing.profile = "Choose a device profile.";
    else if (profile.data && !profile.data.revision)
      missing.profile = "This profile has no published version yet.";
    if (!form.name.trim()) missing.name = "Enter a name for this device.";
    if (mode === "gateway") {
      if (!form.gateway)
        missing.gateway = "Choose the gateway this device connects through.";
      if (!form.source.trim())
        missing.source = "Enter the device ID used on the gateway.";
    }
    setErrors(missing);
    return Object.keys(missing).length === 0;
  }
  function go(next: number) {
    setError(null);
    setParams({ step: String(next) });
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function start(exit = false) {
    await run(async () => {
      if (!artifact.data)
        throw new Error("Choose a published profile before continuing.");
      if (mode !== "direct" && mode !== "gateway") return;
      const input: OnboardingInput = {
        request_uuid: form.requestUuid,
        name: form.name.trim(),
        artifact_uuid: artifact.data.uuid,
        mode,
        ...(mode === "gateway"
          ? { gateway_uuid: form.gateway, source_device_id: form.source.trim() }
          : {}),
      };
      const created = await api.startDeviceOnboarding(org, input);
      sessionStorage.removeItem(storageKey);
      cache.setQueryData(
        ["device-onboarding", org, created.device.uuid],
        created,
      );
      await cache.invalidateQueries({ queryKey: ["devices", org] });
      navigate(
        exit
          ? devicePath(org, created.device.uuid) + "/connectivity"
          : onboardingPath(org, created.device.uuid) + "?step=2",
      );
    });
  }
  function metricFor(uuid: string, key: string, label: string) {
    return (
      mappings[uuid] ??
      setup?.device.draft?.mappings.find((m) => m.parameter_uuid === uuid)
        ?.metric ??
      candidate?.metrics.find((m) => m.name === key || m.name === label)
        ?.name ??
      ""
    );
  }
  async function review() {
    if (!setup || !candidate) return;
    await run(async () => {
      const next: DeviceMapping[] = parameters.map((p) => ({
        parameter_uuid: p.uuid,
        metric: metricFor(p.uuid, p.key, p.label),
        command_metric:
          setup.device.draft?.mappings.find((m) => m.parameter_uuid === p.uuid)
            ?.command_metric ?? null,
        conversion_mode: "profile",
      }));
      const device = await api.saveDeviceConfiguration(org, setup.device.uuid, {
        draft_revision: setup.device.draft_revision,
        artifact_uuid: setup.artifact.uuid,
        candidate_uuid: candidate.uuid,
        birth_revision: candidate.birth_revision,
        mappings: next,
      });
      await setupQuery.refetch();
      setValidation(
        await api.validateDevice(org, device.uuid, device.draft_revision),
      );
      go(4);
    });
  }
  const validationCurrent =
    !!validation &&
    validation.draft_revision === setup?.device.draft_revision &&
    validation.definition.birth_revision === candidate?.birth_revision;
  async function activate() {
    if (!setup || !validationCurrent) return;
    await run(async () => {
      try {
        await api.deviceAction(
          org,
          setup.device.uuid,
          "activate",
          validation!.draft_revision,
        );
      } finally {
        await setupQuery.refetch();
      }
      setValidation(null);
      void cache.invalidateQueries({ queryKey: ["devices", org] });
    });
  }
  if (deviceUuid && setupQuery.isPending)
    return (
      <div className="p-6">
        <Skeleton className="h-80 w-full" />
      </div>
    );
  if (deviceUuid && !setup)
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <RequestError error={setupQuery.error} />
        <p>This device does not have an onboarding setup.</p>
        <Button asChild variant="outline">
          <Link to={devicePath(org, deviceUuid) + "/configuration"}>
            Open device configuration
          </Link>
        </Button>
      </div>
    );
  const titles = [
    "",
    "How does this device send data?",
    setup?.mode === "gateway"
      ? "Connect through your gateway"
      : "Add these settings to your device",
    online
      ? `${setup?.device.name ?? "Your device"} is connected`
      : `We’re listening for ${setup?.device.name ?? "your device"}`,
    complete
      ? `${setup?.device.name} is ready`
      : applied
        ? "Waiting for the first stored readings"
        : pending
          ? "Applying your device configuration"
          : "Your device is connected. Ready to start collecting?",
  ];
  const help =
    step === 1
      ? [
          "Not sure which to choose?",
          `Choose Sparkplug B if your hardware has its own Sparkplug B publisher. A gateway connects one or more devices on their behalf.${adaptersEnabled ? " Hardware that sends its manufacturer’s own MQTT or JSON messages needs an adapter to translate them." : ""} If the device is already reporting through a gateway, pick it from the sources waiting to be added.`,
        ]
      : step === 2
        ? [
            "Why these settings?",
            "MQTT carries your Sparkplug B messages. The CA certificate verifies the broker; the username and password identify this connection.",
          ]
        : step === 3
          ? online ? [
              "Match your measurements",
              "Choose the device metric for each profile measurement. Check its type and unit before continuing. These samples are previews; collection begins after activation.",
            ] : [
              "Still no connection?",
              "Check power, network access, broker settings, and the CA certificate. The device must publish a Sparkplug birth message before its measurements can be reviewed.",
            ]
          : [
              "What happens next?",
              "Activation applies the reviewed configuration. Setup is complete when the runtime confirms it and readings are present in measurement history.",
            ];
  return (
    <>
      <PageHeader
        title={setup?.device.name ?? "Add device"}
        back={{ to: devicePath(org), label: "Devices" }}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (deviceUuid)
                navigate(devicePath(org, deviceUuid) + "/connectivity");
              else navigate(devicePath(org));
            }}
          >
            Save and exit
          </Button>
        }
      >
        <Stepper steps={STEPS} current={step} />
      </PageHeader>
      <div className="mx-auto grid w-full max-w-6xl lg:grid-cols-[minmax(0,1fr)_260px]">
        <section
          className="flex min-w-0 flex-col gap-7 p-5 md:p-8 lg:p-10"
          aria-labelledby="onboarding-title"
        >
          <div className="flex flex-col gap-2">
            <h1
              id="onboarding-title"
              className="text-2xl font-semibold tracking-tight"
            >
              {titles[step]}
            </h1>
            <p className="text-sm text-muted-foreground">
              {step === 1
                ? "Choose how your hardware reports its measurements. We’ll guide you through the rest."
                : step === 2
                  ? "Follow these steps, then return to check the connection."
                  : step === 3
                    ? online
                      ? "Review the measurements announced by your device before activation."
                      : "Once your device publishes its description, its measurements will appear here."
                    : "Your setup is saved. Connection settings stay available under Connectivity."}
            </p>
          </div>
          <RequestError error={error ?? setupQuery.error} />
          {step === 1 && (
            <>
              {!capabilities.manage && (
                <Alert>
                  <AlertTitle>Device management access required</AlertTitle>
                  <AlertDescription>
                    Ask an administrator to enable device management for your
                    account.
                  </AlertDescription>
                </Alert>
              )}
              <RadioGroup
                value={mode}
                onValueChange={(v) => v && update({ mode: v as Form["mode"] })}
                className="flex w-full flex-col gap-3"
                aria-label="How the device sends data"
              >
                <ChoiceCard
                  type="radio"
                  value="direct"
                  checked={mode === "direct"}
                  disabled={!capabilities.connections}
                  title="It speaks Sparkplug B"
                  description="Your hardware publishes Sparkplug B over MQTT directly to IoT OS."
                />
                <ChoiceCard
                  type="radio"
                  value="gateway"
                  checked={mode === "gateway"}
                  title="Through a gateway"
                  description="A registered gateway connects this device along with others."
                />
                {adaptersEnabled && (
                  <ChoiceCard
                    type="radio"
                    value="adapter"
                    checked={mode === "adapter"}
                    title="Manufacturer data (MQTT, webhook or vendor API)"
                    description="Your hardware or its vendor cloud sends the manufacturer’s own messages: over MQTT, as webhooks, or from a vendor API the platform polls. A device adapter translates them."
                  />
                )}
                <ChoiceCard
                  type="radio"
                  value="discovery"
                  checked={mode === "discovery"}
                  title="It’s already sending data"
                  badge={
                    waiting ? (
                      <Badge variant="info">{waiting} waiting</Badge>
                    ) : undefined
                  }
                  description="Pick a source that reports through a gateway but isn’t a device yet."
                />
              </RadioGroup>
              {adaptersEnabled && capabilities.manage && (
                <p className="text-sm text-muted-foreground">
                  Not sure how your device connects?{" "}
                  <Button variant="link" className="h-auto p-0 align-baseline" onClick={askAssistant}>
                    Ask the onboarding assistant
                  </Button>
                  . It asks a few questions and walks you through the setup.
                </p>
              )}
              {!capabilities.connections && (
                <p className="text-sm text-muted-foreground">
                  Sparkplug B devices that connect directly need
                  connection-management access. You can select an existing
                  gateway.
                </p>
              )}
              <Separator />
              {mode === "adapter" && (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-muted-foreground">
                    An adapter decodes one device type’s messages into profile
                    measurements, whether they arrive over MQTT, by webhook from
                    the vendor’s cloud or from the vendor’s API. Choose an
                    existing adapter to add another device of that type, or
                    create one for a new device type.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <Link to={`/organizations/${encodeURIComponent(org)}/device-adapters`}>
                        Continue to device adapters
                      </Link>
                    </Button>
                    <Button variant="outline" onClick={askAssistant}>
                      Ask the onboarding assistant
                    </Button>
                  </div>
                </div>
              )}
              {mode === "discovery" && (
                <WaitingSources
                  org={org}
                  sources={sources}
                  search={sourceSearch}
                  onSearch={(v) => {
                    setSourceSearch(v);
                    setSourcePage(1);
                  }}
                  onPage={setSourcePage}
                  canManage={capabilities.manage}
                  onSelect={setSource}
                />
              )}
              {source && (
                <OnboardSource
                  key={source.uuid}
                  org={org}
                  source={source}
                  onClose={() => setSource(null)}
                />
              )}
              {(mode === "direct" || mode === "gateway") && (
              <>
              <FieldGroup>
                <Field data-invalid={!!errors.profile}>
                  <SearchableSelect
                    label="Device profile"
                    value={form.profile}
                    selectedLabel={profile.data?.name}
                    options={(profiles.data?.data ?? [])
                      .filter((p) => p.revision > 0)
                      .map((p) => ({ value: p.uuid, label: p.name }))}
                    search={profileSearch}
                    onSearchChange={(v) => {
                      setProfileSearch(v);
                      setProfilePage(1);
                    }}
                    onChange={(v) => update({ profile: v })}
                    loading={profiles.isFetching}
                    page={profilePage}
                    hasNextPage={
                      !!profiles.data &&
                      profiles.data.meta.current_page <
                        profiles.data.meta.last_page
                    }
                    onPageChange={setProfilePage}
                    help={
                      artifact.data
                        ? `Version ${artifact.data.revision} is live. A profile defines measurements and their units.`
                        : "Choose a published profile. Draft profiles cannot be used yet."
                    }
                    emptyText="No published profiles found."
                  />
                  {errors.profile && <FieldError>{errors.profile}</FieldError>}
                </Field>
                <Link
                  to={profileSetupPath(org)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Create or publish a profile
                </Link>
                <RequestError
                  error={profiles.error ?? profile.error ?? artifact.error}
                />
                <TextField
                  id="onboarding-name"
                  label="Device name"
                  value={form.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="For example, Workshop water meter"
                  maxLength={255}
                  help="A recognizable name for this individual device."
                  error={errors.name}
                />
                {mode === "gateway" && (
                  <>
                    <Field data-invalid={!!errors.gateway}>
                      <SearchableSelect
                        label="Gateway"
                        value={form.gateway}
                        options={(gateways.data?.data ?? []).map((g) => ({
                          value: g.uuid,
                          label: g.name,
                        }))}
                        search={gatewaySearch}
                        onSearchChange={(v) => {
                          setGatewaySearch(v);
                          setGatewayPage(1);
                        }}
                        onChange={(v) => update({ gateway: v })}
                        loading={gateways.isFetching}
                        page={gatewayPage}
                        hasNextPage={
                          !!gateways.data &&
                          gateways.data.meta.current_page <
                            gateways.data.meta.last_page
                        }
                        onPageChange={setGatewayPage}
                      />
                      {errors.gateway && (
                        <FieldError>{errors.gateway}</FieldError>
                      )}
                    </Field>
                    <RequestError error={gateways.error} />
                    <TextField
                      id="source-id"
                      label="Device ID on gateway"
                      value={form.source}
                      onChange={(e) => update({ source: e.target.value })}
                      placeholder="water-meter"
                      help="Must match the Device ID in your gateway’s Sparkplug messages."
                      error={errors.source}
                    />
                  </>
                )}
              </FieldGroup>
              <div className="flex justify-end">
                <Button
                  disabled={
                    busy ||
                    !capabilities.manage ||
                    (mode === "direct" && !capabilities.connections)
                  }
                  onClick={() => {
                    if (validate()) void start();
                  }}
                >
                  {busy ? "Saving setup…" : "Continue"}
                </Button>
              </div>
              </>
              )}
            </>
          )}
          {step === 2 && setup && (
            <>
              <ConnectionKit
                key={setup.device.uuid}
                org={org}
                setup={setup}
                canDownload={capabilities.connections}
                onProvisioned={() => void setupQuery.refetch()}
              />
              <Separator />
              <div className="flex justify-end">
                <Button onClick={() => go(3)}>Next: Check connection</Button>
              </div>
            </>
          )}
          {step === 3 && setup && (
            <>
              <div className="flex items-start gap-3" role="status">
                {online ? (
                  <CheckCircle2Icon className="mt-0.5 size-6 text-success" />
                ) : (
                  <CircleIcon className="mt-0.5 size-6 text-muted-foreground" />
                )}
                <div className="flex flex-col gap-1">
                  <strong>
                    {online
                      ? "Connection and device description received"
                      : candidate
                        ? "Device seen before — waiting for it to reconnect"
                        : "No device description received yet"}
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    {online
                      ? "Match each profile measurement to a metric from your device."
                      : "Start your Sparkplug publisher using the settings in the connection kit."}
                  </p>
                </div>
              </div>
              {candidate && (
                <>
                  <MappingTable
                    setup={setup}
                    onChange={(id, metric) => {
                      setMappings((m) => ({ ...m, [id]: metric }));
                      setValidation(null);
                    }}
                    metricFor={metricFor}
                  />
                  <p className="text-xs text-muted-foreground">
                    These are discovery samples. No readings are stored until
                    activation.
                  </p>
                </>
              )}
              {!online && (
                <Accordion type="multiple">
                  <AccordionItem value="power">
                    <AccordionTrigger>
                      Device powered on and publishing?
                    </AccordionTrigger>
                    <AccordionContent>
                      Check your publisher logs. It must send a Sparkplug B
                      birth message, not plain MQTT JSON.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="network">
                    <AccordionTrigger>
                      Broker address and port copied?
                    </AccordionTrigger>
                    <AccordionContent>
                      <p className="break-all">
                        Use {setup.broker_url}. The hostname must be reachable
                        from your hardware and match the broker certificate.
                        localhost refers to the machine running your publisher.
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="ca">
                    <AccordionTrigger>
                      CA certificate installed?
                    </AccordionTrigger>
                    <AccordionContent>
                      Extract ca.crt from your connection kit and point your
                      publisher at it. Keep certificate and hostname
                      verification enabled.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
              <Alert>
                <AlertTitle>Your setup is saved</AlertTitle>
                <AlertDescription>
                  You can leave this page and resume from the device’s
                  Connectivity tab.
                </AlertDescription>
              </Alert>
              <div className="flex flex-wrap justify-between gap-3">
                <Button variant="outline" onClick={() => go(2)}>
                  View connection details
                </Button>
                {online ? (
                  <Button
                    disabled={
                      busy ||
                      !capabilities.manage ||
                      parameters.some(
                        (p) => !metricFor(p.uuid, p.key, p.label),
                      ) ||
                      candidate?.status === "rejected" ||
                      (!!candidate?.assigned_device_uuid &&
                        candidate.assigned_device_uuid !== setup.device.uuid)
                    }
                    onClick={() => void review()}
                  >
                    {busy ? "Checking measurements…" : "Review measurements"}
                  </Button>
                ) : (
                  <Button
                    disabled={setupQuery.isFetching}
                    onClick={() => void setupQuery.refetch()}
                  >
                    Check again
                  </Button>
                )}
              </div>
              {candidate?.assigned_device_uuid &&
                candidate.assigned_device_uuid !== setup.device.uuid && (
                  <Alert>
                    <AlertTitle>Source already in use</AlertTitle>
                    <AlertDescription>
                      This source belongs to another device. Use a different
                      Device ID or manage the existing device.
                    </AlertDescription>
                  </Alert>
                )}
              {candidate?.status === "rejected" && (
                <Alert>
                  <AlertTitle>Source rejected</AlertTitle>
                  <AlertDescription>
                    Restore this source in Discovery before continuing.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
          {step === 4 && setup && (
            <>
              <div className="flex flex-col gap-3" aria-live="polite">
                <StatusMark tone={online ? "good" : "muted"}>
                  {online
                    ? "Connection established"
                    : "Connection not currently confirmed"}
                </StatusMark>
                <StatusMark tone={candidate ? "good" : "muted"}>
                  Device description {candidate ? "received" : "pending"}
                </StatusMark>
                <StatusMark
                  tone={applied ? "good" : pending ? "info" : "muted"}
                >
                  Configuration{" "}
                  {applied
                    ? "applied"
                    : pending
                      ? "applying…"
                      : "awaiting activation"}
                </StatusMark>
                {applied && (
                  <StatusMark tone={complete ? "good" : "info"}>
                    {complete
                      ? "First readings stored"
                      : "Waiting for stored readings"}
                  </StatusMark>
                )}
              </div>
              {setup.device.diagnostic && (
                <Alert>
                  <AlertTitle>Activation needs attention</AlertTitle>
                  <AlertDescription>{setup.device.diagnostic}</AlertDescription>
                </Alert>
              )}
              <RequestError error={stored.error} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Measurement</TableHead>
                    <TableHead>
                      {applied ? "Stored reading" : "Preview value"}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parameters.map((p) => (
                    <TableRow key={p.uuid}>
                      <TableCell>{p.label}</TableCell>
                      <TableCell>
                        {valueText(
                          applied
                            ? stored.data?.find(
                                (r) => r.parameter.uuid === p.uuid,
                              )?.reading?.value
                            : validation?.preview.readings.find(
                                (r) => r.parameter_uuid === p.uuid,
                              )?.value,
                        )}{" "}
                        {p.unit ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!applied && (
                <p className="text-sm text-muted-foreground">
                  Preview only — readings will be stored after activation.
                </p>
              )}
              {!validationCurrent && !applied && !pending && (
                <Alert>
                  <AlertTitle>Review the current measurements</AlertTitle>
                  <AlertDescription>
                    A fresh validation is required after reloading this page or
                    after the device changes.
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap gap-3">
                {complete ? (
                  <>
                    <Button asChild>
                      <Link to={devicePath(org, setup.device.uuid)}>
                        Open device
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link to={onboardingPath(org)}>
                        Connect another device
                      </Link>
                    </Button>
                  </>
                ) : !applied && !pending ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => go(3)}
                    >
                      Back to measurements
                    </Button>
                    <Button
                      disabled={
                        busy ||
                        !capabilities.activate ||
                        !validationCurrent ||
                        !validation?.preview.valid ||
                        !online
                      }
                      onClick={() => void activate()}
                    >
                      {busy ? "Requesting activation…" : "Activate device"}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      void setupQuery.refetch();
                      void stored.refetch();
                    }}
                  >
                    Check progress
                  </Button>
                )}
              </div>
              {!capabilities.activate && !applied && (
                <p className="text-sm">
                  An administrator with activation permission must activate this
                  device.
                </p>
              )}
              <Link
                to={devicePath(org, setup.device.uuid) + "/connectivity"}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Open connection settings
              </Link>
            </>
          )}
        </section>
        <aside className="flex flex-col gap-4 border-t bg-muted/20 p-5 md:p-8 lg:border-l lg:border-t-0">
          <div className="flex flex-col gap-1">
            <h2 className="skin-label text-sm font-semibold">{help[0]}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {help[1]}
            </p>
          </div>
          {setup && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground">
                {setup.artifact.definition.profile.name} · version{" "}
                {setup.artifact.revision}
              </p>
              <p className="text-xs text-muted-foreground">
                {setup.mode === "direct"
                  ? "Direct connection"
                  : `Via ${setup.gateway.name}`}
              </p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

/** Discovered sources no device has claimed; adding one hands off to Discovery's onboard action. */
function WaitingSources({
  org,
  sources,
  search,
  onSearch,
  onPage,
  canManage,
  onSelect,
}: {
  org: string;
  sources: UseQueryResult<{
    data: DiscoveryCandidate[];
    meta: DeviceDirectoryMeta;
  }>;
  search: string;
  onSearch: (value: string) => void;
  onPage: (page: number) => void;
  canManage: boolean;
  onSelect: (source: DiscoveryCandidate) => void;
}) {
  return (
    <section aria-labelledby="waiting-sources" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="waiting-sources" className="skin-label text-sm font-semibold">
          Sources waiting to be added
        </h2>
        <Input
          aria-label="Search waiting sources"
          placeholder="Search source or gateway"
          className="h-8 w-full sm:w-64"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <RequestError error={sources.error} />
      {sources.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : sources.data?.data.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Gateway</TableHead>
              <TableHead>Measurements</TableHead>
              <TableHead className="text-right">Last seen</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.data.data.map((c) => (
              <TableRow key={c.uuid}>
                <TableCell className={c.source_device_id ? "font-mono" : undefined}>
                  {sourceLabel(c)}
                </TableCell>
                <TableCell>{c.gateway.name}</TableCell>
                <TableCell className="tabular-nums">
                  {metricCount(c.metrics.length)}
                </TableCell>
                <TableCell className="text-right">
                  <RelativeTime at={c.last_seen_at} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="xs"
                    disabled={!canManage}
                    aria-label={`Add ${sourceLabel(c)} as a device`}
                    onClick={() => onSelect(c)}
                  >
                    Add as device
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          {search
            ? "No waiting sources match."
            : "No sources are waiting. A source appears here when a connected gateway reports a device that isn’t set up yet."}
        </p>
      )}
      <DevicePages meta={sources.data?.meta} onPage={onPage} label="Waiting sources" />
      <Link
        to={discoveryPath(org)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Review all sources in Discovery
      </Link>
    </section>
  );
}

function MappingTable({
  setup,
  onChange,
  metricFor,
}: {
  setup: Setup;
  onChange: (id: string, value: string) => void;
  metricFor: (id: string, key: string, label: string) => string;
}) {
  return (
    <div className="flex flex-col gap-5">
      {setup.artifact.definition.parameters
        .filter((p) => p.reports_state && p.kind !== "derived")
        .map((p) => (
          <MetricPicker
            key={p.uuid}
            label={p.label}
            unit={p.unit}
            value={metricFor(p.uuid, p.key, p.label)}
            metrics={setup.candidate?.metrics ?? []}
            onChange={(v) => onChange(p.uuid, v)}
          />
        ))}
    </div>
  );
}
function MetricPicker({
  label,
  unit,
  value,
  metrics,
  onChange,
}: {
  label: string;
  unit: string | null;
  value: string;
  metrics: NonNullable<Setup["candidate"]>["metrics"];
  onChange: (v: string) => void;
}) {
  const [search, setSearch] = useState("");
  const metric = metrics.find((m) => m.name === value);
  return (
    <SearchableSelect
      label={label}
      value={value}
      search={search}
      onSearchChange={setSearch}
      onChange={onChange}
      options={metrics
        .filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
        .map((m) => ({ value: m.name, label: `${m.name} · ${m.datatype}` }))}
      help={`Latest sample: ${valueText(metric?.value)}${unit ? ` · Profile unit: ${unit}` : ""}`}
      placeholder="Choose incoming measurement"
    />
  );
}

export function DeviceConnectivity({
  org,
  deviceUuid,
}: {
  org: string;
  deviceUuid: string;
}) {
  const { capabilities } = useDeviceOrganization();
  const query = useQuery({
    queryKey: ["device-onboarding", org, deviceUuid],
    queryFn: () => api.deviceOnboarding(org, deviceUuid),
  });
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <RequestError error={query.error} />
      {query.data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="skin-label text-sm font-semibold">
              Connection settings
            </h2>
            {query.data.device.lifecycle === "registered" && (
              <Button asChild>
                <Link to={onboardingPath(org, deviceUuid) + "?step=3"}>
                  Resume setup
                </Link>
              </Button>
            )}
          </div>
          <ConnectionKit
            org={org}
            setup={query.data}
            canDownload={
              capabilities.connections &&
              query.data.device.lifecycle !== "archived"
            }
            onProvisioned={() => void query.refetch()}
          />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="skin-label text-sm font-semibold">
              Gateway connection
            </h2>
            <p className="text-sm text-muted-foreground">
              This device was configured through Discovery. Its gateway manages
              MQTT access.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to={`/organizations/${org}/gateways`}>Open gateways</Link>
          </Button>
        </>
      )}
    </div>
  );
}
