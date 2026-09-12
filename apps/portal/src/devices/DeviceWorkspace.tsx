import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import type { DeviceDetail, DeviceInput } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@iot-os/ui/components/card"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { RequestError, TextField, SaveBar, Confirm } from "../components/forms"
import {
  DeviceStatus,
  devicePath,
  formatTime,
  useDeviceOrganization,
} from "./shared"
import { DeviceLifecycleAction } from "./DeviceLifecycleAction"
import { lifecycleStorageKey, newerDevice, reconcileDevice } from "./lifecycle"
import { ConfigurationSection } from "./ConfigurationSection"
import { MeasurementsSection } from "./MeasurementsSection"
import { CommandsSection } from "./CommandsSection"

const HistorySection = lazy(() => import("./HistorySection"))
const sections = [
  "overview",
  "measurements",
  "history",
  "configuration",
  "commands",
] as const
export type DeviceOperation = <T>(operation: () => Promise<T>) => Promise<T>
export function DeviceWorkspace() {
  const { org, capabilities } = useDeviceOrganization(),
    { deviceUuid = "", section = "overview" } = useParams(),
    navigate = useNavigate()
  const cache = useQueryClient(),
    lock = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [unconfirmed, setUnconfirmed] = useState(() =>
      Boolean(sessionStorage.getItem(lifecycleStorageKey(org, deviceUuid))),
    )
  const key = ["device", org, deviceUuid]
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const incoming = await api.device(org, deviceUuid)
      return newerDevice(cache.getQueryData<DeviceDetail>(key), incoming)
    },
    refetchInterval: (query) =>
      unconfirmed || query.state.data?.deployment_status === "pending"
        ? 1000
        : 5000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchIntervalInBackground: false,
  })
  const pendingRequest = (() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(lifecycleStorageKey(org, deviceUuid)) ?? "null",
      ) as { operation_uuid: string } | null
    } catch {
      return null
    }
  })()
  const recovery = useQuery({
    queryKey: [
      "device-operation",
      org,
      deviceUuid,
      pendingRequest?.operation_uuid,
    ],
    enabled: Boolean(pendingRequest),
    queryFn: () =>
      api.deviceOperation(org, deviceUuid, pendingRequest!.operation_uuid),
    retry: false,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  })
  useEffect(() => {
    if (!recovery.data) return
    reconcileDevice(cache, org, recovery.data.data)
    if (recovery.data.operation.status !== "pending") {
      sessionStorage.removeItem(lifecycleStorageKey(org, deviceUuid))
      setUnconfirmed(false)
    }
  }, [recovery.data, cache, org, deviceUuid])
  const lastState = useRef("")
  useEffect(() => {
    if (!query.data) return
    const stamp =
      query.data.deployment_generation + ":" + query.data.state_revision
    if (stamp !== lastState.current) {
      lastState.current = stamp
      reconcileDevice(cache, org, query.data)
    }
  }, [query.data, cache, org])
  const run: DeviceOperation = useCallback(
    async (operation) => {
      if (lock.current || unconfirmed)
        throw new Error("Wait for the current request to be confirmed.")
      lock.current = true
      setBusy(true)
      setError(null)
      await cache.cancelQueries({ queryKey: ["device", org, deviceUuid] })
      try {
        const result = await operation()
        if (
          result &&
          typeof result === "object" &&
          "draft_revision" in result &&
          "uuid" in result
        ) {
          reconcileDevice(cache, org, result as unknown as DeviceDetail)
        }
        void cache.invalidateQueries({ queryKey: ["device", org, deviceUuid] })
        return result
      } catch (reason) {
        setError(reason)
        throw reason
      } finally {
        lock.current = false
        setBusy(false)
      }
    },
    [org, deviceUuid, cache, unconfirmed],
  )
  if (query.isPending) return <Skeleton className="h-80 w-full" />
  if (!query.data) return <RequestError error={query.error} />
  const device = query.data,
    activeSection = sections.includes(section as (typeof sections)[number])
      ? section
      : "overview"
  return (
    <div className="flex flex-col gap-6">
      <Link
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        to={devicePath(org)}
      >
        Devices / {device.code}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{device.name}</h1>
          <p className="text-muted-foreground">
            {device.description || "Device workspace"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DeviceStatus value={device.lifecycle} />
          {device.lifecycle !== "deactivated" && (
            <DeviceStatus value={device.presence} />
          )}
          {device.lifecycle !== "deactivated" ||
          device.deployment_status === "pending" ? (
            <DeviceStatus value={device.deployment_status} />
          ) : null}
        </div>
      </div>
      <RequestError error={error ?? query.error} />
      {device.diagnostic && (
        <Alert>
          <AlertTitle>Device needs attention</AlertTitle>
          <AlertDescription>{device.diagnostic}</AlertDescription>
        </Alert>
      )}
      <Tabs
        value={activeSection}
        onValueChange={(value) =>
          navigate(devicePath(org, deviceUuid) + "/" + value)
        }
      >
        <TabsList className="w-full flex-wrap gap-1 group-data-[orientation=horizontal]/tabs:h-auto sm:w-fit">
          {sections.map((s) => (
            <TabsTrigger key={s} value={s} className="h-9">
              {s[0].toUpperCase() + s.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <DeviceOverview
            key={deviceUuid}
            org={org}
            device={device}
            editable={capabilities.manage}
            canActivate={capabilities.activate}
            onUnconfirmed={setUnconfirmed}
            run={run}
            busy={busy || unconfirmed || device.deployment_status === "pending"}
          />
        </TabsContent>
        <TabsContent value="measurements">
          <MeasurementsSection org={org} device={device} />
        </TabsContent>
        <TabsContent value="history">
          <Suspense fallback={<Skeleton className="h-80 w-full" />}>
            <HistorySection org={org} device={device} />
          </Suspense>
        </TabsContent>
        <TabsContent value="configuration">
          <ConfigurationSection
            org={org}
            device={device}
            editable={capabilities.manage}
            canActivate={capabilities.activate}
            run={run}
            busy={busy || unconfirmed || device.deployment_status === "pending"}
          />
        </TabsContent>
        <TabsContent value="commands">
          <CommandsSection
            org={org}
            device={device}
            allowed={capabilities.command && !unconfirmed}
            run={run}
            busy={busy || unconfirmed || device.deployment_status === "pending"}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DeviceOverview({
  org,
  device,
  editable,
  canActivate,
  onUnconfirmed,
  run,
  busy,
}: {
  org: string
  device: DeviceDetail
  editable: boolean
  canActivate: boolean
  onUnconfirmed: (value: boolean) => void
  run: DeviceOperation
  busy: boolean
}) {
  const savedValues = (d: DeviceDetail): DeviceInput => ({
    name: d.name,
    code: d.code,
    serial_number: d.serial_number ?? "",
    description: d.description ?? "",
  })
  const form = useForm<DeviceInput>({ defaultValues: savedValues(device) }),
    [revision, setRevision] = useState(device.draft_revision),
    [action, setAction] = useState<{
      kind: "archive"
      revision: number
      description: string
    } | null>(null)
  const dirty = form.formState.isDirty
  function reviewAction(kind: "archive") {
    setAction({
      kind,
      revision: device.draft_revision,
      description:
        "The record becomes read-only. Configuration and command history remain available.",
    })
  }
  useUnsaved(dirty)
  useEffect(() => {
    if (!dirty) {
      form.reset(savedValues(device))
      setRevision(device.draft_revision)
    }
  }, [device.draft_revision, dirty, form])
  return (
    <div className="grid items-start gap-6 pt-4 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Device identity</CardTitle>
          <CardDescription>
            Its identity stays the same when source sessions or profile
            revisions change.
          </CardDescription>
        </CardHeader>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            try {
              const result = await run(() =>
                api.updateDevice(org, device.uuid, {
                  ...values,
                  draft_revision: revision,
                }),
              )
              form.reset(savedValues(result))
              setRevision(result.draft_revision)
            } catch {}
          })}
        >
          <CardContent>
            <FieldGroup>
              <TextField
                label="Device name"
                required
                disabled={!editable || device.lifecycle === "archived"}
                {...form.register("name")}
              />
              <TextField
                label="Device code"
                required
                disabled={!editable || device.lifecycle === "archived"}
                {...form.register("code")}
              />
              <TextField
                label="Serial number"
                disabled={!editable || device.lifecycle === "archived"}
                {...form.register("serial_number")}
              />
              <TextField
                label="Description"
                disabled={!editable || device.lifecycle === "archived"}
                {...form.register("description")}
              />
              {dirty && device.draft_revision !== revision && (
                <Alert>
                  <AlertTitle>Newer saved values are available</AlertTitle>
                  <AlertDescription>
                    The saved name is “{device.name}” and code is “{device.code}
                    ”. Your form is retained.
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => {
                        form.reset(savedValues(device))
                        setRevision(device.draft_revision)
                      }}
                    >
                      Use saved values
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </FieldGroup>
          </CardContent>
          {editable && device.lifecycle !== "archived" && (
            <CardFooter className="mt-5 p-0">
              <SaveBar
                dirty={dirty}
                busy={busy}
                onCancel={() => {
                  form.reset(savedValues(device))
                  setRevision(device.draft_revision)
                }}
              />
            </CardFooter>
          )}
        </form>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Connection and configuration</CardTitle>
            <CardDescription>
              Registration, connectivity, and runtime application are tracked
              separately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-3 text-sm">
              <dt>Gateway</dt>
              <dd>{device.candidate?.gateway.name ?? "Not assigned"}</dd>
              <dt>Source connection</dt>
              <dd>
                <DeviceStatus value={device.candidate?.presence ?? "unseen"} />
              </dd>
              <dt>Source</dt>
              <dd>
                {device.candidate
                  ? device.candidate.source_device_id ||
                    "Edge Node measurements"
                  : "Not assigned"}
              </dd>
              <dt>Last seen</dt>
              <dd>{formatTime(device.last_seen_at)}</dd>
              <dt>Last working revision</dt>
              <dd>
                {device.configurations.find(
                  (c) => c.uuid === device.last_applied_configuration_uuid,
                )?.revision ?? "None"}
              </dd>
              <dt>Applied revision</dt>
              <dd>
                {device.configurations.find(
                  (c) => c.uuid === device.applied_configuration_uuid,
                )?.revision ?? "None"}
              </dd>
              <dt>Requested revision</dt>
              <dd>
                {device.configurations.find(
                  (c) => c.uuid === device.desired_configuration_uuid,
                )?.revision ?? "None"}
              </dd>
            </dl>
          </CardContent>
        </Card>
        {device.lifecycle !== "archived" && (
          <Card>
            <CardHeader>
              <CardTitle>Lifecycle actions</CardTitle>
              <CardDescription>
                Activate a deactivated device using its saved configuration.
                Deactivating stops runtime processing. Archiving preserves
                configuration and command history.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {canActivate && (
                <DeviceLifecycleAction
                  org={org}
                  device={device}
                  disabled={busy}
                  onUnconfirmed={onUnconfirmed}
                />
              )}
              {editable && (
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    dirty ||
                    Boolean(
                      device.applied_configuration_uuid ||
                      device.desired_configuration_uuid,
                    ) ||
                    device.deployment_status === "pending"
                  }
                  onClick={() => reviewAction("archive")}
                >
                  Archive device
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <Confirm
        open={Boolean(action)}
        title="Archive this device?"
        description={action?.description ?? ""}
        action="Archive device"
        onClose={() => setAction(null)}
        onConfirm={async () => {
          if (action)
            await run(() =>
              api.deviceAction(org, device.uuid, action.kind, action.revision),
            )
        }}
      />
    </div>
  )
}
